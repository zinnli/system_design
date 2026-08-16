import type { ChangeEvent } from "react";
import { useCallback, useState, useSyncExternalStore } from "react";

import { DEFAULT_VALIDATION_CONFIG } from "../utils/config";
import type { RejectedFile, UploadFileState } from "../utils/types";
import { createUploadManager } from "../utils/uploadManager";

interface UseUploadFilesProps {
  /** 검증 설정 3종은 마운트 시점에 한 번 읽혀 고정된다 (이후 변경은 무시됨). */
  maxFileCount?: number;
  maxFileSizeBytes?: number;
  allowedExtensions?: string[];
  /**
   * 검증에서 거부된 파일 목록을 받는다. 호출부가 토스트·인라인 목록 등
   * 원하는 방식으로 노출한다. 거부가 없으면 빈 배열로 호출되어
   * 이전 에러 표시를 지울 수 있다.
   */
  onFilesRejected?: (rejected: RejectedFile[]) => void;
  /**
   * 파일이 추가·삭제될 때마다 최신 목록을 받는다. react-hook-form의
   * setValue처럼 외부 상태를 동기화하는 용도 (진행률 변화마다 불리지 않는다).
   */
  onFilesChange?: (files: UploadFileState[]) => void;
}

/**
 * 업로드 엔진(UploadManager)을 React에 연결하는 훅.
 * 청크 분할·동시성·재시도·취소는 전부 엔진 책임이고, 이 훅은 input 이벤트
 * 처리, 이름순 정렬, 거부 콜백 전달 같은 입력 어댑팅만 담당한다.
 */
const useUploadFiles = ({
  maxFileCount = DEFAULT_VALIDATION_CONFIG.maxFiles,
  maxFileSizeBytes = DEFAULT_VALIDATION_CONFIG.maxFileSizeBytes,
  allowedExtensions = DEFAULT_VALIDATION_CONFIG.allowedExtensions,
  onFilesRejected,
  onFilesChange,
}: UseUploadFilesProps = {}) => {
  // useState 초기값은 컴포넌트 수명 동안 유지가 보장된다 (useMemo는 캐시일 뿐).
  const [manager] = useState(() =>
    createUploadManager({
      maxFiles: maxFileCount,
      maxFileSizeBytes,
      allowedExtensions,
    }),
  );

  const subscribe = useCallback(
    (onStoreChange: () => void) => manager.subscribe(onStoreChange),
    [manager],
  );
  const getSnapshot = useCallback(() => manager.getSnapshot(), [manager]);

  const uploadFiles = useSyncExternalStore(subscribe, getSnapshot);

  const isLoading = uploadFiles.some(
    (file) => file.status === "queued" || file.status === "uploading",
  );

  const addFiles = (incoming: File[]): void => {
    if (!incoming.length) return;

    const sortedFiles = [...incoming].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    const { rejected } = manager.addFiles(sortedFiles);
    onFilesRejected?.(rejected);
    onFilesChange?.(manager.getSnapshot());
  };

  const handleFilesAdd = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (!files || !files.length) return;

    addFiles(Array.from(files));
    e.target.value = "";
  };

  const handleFilesDrop = (files: File[]): void => {
    addFiles(files);
  };

  const handleFileCancel = (id: string) => (): void => {
    manager.cancel(id);
  };

  const handleFileRetry = (id: string) => (): void => {
    manager.retry(id);
  };

  const handleFileRemove = (id: string) => (): void => {
    manager.remove(id);
    onFilesChange?.(manager.getSnapshot());
  };

  return {
    isLoading,
    uploadFiles,
    handleFilesAdd,
    handleFilesDrop,
    handleFileCancel,
    handleFileRetry,
    handleFileRemove,
  };
};

export default useUploadFiles;
