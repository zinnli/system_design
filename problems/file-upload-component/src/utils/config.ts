import type { ChunkUploadConfig, ValidationConfig } from "./types";

export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  maxFileSizeBytes: 2 * 1024 * 1024 * 1024, // 2GB
  allowedExtensions: [],
  maxFiles: 10,
};

export const DEFAULT_CHUNK_CONFIG: ChunkUploadConfig = {
  chunkSizeBytes: 5 * 1024 * 1024, // 5MB
  maxConcurrentChunks: 4,
  maxRetriesPerChunk: 3,
  retryBaseDelayMs: 500,
};
