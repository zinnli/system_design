import type { UploadFileState } from "../utils/types";
import { FileItem } from "./FileItem";

interface FileListProps {
  files: UploadFileState[];
  onCancel: (id: string) => () => void;
  onRetry: (id: string) => () => void;
  onRemove: (id: string) => () => void;
}

export function FileList({ files, onCancel, onRetry, onRemove }: FileListProps) {
  if (files.length === 0) return null;

  return (
    <ul className="file-list">
      {files.map((state) => (
        <FileItem
          key={state.id}
          state={state}
          onCancel={onCancel}
          onRetry={onRetry}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
}
