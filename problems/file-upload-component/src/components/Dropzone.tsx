import { useCallback, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, KeyboardEvent } from "react";

interface DropzoneProps {
  /** 파일 선택 input의 change 이벤트를 그대로 전달한다 (value 리셋은 훅 책임). */
  onFilesAdd: (event: ChangeEvent<HTMLInputElement>) => void;
  onFilesDrop: (files: File[]) => void;
}

export function Dropzone({ onFilesAdd, onFilesDrop }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const openFilePicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragOver(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length > 0) onFilesDrop(files);
    },
    [onFilesDrop],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openFilePicker();
      }
    },
    [openFilePicker],
  );

  return (
    <div
      className={`dropzone${isDragOver ? " dropzone--active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={openFilePicker}
      onKeyDown={handleKeyDown}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={(event) => {
        // dragleave는 포인터가 자식 요소(안내 문구 등) 위로 넘어갈 때도
        // 발생한다. relatedTarget이 여전히 dropzone 내부라면 실제로
        // 영역을 벗어난 게 아니므로 하이라이트를 끄지 않는다.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsDragOver(false);
        }
      }}
      onDrop={handleDrop}
    >
      <p>파일을 여기에 끌어다 놓거나 클릭해서 선택하세요</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={onFilesAdd}
      />
    </div>
  );
}
