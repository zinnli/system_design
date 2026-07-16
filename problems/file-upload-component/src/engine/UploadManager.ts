import { ConcurrencyPool } from "./ConcurrencyPool";
import { DEFAULT_CHUNK_CONFIG } from "./config";
import { chunkFile } from "./chunkFile";
import type { ChunkUploadConfig, UploadFileState, ValidationConfig } from "./types";
import { completeUpload, initUpload, uploadChunk } from "./uploadApi";
import { DEFAULT_VALIDATION_CONFIG, validateFiles } from "./validateFile";
import { withRetry } from "./withRetry";

interface UploadSession {
  controller: AbortController;
  chunks: Blob[];
  doneIndexes: Set<number>;
  uploadId?: string;
  canceledByUser: boolean;
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
      void this.startUpload(id);
    }

    this.emit();
    return { rejected };
  }

  cancel(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.canceledByUser = true;
    session.controller.abort();
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
    void this.startUpload(id);
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
      existing.canceledByUser = false;
      return existing;
    }
    const created: UploadSession = {
      controller: new AbortController(),
      chunks: chunkFile(file, this.chunkConfig.chunkSizeBytes),
      doneIndexes: new Set<number>(),
      canceledByUser: false,
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
        const { uploadId } = await initUpload(state.file, controller.signal);
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
            const uploadedBytes = Array.from(doneIndexes).reduce(
              (sum, i) => sum + (chunks[i]?.size ?? 0),
              0,
            );
            this.patch(id, {
              completedChunks: doneIndexes.size,
              uploadedBytes,
              progress: Math.round((doneIndexes.size / chunks.length) * 100),
            });
          }),
        ),
      );

      if (session.canceledByUser) return;
      if (failure) {
        this.patch(id, { status: "error", error: failure });
        return;
      }

      await completeUpload(uploadId, controller.signal);
      if (session.canceledByUser) return;
      this.patch(id, { status: "success", progress: 100 });
    } catch (err) {
      if (session.canceledByUser) return;
      const message =
        err instanceof Error ? err.message : "업로드 중 오류가 발생했습니다.";
      this.patch(id, { status: "error", error: message });
    }
  }
}
