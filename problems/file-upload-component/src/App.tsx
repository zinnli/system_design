import { useState } from "react";
import { Dropzone } from "./components/Dropzone";
import { FileList } from "./components/FileList";
import { NetworkSimulationPanel } from "./components/NetworkSimulationPanel";
import { useFileUpload } from "./hooks/useFileUpload";

export function App() {
  const { files, addFiles, cancel, retry } = useFileUpload();
  const [rejections, setRejections] = useState<
    { file: File; error: string }[]
  >([]);

  const handleFilesSelected = (incoming: File[]) => {
    setRejections(addFiles(incoming));
  };

  return (
    <main className="app">
      <h1>파일 업로드 컴포넌트</h1>
      <p className="app__subtitle">
        drag &amp; drop · 파일 검증 · 진행률 · 취소/재시도 · chunk 업로드
      </p>

      <NetworkSimulationPanel />

      <Dropzone onFilesSelected={handleFilesSelected} />

      {rejections.length > 0 && (
        <ul className="rejection-list">
          {rejections.map(({ file, error }) => (
            <li key={file.name}>
              <strong>{file.name}</strong>: {error}
            </li>
          ))}
        </ul>
      )}

      <FileList files={files} onCancel={cancel} onRetry={retry} />
    </main>
  );
}
