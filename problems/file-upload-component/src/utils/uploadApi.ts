import axios, { isAxiosError, type AxiosProgressEvent } from "axios";

export interface InitUploadResponse {
  uploadId: string;
}

export type UploadProgressHandler = (event: AxiosProgressEvent) => void;

const api = axios.create();

/**
 * axios 에러를 단계별 한국어 메시지로 바꿔 다시 던진다.
 * 취소(ERR_CANCELED)는 에러 메시지로 변환하지 않고 그대로 통과시킨다 —
 * uploadManager가 abort reason으로 "사용자 취소"를 판별하기 때문.
 */
function throwStageError(err: unknown, failMessage: string): never {
  if (isAxiosError(err) && err.code !== "ERR_CANCELED") {
    const status = err.response ? ` (status ${err.response.status})` : "";
    throw new Error(`${failMessage}${status}`);
  }
  throw err;
}

/**
 * 서버에 업로드 세션을 만든다. 서버는 이 시점에 uploadId를 발급하고,
 * 이후 청크는 이 id에 종속시켜 추적한다.
 */
export async function initUpload(
  file: File,
  signal: AbortSignal,
): Promise<InitUploadResponse> {
  try {
    const { data } = await api.post<InitUploadResponse>(
      "/api/uploads",
      { fileName: file.name, fileSize: file.size },
      { signal },
    );
    return data;
  } catch (err) {
    throwStageError(err, "업로드 초기화에 실패했습니다.");
  }
}

/** 청크 하나를 업로드한다. 서버는 (uploadId, index) 기준으로 upsert하므로 재시도해도 안전하다. */
export async function uploadChunk(
  uploadId: string,
  index: number,
  chunk: Blob,
  signal: AbortSignal,
  onUploadProgress?: UploadProgressHandler,
): Promise<void> {
  try {
    await api.put(`/api/uploads/${uploadId}/chunks/${index}`, chunk, {
      signal,
      headers: { "Content-Type": "application/octet-stream" },
      onUploadProgress,
    });
  } catch (err) {
    throwStageError(err, "청크 업로드에 실패했습니다.");
  }
}

/** 모든 청크 업로드가 끝났음을 서버에 알려 파일을 조립하게 한다. */
export async function completeUpload(
  uploadId: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    await api.post(`/api/uploads/${uploadId}/complete`, null, { signal });
  } catch (err) {
    throwStageError(err, "업로드 완료 처리에 실패했습니다.");
  }
}
