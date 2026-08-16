import { formatBytes } from "../utils/formatBytes";
import type { UploadFileState, UploadStatus } from "../utils/types";
import { TERMINAL_STATUSES } from "../utils/types";
import { ProgressBar } from "./ProgressBar";

const STATUS_LABEL: Record<UploadStatus, string> = {
  queued: "대기 중",
  uploading: "업로드 중",
  success: "완료",
  error: "실패",
  canceled: "취소됨",
};

const STATUS_TONE: Record<UploadStatus, "normal" | "success" | "error"> = {
  queued: "normal",
  uploading: "normal",
  success: "success",
  error: "error",
  canceled: "normal",
};

interface FileItemProps {
  state: UploadFileState;
  onCancel: (id: string) => () => void;
  onRetry: (id: string) => () => void;
  onRemove: (id: string) => () => void;
}

export function FileItem({ state, onCancel, onRetry, onRemove }: FileItemProps) {
  return (
    <li className="file-item">
      <div className="file-item__header">
        <span className="file-item__name">{state.file.name}</span>
        <span
          className={`file-item__status file-item__status--${state.status}`}
        >
          {STATUS_LABEL[state.status]}
        </span>
      </div>

      <ProgressBar percent={state.progress} tone={STATUS_TONE[state.status]} />

      <div className="file-item__meta">
        <span>
          {formatBytes(state.uploadedBytes)} / {formatBytes(state.file.size)}
          {" · "}
          {state.completedChunks}/{state.totalChunks} 청크
          {state.attempt > 0 && ` · ${state.attempt}번째 재시도`}
        </span>
        {state.error && <span className="file-item__error">{state.error}</span>}
      </div>

      <div className="file-item__actions">
        {(state.status === "uploading" || state.status === "queued") && (
          <button type="button" onClick={onCancel(state.id)}>
            취소
          </button>
        )}
        {state.status === "error" && (
          <button type="button" onClick={onRetry(state.id)}>
            재시도
          </button>
        )}
        {TERMINAL_STATUSES.has(state.status) && (
          <button type="button" onClick={onRemove(state.id)}>
            삭제
          </button>
        )}
      </div>
    </li>
  );
}
