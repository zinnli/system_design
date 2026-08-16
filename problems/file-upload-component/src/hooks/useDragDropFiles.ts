import { useEffect, useRef, useState } from "react";

interface UseDragDropFilesProps {
  onFilesDrop: (files: File[]) => void;
}

/**
 * ref를 붙인 요소를 drag & drop 영역으로 만드는 훅.
 * 하이라이트용 isDragging 상태를 관리하고, 드롭된 파일 목록을 콜백으로 넘긴다.
 */
const useDragDropFiles = ({ onFilesDrop }: UseDragDropFilesProps) => {
  const dragRef = useRef<HTMLDivElement | null>(null);

  const [isDragging, setIsDragging] = useState(false);

  // 리스너는 마운트 시 한 번만 등록하고, 콜백은 ref를 통해 항상 최신을
  // 읽는다 — 첫 렌더의 콜백이 리스너에 고정되는 stale closure를 막는다.
  const onFilesDropRef = useRef(onFilesDrop);
  onFilesDropRef.current = onFilesDrop;

  useEffect(() => {
    const element = dragRef.current;
    if (!element) return;

    const handleDragEnter = (e: DragEvent): void => {
      e.preventDefault();
      e.stopPropagation();

      setIsDragging(true);
    };

    const handleDragLeave = (e: DragEvent): void => {
      e.preventDefault();
      e.stopPropagation();

      // dragleave는 포인터가 자식 요소 위로 넘어갈 때도 발생한다.
      // relatedTarget이 여전히 영역 내부라면 하이라이트를 끄지 않는다.
      const currentTarget = e.currentTarget as HTMLElement | null;
      if (currentTarget?.contains(e.relatedTarget as Node | null)) return;

      setIsDragging(false);
    };

    const handleDragOver = (e: DragEvent): void => {
      // 기본 동작(브라우저가 파일을 여는 것)을 막아야 drop 이벤트가 발생한다.
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent): void => {
      e.preventDefault();
      e.stopPropagation();

      setIsDragging(false);

      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;

      onFilesDropRef.current(files);
    };

    element.addEventListener("dragenter", handleDragEnter);
    element.addEventListener("dragleave", handleDragLeave);
    element.addEventListener("dragover", handleDragOver);
    element.addEventListener("drop", handleDrop);

    return () => {
      element.removeEventListener("dragenter", handleDragEnter);
      element.removeEventListener("dragleave", handleDragLeave);
      element.removeEventListener("dragover", handleDragOver);
      element.removeEventListener("drop", handleDrop);
    };
  }, []);

  return { dragRef, isDragging };
};

export default useDragDropFiles;
