import { ConcurrencyPool } from "./ConcurrencyPool";
import { DEFAULT_CHUNK_CONFIG } from "./config";
import { chunkFile } from "./chunkFile";
import type { ChunkUploadConfig, UploadFileState, ValidationConfig } from "./types";
import { completeUpload, initUpload, uploadChunk } from "./uploadApi";
import { DEFAULT_VALIDATION_CONFIG, validateFiles } from "./validateFile";
import { withRetry } from "./withRetry";

/**
 * AbortController.abort()에 넘기는 reason. session.controller.signal.reason과
 * 비교해 "사용자가 취소했다"를 판별하는 유일한 근거로 쓴다 — 별도의 boolean
 * 플래그를 두면 새 abort 경로가 추가될 때마다 그 플래그를 깜빡하고 안 챙길
 * 위험이 있어서, signal 자체를 단일 진실 공급원으로 삼았다.
 */
const USER_CANCEL_REASON = "user-cancel";

interface UploadSession {
  controller: AbortController;
  chunks: Blob[];
  doneIndexes: Set<number>;
  uploadId?: string;
}

function isUserCanceled(session: UploadSession): boolean {
  return (
    session.controller.signal.aborted &&
    session.controller.signal.reason === USER_CANCEL_REASON
  );
}

const TERMINAL_STATUSES: ReadonlySet<UploadFileState["status"]> = new Set([
  "success",
  "error",
  "canceled",
]);

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

  addFiles(incoming: File[]): { rejected: { file: File; error: string }[] } {
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
      const totalChunks = Math.ceil(file.size / this.chunkConfig.chunkSizeBytes);
      this.files.set(id, {
        id,
        file,
        status: "queued",
        progress: 0,
        uploadedBytes: 0,
        totalChunks,
        completedChunks: 0,
        error: null,
        attempt: 0,
      });
      // 다음 microtask로 미뤄서 'queued' 상태가 최소 한 번은 구독자에게
      // 관찰된 뒤에 'uploading'으로 넘어가도록 한다.
      queueMicrotask(() => void this.startUpload(id));
    }

    this.emit();
    return { rejected };
  }

  cancel(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.controller.abort(USER_CANCEL_REASON);
    this.patch(id, { status: "canceled" });
  }

  /** 마지막으로 성공한 청크 이후부터 이어서 업로드를 재시도한다 (처음부터 다시 올리지 않는다). */
  retry(id: string): void {
    const state = this.files.get(id);
    if (!state || state.status !== "error") return;
    this.patch(id, {
      status: "queued",
      error: null,
      attempt: state.attempt + 1,
    });
    queueMicrotask(() => void this.startUpload(id));
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

  private getOrCreateSession(id: string, file: File): UploadSession {
    const existing = this.sessions.get(id);
    if (existing) {
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

  private async startUpload(id: string): Promise<void> {
    const state = this.files.get(id);
    if (!state) return;

    const session = this.getOrCreateSession(id, state.file);
    const { controller, chunks, doneIndexes } = session;

    this.patch(id, { status: "uploading", error: null });

    try {
      if (!session.uploadId) {
        const { uploadId } = await withRetry(
          () => initUpload(state.file, controller.signal),
          this.chunkConfig.maxRetriesPerChunk,
          this.chunkConfig.retryBaseDelayMs,
          controller.signal,
        );
        session.uploadId = uploadId;
      }
      const uploadId = session.uploadId;
      if (!uploadId) {
        throw new Error("업로드 세션 생성에 실패했습니다.");
      }

      let failure: string | null = null;
      const remaining = chunks
        .map((_, index) => index)
        .filter((index) => !doneIndexes.has(index));

      // 이미 완료된 청크의 바이트 합만 한 번 계산하고, 이후로는 완료될
      // 때마다 더해나간다 (매 청크마다 전체를 다시 합산하지 않는다).
      let uploadedBytes = Array.from(doneIndexes).reduce(
        (sum, i) => sum + (chunks[i]?.size ?? 0),
        0,
      );

      await Promise.all(
        remaining.map((index) =>
          this.pool.run(async () => {
            if (failure || controller.signal.aborted) return;
            try {
              await withRetry(
                () => uploadChunk(uploadId, index, chunks[index]!, controller.signal),
                this.chunkConfig.maxRetriesPerChunk,
                this.chunkConfig.retryBaseDelayMs,
                controller.signal,
              );
            } catch (err) {
              if (!failure && !controller.signal.aborted) {
                failure =
                  err instanceof Error
                    ? err.message
                    : "청크 업로드에 실패했습니다.";
                // 이 파일에 속한 나머지 진행 중인 청크 요청도 함께 중단한다.
                controller.abort();
              }
              return;
            }
            doneIndexes.add(index);
            uploadedBytes += chunks[index]?.size ?? 0;
            this.patch(id, {
              completedChunks: doneIndexes.size,
              uploadedBytes,
              progress: Math.round((doneIndexes.size / chunks.length) * 100),
            });
          }),
        ),
      );

      if (isUserCanceled(session)) return;
      if (failure) {
        this.patch(id, { status: "error", error: failure });
        return;
      }

      await withRetry(
        () => completeUpload(uploadId, controller.signal),
        this.chunkConfig.maxRetriesPerChunk,
        this.chunkConfig.retryBaseDelayMs,
        controller.signal,
      );
      // completeUpload가 예외 없이 끝났다는 건 서버가 이미 파일을 완성했다는
      // 뜻이므로, 그 순간과 겹쳐 들어온 취소 요청이 있어도 성공으로 확정한다
      // (서버 상태와 클라이언트 상태가 어긋나는 걸 막기 위함).
      this.patch(id, { status: "success", progress: 100 });
    } catch (err) {
      if (isUserCanceled(session)) return;
      const message =
        err instanceof Error ? err.message : "업로드 중 오류가 발생했습니다.";
      this.patch(id, { status: "error", error: message });
    }
  }
}
