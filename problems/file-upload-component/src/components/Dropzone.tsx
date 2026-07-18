import { useRef } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import useDragDropFiles from "../hooks/useDragDropFiles";

interface DropzoneProps {
  /** 파일 선택 input의 change 이벤트를 그대로 전달한다 (value 리셋은 훅 책임). */
  onFilesAdd: (event: ChangeEvent<HTMLInputElement>) => void;
  onFilesDrop: (files: File[]) => void;
}

export function Dropzone({ onFilesAdd, onFilesDrop }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { dragRef, isDragging } = useDragDropFiles({ onFilesDrop });

  const openFilePicker = (): void => {
    inputRef.current?.click();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openFilePicker();
    }
  };

  return (
    <div
      ref={dragRef}
      className={`dropzone${isDragging ? " dropzone--active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={openFilePicker}
      onKeyDown={handleKeyDown}
    >
      <p>파일을 여기에 끌어다 놓거나 클릭해서 선택하세요</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={onFilesAdd}
        // 프로그래매틱 input.click()이 부모 div로 버블링되면 openFilePicker가
        // 재진입한다 (브라우저의 click-in-progress 가드 덕에 무한 루프는 아니지만
        // 핸들러가 두 번 불린다). 전파를 끊어 한 번만 실행되게 한다.
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
