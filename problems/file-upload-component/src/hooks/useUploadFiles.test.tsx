import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useUploadFiles from "./useUploadFiles";

function makeFile(name: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name);
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input.toString();
}

function stubUploadApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url === "/api/uploads") {
        return new Response(JSON.stringify({ uploadId: "u1" }), {
          status: 200,
        });
      }
      if (method === "PUT") return new Response(null, { status: 204 });
      return new Response(null, { status: 200 });
    }),
  );
}

describe("useUploadFiles", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("파일을 추가하면 목록에 반영되고 업로드가 진행되어 성공한다", async () => {
    stubUploadApi();

    const { result } = renderHook(() => useUploadFiles());

    act(() => {
      result.current.handleFilesDrop([makeFile("a.txt", 1024)]);
    });

    expect(result.current.uploadFiles).toHaveLength(1);

    await waitFor(() => {
      expect(result.current.uploadFiles[0]?.status).toBe("success");
    });
    expect(result.current.isLoading).toBe(false);
  });

  it("추가된 파일은 이름순으로 정렬되어 등록된다", async () => {
    stubUploadApi();

    const { result } = renderHook(() => useUploadFiles());

    act(() => {
      result.current.handleFilesDrop([
        makeFile("b.txt", 10),
        makeFile("a.txt", 10),
      ]);
    });

    expect(result.current.uploadFiles.map((f) => f.file.name)).toEqual([
      "a.txt",
      "b.txt",
    ]);

    // 업로드가 테스트 종료 후에도 진행되며 act 경고를 내지 않도록 완료까지 대기
    await waitFor(() => {
      expect(
        result.current.uploadFiles.every((f) => f.status === "success"),
      ).toBe(true);
    });
  });

  it("검증에 실패한 파일은 onFilesRejected로 전달되고 목록에는 추가되지 않는다", () => {
    const onFilesRejected = vi.fn();
    const { result } = renderHook(() => useUploadFiles({ onFilesRejected }));

    act(() => {
      result.current.handleFilesDrop([makeFile("empty.txt", 0)]);
    });

    expect(onFilesRejected).toHaveBeenCalledTimes(1);
    expect(onFilesRejected.mock.calls[0]![0][0].error).toMatch("빈 파일");
    expect(result.current.uploadFiles).toHaveLength(0);
  });

  it("파일 추가·삭제 시 onFilesChange로 최신 목록이 전달된다", async () => {
    stubUploadApi();

    const onFilesChange = vi.fn();
    const { result } = renderHook(() => useUploadFiles({ onFilesChange }));

    act(() => {
      result.current.handleFilesDrop([makeFile("a.txt", 10)]);
    });
    expect(onFilesChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ file: expect.objectContaining({ name: "a.txt" }) }),
      ]),
    );

    await waitFor(() => {
      expect(result.current.uploadFiles[0]?.status).toBe("success");
    });

    act(() => {
      result.current.handleFileRemove(result.current.uploadFiles[0]!.id)();
    });
    expect(onFilesChange).toHaveBeenLastCalledWith([]);
    expect(result.current.uploadFiles).toHaveLength(0);
  });
});
