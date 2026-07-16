import type { ChunkUploadConfig } from "./types";

export const DEFAULT_CHUNK_CONFIG: ChunkUploadConfig = {
  chunkSizeBytes: 5 * 1024 * 1024, // 5MB
  maxConcurrentChunks: 4,
  maxRetriesPerChunk: 3,
  retryBaseDelayMs: 500,
};
