export type UploadStatus =
  | "queued"
  | "uploading"
  | "success"
  | "error"
  | "canceled";

/**
 * 더 이상 진행되지 않는 종결 상태. 엔진은 이 상태에서만 remove를 허용하고,
 * UI는 같은 기준으로 삭제 버튼을 노출한다 — 한 곳에서 정의해 어긋나지 않게 한다.
 */
export const TERMINAL_STATUSES: ReadonlySet<UploadStatus> = new Set([
  "success",
  "error",
  "canceled",
]);

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

/** 검증에서 거부된 파일과 그 사유. */
export interface RejectedFile {
  file: File;
  error: string;
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
