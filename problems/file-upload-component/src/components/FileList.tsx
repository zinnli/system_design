import type { UploadFileState } from "../engine/types";
import { FileItem } from "./FileItem";

interface FileListProps {
  files: UploadFileState[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}

export function FileList({ files, onCancel, onRetry }: FileListProps) {
  if (files.length === 0) return null;

  return (
    <ul className="file-list">
      {files.map((state) => (
        <FileItem
          key={state.id}
          state={state}
          onCancel={onCancel}
          onRetry={onRetry}
        />
      ))}
    </ul>
  );
}
