import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeUpload, initUpload, uploadChunk } from "./uploadApi";

const mocks = vi.hoisted(() => {
  const api = {
    post: vi.fn(),
    put: vi.fn(),
  };
  const isAxiosErrorMock = vi.fn(
    (err: unknown) =>
      typeof err === "object" &&
      err !== null &&
      "isAxiosError" in err &&
      err.isAxiosError === true,
  );

  return { api, isAxiosErrorMock };
});

vi.mock("axios", () => ({
  default: {
    create: vi.fn(() => mocks.api),
  },
  isAxiosError: mocks.isAxiosErrorMock,
}));

function makeAxiosError(status: number): Error & {
  isAxiosError: true;
  response: { status: number };
} {
  return Object.assign(new Error("Request failed"), {
    isAxiosError: true as const,
    response: { status },
  });
}

function makeCanceledAxiosError(): Error & {
  code: "ERR_CANCELED";
  isAxiosError: true;
} {
  return Object.assign(new Error("canceled"), {
    code: "ERR_CANCELED" as const,
    isAxiosError: true as const,
  });
}

describe("uploadApi", () => {
  beforeEach(() => {
    mocks.api.post.mockReset();
    mocks.api.put.mockReset();
    mocks.isAxiosErrorMock.mockClear();
    mocks.isAxiosErrorMock.mockImplementation(
      (err: unknown) =>
        typeof err === "object" &&
        err !== null &&
        "isAxiosError" in err &&
        err.isAxiosError === true,
    );
  });

  it("initUpload는 axios post에 파일 메타데이터와 AbortSignal을 넘긴다", async () => {
    const file = new File([new Uint8Array(3)], "a.bin");
    const signal = new AbortController().signal;
    mocks.api.post.mockResolvedValue({ data: { uploadId: "u1" } });

    await expect(initUpload(file, signal)).resolves.toEqual({
      uploadId: "u1",
    });

    expect(mocks.api.post).toHaveBeenCalledWith(
      "/api/uploads",
      { fileName: "a.bin", fileSize: 3 },
      { signal },
    );
  });

  it("uploadChunk는 axios put에 청크, AbortSignal, 업로드 진행 콜백을 넘긴다", async () => {
    const chunk = new Blob([new Uint8Array(5)]);
    const signal = new AbortController().signal;
    const onUploadProgress = vi.fn();
    mocks.api.put.mockResolvedValue({ data: null });

    await uploadChunk("u1", 2, chunk, signal, onUploadProgress);

    expect(mocks.api.put).toHaveBeenCalledWith(
      "/api/uploads/u1/chunks/2",
      chunk,
      {
        signal,
        headers: { "Content-Type": "application/octet-stream" },
        onUploadProgress,
      },
    );
  });

  it("completeUpload는 axios post에 완료 요청과 AbortSignal을 넘긴다", async () => {
    const signal = new AbortController().signal;
    mocks.api.post.mockResolvedValue({ data: { ok: true } });

    await completeUpload("u1", signal);

    expect(mocks.api.post).toHaveBeenCalledWith(
      "/api/uploads/u1/complete",
      null,
      { signal },
    );
  });

  it("axios 실패 응답은 단계별 메시지와 status로 변환한다", async () => {
    const signal = new AbortController().signal;
    mocks.api.put.mockRejectedValue(makeAxiosError(500));

    await expect(uploadChunk("u1", 0, new Blob(), signal)).rejects.toThrow(
      "청크 업로드에 실패했습니다. (status 500)",
    );
  });

  it("axios 취소 에러는 uploadManager가 signal reason으로 판별할 수 있게 그대로 던진다", async () => {
    const signal = new AbortController().signal;
    const err = makeCanceledAxiosError();
    mocks.api.put.mockRejectedValue(err);

    await expect(uploadChunk("u1", 0, new Blob(), signal)).rejects.toBe(err);
  });
});
