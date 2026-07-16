import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadManager } from "./UploadManager";

function makeFile(name: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name);
}

function findState(manager: UploadManager, id: string) {
  return manager.getSnapshot().find((f) => f.id === id);
}

async function waitForStatus(
  manager: UploadManager,
  id: string,
  status: string,
) {
  await vi.waitFor(
    () => {
      const state = findState(manager, id);
      if (state?.status !== status) {
        throw new Error(`아직 ${status} 상태가 아님 (현재: ${state?.status})`);
      }
    },
    { timeout: 2000, interval: 5 },
  );
}

const chunkConfig = {
  chunkSizeBytes: 10,
  maxConcurrentChunks: 2,
  maxRetriesPerChunk: 1,
  retryBaseDelayMs: 1,
};
const validationConfig = {
  maxFileSizeBytes: 10_000,
  allowedExtensions: [],
  maxFiles: 10,
};

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input.toString();
}

describe("UploadManager", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("모든 청크가 성공하면 success 상태와 100% progress가 된다", async () => {
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
        if (method === "PUT" && /\/chunks\/\d+$/.test(url)) {
          return new Response(null, { status: 204 });
        }
        if (method === "POST" && /\/complete$/.test(url)) {
          return new Response(null, { status: 200 });
        }
        throw new Error(`unexpected request ${method} ${url}`);
      }),
    );

    const manager = new UploadManager(validationConfig, chunkConfig);
    manager.addFiles([makeFile("a.bin", 25)]); // 3 chunks
    const id = manager.getSnapshot()[0]!.id;

    await waitForStatus(manager, id, "success");

    const state = findState(manager, id)!;
    expect(state.progress).toBe(100);
    expect(state.completedChunks).toBe(3);
    expect(state.uploadedBytes).toBe(25);
  });

  it("청크가 재시도 후에도 계속 실패하면 error 상태가 된다", async () => {
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
        if (method === "PUT" && /\/chunks\/1$/.test(url)) {
          return new Response(null, { status: 500 });
        }
        if (method === "PUT" && /\/chunks\/\d+$/.test(url)) {
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected request ${method} ${url}`);
      }),
    );

    const manager = new UploadManager(validationConfig, chunkConfig);
    manager.addFiles([makeFile("b.bin", 25)]); // 3 chunks, index 1은 항상 실패
    const id = manager.getSnapshot()[0]!.id;

    await waitForStatus(manager, id, "error");

    const state = findState(manager, id)!;
    expect(state.error).toMatch("청크 업로드에 실패했습니다");
    expect(state.completedChunks).toBeLessThan(3);
  });

  it("cancel을 호출하면 canceled 상태로 유지되고 success/error로 바뀌지 않는다", async () => {
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
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (init?.signal?.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        if (method === "PUT") return new Response(null, { status: 204 });
        return new Response(null, { status: 200 });
      }),
    );

    const manager = new UploadManager(validationConfig, chunkConfig);
    manager.addFiles([makeFile("c.bin", 25)]);
    const id = manager.getSnapshot()[0]!.id;

    await waitForStatus(manager, id, "uploading");
    manager.cancel(id);

    expect(findState(manager, id)?.status).toBe("canceled");

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(findState(manager, id)?.status).toBe("canceled");
  });

  it("retry는 이미 성공한 청크를 다시 업로드하지 않는다", async () => {
    let chunk1ShouldFail = true;
    const putCalls: string[] = [];

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
        if (method === "PUT") {
          putCalls.push(url);
          if (/\/chunks\/1$/.test(url) && chunk1ShouldFail) {
            return new Response(null, { status: 500 });
          }
          return new Response(null, { status: 204 });
        }
        if (method === "POST" && /\/complete$/.test(url)) {
          return new Response(null, { status: 200 });
        }
        throw new Error(`unexpected request ${method} ${url}`);
      }),
    );

    const manager = new UploadManager(validationConfig, chunkConfig);
    manager.addFiles([makeFile("d.bin", 25)]); // 3 chunks
    const id = manager.getSnapshot()[0]!.id;

    await waitForStatus(manager, id, "error");
    const callsBeforeRetry = putCalls.filter((u) =>
      /\/chunks\/0$/.test(u),
    ).length;
    expect(callsBeforeRetry).toBeGreaterThan(0);

    chunk1ShouldFail = false;
    manager.retry(id);

    await waitForStatus(manager, id, "success");

    const chunk0CallsAfter = putCalls.filter((u) =>
      /\/chunks\/0$/.test(u),
    ).length;
    expect(chunk0CallsAfter).toBe(callsBeforeRetry); // 재업로드되지 않음
  });
});
