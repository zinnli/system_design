import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFileUpload } from "./useFileUpload";

function makeFile(name: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name);
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input.toString();
}

describe("useFileUpload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("파일을 추가하면 목록에 반영되고 업로드가 진행되어 성공한다", async () => {
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

    const { result } = renderHook(() => useFileUpload());

    act(() => {
      const rejected = result.current.addFiles([makeFile("a.txt", 1024)]);
      expect(rejected).toHaveLength(0);
    });

    expect(result.current.files).toHaveLength(1);

    await waitFor(() => {
      expect(result.current.files[0]?.status).toBe("success");
    });
  });

  it("검증에 실패한 파일은 rejected로 반환되고 목록에는 추가되지 않는다", () => {
    const { result } = renderHook(() => useFileUpload());

    let rejected: { file: File; error: string }[] = [];
    act(() => {
      rejected = result.current.addFiles([makeFile("empty.txt", 0)]);
    });

    expect(rejected).toHaveLength(1);
    expect(result.current.files).toHaveLength(0);
  });
});
