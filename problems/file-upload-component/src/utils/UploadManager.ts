import { ConcurrencyPool } from "./ConcurrencyPool";
import { DEFAULT_CHUNK_CONFIG } from "./config";
import { chunkFile } from "./chunkFile";
import type {
  ChunkUploadConfig,
  RejectedFile,
  UploadFileState,
  ValidationConfig,
} from "./types";
import { TERMINAL_STATUSES } from "./types";
import { completeUpload, initUpload, uploadChunk } from "./uploadApi";
import { DEFAULT_VALIDATION_CONFIG, validateFiles } from "./validateFile";
import { withRetry } from "./withRetry";

/**
 * AbortController.abort()에 넘기는 reason. "사용자가 취소했다"의 판별은 별도
 * boolean 플래그가 아니라 signal의 이 reason 하나로만 한다 — abort 경로가
 * 늘어나도 동기화를 깜빡할 여지가 없도록 signal을 단일 진실 공급원으로 삼았다.
 */
const USER_CANCEL_REASON = "user-cancel";

/** 파일 하나의 업로드 세션. 수동 재시도 시 재사용되어 "이어올리기"를 가능하게 한다. */
interface UploadSession {
  controller: AbortController;
  chunks: Blob[];
  /** 업로드에 성공한 청크 인덱스. 재시도 시 여기 없는 청크만 다시 보낸다. */
  doneIndexes: Set<number>;
  uploadId?: string;
}

function isUserCanceled(session: UploadSession): boolean {
  const { signal } = session.controller;
  return signal.aborted && signal.reason === USER_CANCEL_REASON;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "업로드 중 오류가 발생했습니다.";
}

/**
 * 파일 업로드의 상태와 네트워크 흐름을 소유하는 프레임워크 독립적인 엔진.
 * React는 subscribe/getSnapshot을 통해 이 클래스를 구독만 한다 — 그래서
 * 업로드 로직은 브라우저 DOM(jsdom)만 있으면 React 없이도 테스트할 수 있다.
 */
export class UploadManager {
  private readonly files = new Map<string, UploadFileState>();
  private readonly sessions = new Map<string, UploadSession>();
  private readonly listeners = new Set<() => void>();
  private readonly pool: ConcurrencyPool;
  /**
   * React의 useSyncExternalStore는 getSnapshot()이 변경 없이 매번 새
   * 배열을 반환하면 무한 리렌더로 이어진다. 상태가 실제로 바뀔 때(emit)만
   * 캐시를 무효화해 참조 동일성을 보장한다.
   */
  private cachedSnapshot: UploadFileState[] | null = null;

  constructor(
    private readonly validationConfig: ValidationConfig = DEFAULT_VALIDATION_CONFIG,
    private readonly chunkConfig: ChunkUploadConfig = DEFAULT_CHUNK_CONFIG,
  ) {
    this.pool = new ConcurrencyPool(chunkConfig.maxConcurrentChunks);
  }

  // ───────────────────────── 구독 (React 연동) ─────────────────────────

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): UploadFileState[] {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = Array.from(this.files.values());
    }
    return this.cachedSnapshot;
  }

  // ───────────────────────── 공개 명령 ─────────────────────────

  /** 파일을 검증해 통과한 것만 등록·업로드하고, 거부된 파일은 사유와 함께 반환한다. */
  addFiles(incoming: File[]): { rejected: RejectedFile[] } {
    const existingNames = new Set(
      Array.from(this.files.values()).map((f) => f.file.name),
    );
    const { accepted, rejected } = validateFiles(
      incoming,
      existingNames,
      this.validationConfig,
    );

    for (const file of accepted) {
      const id = crypto.randomUUID();
      this.files.set(id, this.createInitialState(id, file));
      this.scheduleUpload(id);
    }

    this.emit();
    return { rejected };
  }

  cancel(id: string): void {
    const state = this.files.get(id);
    if (!state || TERMINAL_STATUSES.has(state.status)) return;
    // queued 상태면 세션이 아직 없을 수 있다(시작이 microtask로 지연됨).
    // 그 경우에도 상태만 canceled로 바꿔 두면 startUpload가 시작을 포기한다.
    this.sessions.get(id)?.controller.abort(USER_CANCEL_REASON);
    this.patch(id, { status: "canceled" });
  }

  /** 마지막으로 성공한 청크 이후부터 이어서 재시도한다 (처음부터 다시 올리지 않는다). */
  retry(id: string): void {
    const state = this.files.get(id);
    if (!state || state.status !== "error") return;
    this.patch(id, {
      status: "queued",
      error: null,
      attempt: state.attempt + 1,
    });
    this.scheduleUpload(id);
  }

  /**
   * 완료/실패/취소된 파일을 목록에서 지운다. 진행 중인 파일은 지울 수 없다
   * (먼저 cancel을 호출해야 한다). 세션이 들고 있던 청크 Blob 배열과
   * doneIndexes도 함께 해제되어 메모리에 무한정 쌓이지 않는다.
   */
  remove(id: string): void {
    const state = this.files.get(id);
    if (!state || !TERMINAL_STATUSES.has(state.status)) return;
    this.files.delete(id);
    this.sessions.delete(id);
    this.emit();
  }

  // ───────────────────────── 내부: 상태 갱신 ─────────────────────────

  private createInitialState(id: string, file: File): UploadFileState {
    return {
      id,
      file,
      status: "queued",
      progress: 0,
      uploadedBytes: 0,
      totalChunks: Math.ceil(file.size / this.chunkConfig.chunkSizeBytes),
      completedChunks: 0,
      error: null,
      attempt: 0,
    };
  }

  private patch(id: string, changes: Partial<UploadFileState>): void {
    const current = this.files.get(id);
    if (!current) return;
    this.files.set(id, { ...current, ...changes });
    this.emit();
  }

  private emit(): void {
    this.cachedSnapshot = null;
    for (const listener of this.listeners) listener();
  }

  // ───────────────────────── 내부: 업로드 파이프라인 ─────────────────────────

  /**
   * 시작을 다음 microtask로 미룬다 — 'queued' 상태가 구독자에게 최소 한 번
   * 관찰된 뒤 'uploading'으로 넘어가고, 그 사이 취소할 틈도 생긴다.
   */
  private scheduleUpload(id: string): void {
    queueMicrotask(() => void this.startUpload(id));
  }

  /**
   * 업로드 한 번의 전체 시나리오: uploadId 확보 → 남은 청크 업로드 → 완료 통지.
   * 취소는 에러로 취급하지 않고, 그 외 실패는 error 상태로 전환한다.
   */
  private async startUpload(id: string): Promise<void> {
    const state = this.files.get(id);
    // 시작이 예약된 뒤 실행되기 전에 취소·삭제될 수 있다. queued가 아니면 포기.
    if (!state || state.status !== "queued") return;

    const session = this.getOrCreateSession(id, state.file);
    const { signal } = session.controller;

    this.patch(id, { status: "uploading", error: null });

    try {
      const uploadId = await this.ensureUploadId(session, state.file, signal);

      await this.uploadRemainingChunks(id, session, uploadId);
      // in-flight 요청 없이 취소된 경우(모든 청크 태스크가 조용히 건너뜀)는
      // 예외가 발생하지 않으므로 여기서 한 번 더 확인한다.
      if (isUserCanceled(session)) return;

      await this.callWithRetry(() => completeUpload(uploadId, signal), signal);
      // completeUpload가 예외 없이 끝났다는 건 서버가 이미 파일을 완성했다는
      // 뜻이므로, 그 순간과 겹쳐 들어온 취소 요청이 있어도 성공으로 확정한다
      // (서버 상태와 클라이언트 상태가 어긋나는 걸 막기 위함).
      this.patch(id, { status: "success", progress: 100 });
    } catch (err) {
      // 사용자 취소는 에러가 아니다 — cancel()이 이미 canceled로 바꿔 두었다.
      if (isUserCanceled(session)) return;
      this.patch(id, { status: "error", error: toErrorMessage(err) });
    }
  }

  private getOrCreateSession(id: string, file: File): UploadSession {
    const existing = this.sessions.get(id);
    if (existing) {
      // 재시도 경로: 이전 시도에서 abort된 controller는 재사용할 수 없으므로
      // 새로 발급한다. chunks/doneIndexes/uploadId는 그대로 유지해 이미 성공한
      // 청크를 건너뛰고 이어서 올릴 수 있게 한다.
      existing.controller = new AbortController();
      return existing;
    }
    const created: UploadSession = {
      controller: new AbortController(),
      chunks: chunkFile(file, this.chunkConfig.chunkSizeBytes),
      doneIndexes: new Set<number>(),
    };
    this.sessions.set(id, created);
    return created;
  }

  /**
   * 세션에 uploadId가 없으면 서버에서 발급받아 저장한다. 수동 재시도 시에는
   * 기존 uploadId를 재사용해, 이전 시도에서 올라간 청크가 서버에 유지된다.
   */
  private async ensureUploadId(
    session: UploadSession,
    file: File,
    signal: AbortSignal,
  ): Promise<string> {
    if (session.uploadId !== undefined) return session.uploadId;
    const { uploadId } = await this.callWithRetry(
      () => initUpload(file, signal),
      signal,
    );
    session.uploadId = uploadId;
    return uploadId;
  }

  /**
   * 아직 성공하지 못한 청크를 전역 동시성 풀에 태워 모두 업로드한다.
   * 청크 하나가 영구 실패하면 이 파일의 나머지 요청을 abort로 정리하고
   * 실패 원인을 그대로 던진다 (Promise.all은 가장 먼저 발생한 실패 —
   * abort로 파생된 AbortError가 아니라 원인이 된 실제 에러 — 로 reject된다).
   */
  private async uploadRemainingChunks(
    id: string,
    session: UploadSession,
    uploadId: string,
  ): Promise<void> {
    const { controller, chunks, doneIndexes } = session;
    const { signal } = controller;
    const remaining = chunks
      .map((_, index) => index)
      .filter((index) => !doneIndexes.has(index));

    await Promise.all(
      remaining.map((index) =>
        this.pool.run(async () => {
          // 취소되었거나 앞선 청크가 영구 실패한 파일의 남은 청크는 건너뛴다.
          if (signal.aborted) return;
          try {
            await this.callWithRetry(
              () => uploadChunk(uploadId, index, chunks[index]!, signal),
              signal,
            );
          } catch (err) {
            controller.abort();
            throw err;
          }
          doneIndexes.add(index);
          this.reportChunkProgress(id, session);
        }),
      ),
    );
  }

  /** doneIndexes를 근거로 진행률을 다시 계산해 상태에 반영한다. */
  private reportChunkProgress(id: string, session: UploadSession): void {
    const { chunks, doneIndexes } = session;
    // 완료된 청크 바이트를 매번 합산한다. 2GB 파일도 청크가 400개 수준이라
    // 증분 계산으로 아낄 비용보다 "항상 doneIndexes에서 파생된다"는 단순함이 낫다.
    let uploadedBytes = 0;
    for (const index of doneIndexes) uploadedBytes += chunks[index]?.size ?? 0;

    this.patch(id, {
      completedChunks: doneIndexes.size,
      uploadedBytes,
      progress: Math.round((doneIndexes.size / chunks.length) * 100),
    });
  }

  /** chunkConfig의 재시도 횟수·백오프 설정을 적용해 withRetry를 호출한다. */
  private callWithRetry<T>(
    fn: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    return withRetry(
      fn,
      this.chunkConfig.maxRetriesPerChunk,
      this.chunkConfig.retryBaseDelayMs,
      signal,
    );
  }
}
