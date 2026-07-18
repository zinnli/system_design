export interface InitUploadResponse {
  uploadId: string;
}

/** fetch 후 실패 응답이면 단계별 메시지에 status를 붙여 던진다. */
async function request(
  url: string,
  init: RequestInit,
  failMessage: string,
): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${failMessage} (status ${response.status})`);
  }
  return response;
}

/**
 * 서버에 업로드 세션을 만든다. 서버는 이 시점에 uploadId를 발급하고,
 * 이후 청크는 이 id에 종속시켜 추적한다.
 */
export async function initUpload(
  file: File,
  signal: AbortSignal,
): Promise<InitUploadResponse> {
  const response = await request(
    "/api/uploads",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, fileSize: file.size }),
      signal,
    },
    "업로드 초기화에 실패했습니다.",
  );
  return response.json();
}

/** 청크 하나를 업로드한다. 서버는 (uploadId, index) 기준으로 upsert하므로 재시도해도 안전하다. */
export async function uploadChunk(
  uploadId: string,
  index: number,
  chunk: Blob,
  signal: AbortSignal,
): Promise<void> {
  await request(
    `/api/uploads/${uploadId}/chunks/${index}`,
    { method: "PUT", body: chunk, signal },
    "청크 업로드에 실패했습니다.",
  );
}

/** 모든 청크 업로드가 끝났음을 서버에 알려 파일을 조립하게 한다. */
export async function completeUpload(
  uploadId: string,
  signal: AbortSignal,
): Promise<void> {
  await request(
    `/api/uploads/${uploadId}/complete`,
    { method: "POST", signal },
    "업로드 완료 처리에 실패했습니다.",
  );
}
