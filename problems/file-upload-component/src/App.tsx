import { useState } from "react";
import { Dropzone } from "./components/Dropzone";
import { FileList } from "./components/FileList";
import { NetworkSimulationPanel } from "./components/NetworkSimulationPanel";
import { RejectionList } from "./components/RejectionList";
import type { RejectedFile } from "./utils/types";
import useUploadFiles from "./hooks/useUploadFiles";

export function App() {
  const [rejections, setRejections] = useState<RejectedFile[]>([]);

  const {
    isLoading,
    uploadFiles,
    handleFilesAdd,
    handleFilesDrop,
    handleFileCancel,
    handleFileRetry,
    handleFileRemove,
  } = useUploadFiles({ onFilesRejected: setRejections });

  return (
    <main className="app" aria-busy={isLoading}>
      <h1>파일 업로드 컴포넌트</h1>
      <p className="app__subtitle">
        drag &amp; drop · 파일 검증 · 진행률 · 취소/재시도 · chunk 업로드
      </p>

      <NetworkSimulationPanel />

      <Dropzone onFilesAdd={handleFilesAdd} onFilesDrop={handleFilesDrop} />

      <RejectionList rejections={rejections} />

      <FileList
        files={uploadFiles}
        onCancel={handleFileCancel}
        onRetry={handleFileRetry}
        onRemove={handleFileRemove}
      />
    </main>
  );
}
