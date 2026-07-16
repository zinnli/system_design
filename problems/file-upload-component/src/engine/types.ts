export type UploadStatus =
  | "queued"
  | "uploading"
  | "success"
  | "error"
  | "canceled";

export interface UploadFileState {
  id: string;
  file: File;
  status: UploadStatus;
  /** 0~100 */
  progress: number;
  uploadedBytes: number;
  totalChunks: number;
  completedChunks: number;
  /** 재시도 가능한 실패인지, 사용자가 취소했는지 구분 */
  error: string | null;
  attempt: number;
}

export interface ValidationConfig {
  maxFileSizeBytes: number;
  /** 빈 배열이면 모든 확장자 허용 */
  allowedExtensions: string[];
  maxFiles: number;
}

export interface ChunkUploadConfig {
  chunkSizeBytes: number;
  /** 전체 파일에 걸쳐 동시에 전송 가능한 청크 수 */
  maxConcurrentChunks: number;
  maxRetriesPerChunk: number;
  retryBaseDelayMs: number;
}
