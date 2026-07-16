import { useCallback, useMemo, useSyncExternalStore } from "react";
import { UploadManager } from "../engine/UploadManager";

/**
 * UploadManager(프레임워크 독립적인 엔진)를 구독하는 얇은 어댑터.
 * 상태 계산이나 네트워크 로직은 여기 두지 않는다 — 전부 엔진 책임이고,
 * 이 훅은 React 렌더 사이클에 엔진 상태를 연결하는 역할만 한다.
 */
export function useFileUpload() {
  const manager = useMemo(() => new UploadManager(), []);

  const subscribe = useCallback(
    (onStoreChange: () => void) => manager.subscribe(onStoreChange),
    [manager],
  );
  const getSnapshot = useCallback(() => manager.getSnapshot(), [manager]);

  const files = useSyncExternalStore(subscribe, getSnapshot);

  const addFiles = useCallback(
    (incoming: FileList | File[]) =>
      manager.addFiles(Array.from(incoming)).rejected,
    [manager],
  );
  const cancel = useCallback((id: string) => manager.cancel(id), [manager]);
  const retry = useCallback((id: string) => manager.retry(id), [manager]);

  return { files, addFiles, cancel, retry };
}
