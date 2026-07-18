import { useState } from "react";
import { Dropzone } from "./components/Dropzone";
import { FileList } from "./components/FileList";
import { NetworkSimulationPanel } from "./components/NetworkSimulationPanel";
import useUploadFiles from "./hooks/useUploadFiles";

export function App() {
  const [rejections, setRejections] = useState<
    { file: File; error: string }[]
  >([]);

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

      {rejections.length > 0 && (
        <ul className="rejection-list">
          {rejections.map(({ file, error }, index) => (
            <li key={`${index}-${file.name}`}>
              <strong>{file.name}</strong>: {error}
            </li>
          ))}
        </ul>
      )}

      <FileList
        files={uploadFiles}
        onCancel={handleFileCancel}
        onRetry={handleFileRetry}
        onRemove={handleFileRemove}
      />
    </main>
  );
}
