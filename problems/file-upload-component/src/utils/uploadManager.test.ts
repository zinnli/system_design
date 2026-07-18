import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeUpload, initUpload, uploadChunk } from "./uploadApi";
import type { UploadManager } from "./uploadManager";
import { createUploadManager } from "./uploadManager";

// 네트워크 계층(axios)은 uploadApi 모듈 mock으로 대체한다.
// 엔진 테스트는 "어떤 API를 어떤 인자로 불렀는가"만 검증하면 충분하다.
vi.mock("./uploadApi", () => ({
  initUpload: vi.fn(),
  uploadChunk: vi.fn(),
  completeUpload: vi.fn(),
}));

const initUploadMock = vi.mocked(initUpload);
const uploadChunkMock = vi.mocked(uploadChunk);
const completeUploadMock = vi.mocked(completeUpload);

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/** uploadChunk mock 호출 중 특정 인덱스로 불린 횟수 */
function chunkCallCount(index: number): number {
  return uploadChunkMock.mock.calls.filter(([, i]) => i === index).length;
}

describe("uploadManager", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    initUploadMock.mockResolvedValue({ uploadId: "u1" });
    uploadChunkMock.mockResolvedValue(undefined);
    completeUploadMock.mockResolvedValue(undefined);
  });

  it("모든 청크가 성공하면 success 상태와 100% progress가 된다", async () => {
    const manager = createUploadManager(validationConfig, chunkConfig);
    manager.addFiles([makeFile("a.bin", 25)]); // 3 chunks
    const id = manager.getSnapshot()[0]!.id;

    await waitForStatus(manager, id, "success");

    const state = findState(manager, id)!;
    expect(state.progress).toBe(100);
    expect(state.completedChunks).toBe(3);
    expect(state.uploadedBytes).toBe(25);
    expect(uploadChunkMock).toHaveBeenCalledTimes(3);
    expect(completeUploadMock).toHaveBeenCalledWith("u1", expect.anything());
  });

  it("청크가 재시도 후에도 계속 실패하면 error 상태가 된다", async () => {
    uploadChunkMock.mockImplementation(async (_uploadId, index) => {
      if (index === 1) {
        throw new Error("청크 업로드에 실패했습니다. (status 500)");
      }
    });

    const manager = createUploadManager(validationConfig, chunkConfig);
    manager.addFiles([makeFile("b.bin", 25)]); // 3 chunks, index 1은 항상 실패
    const id = manager.getSnapshot()[0]!.id;

    await waitForStatus(manager, id, "error");

    const state = findState(manager, id)!;
    expect(state.error).toMatch("청크 업로드에 실패했습니다");
    expect(state.completedChunks).toBeLessThan(3);
    expect(completeUploadMock).not.toHaveBeenCalled();
  });

  it("cancel을 호출하면 canceled 상태로 유지되고 success/error로 바뀌지 않는다", async () => {
    uploadChunkMock.mockImplementation(
      async (_uploadId, _index, _chunk, signal) => {
        await sleep(50);
        if (signal.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
      },
    );

    const manager = createUploadManager(validationConfig, chunkConfig);
    manager.addFiles([makeFile("c.bin", 25)]);
    const id = manager.getSnapshot()[0]!.id;

    await waitForStatus(manager, id, "uploading");
    manager.cancel(id);

    expect(findState(manager, id)?.status).toBe("canceled");

    await sleep(100);
    expect(findState(manager, id)?.status).toBe("canceled");
  });

  it("queued 상태에서 cancel하면 업로드가 아예 시작되지 않는다", async () => {
    const manager = createUploadManager(validationConfig, chunkConfig);
    manager.addFiles([makeFile("i.bin", 25)]);
    const id = manager.getSnapshot()[0]!.id;

    // startUpload는 microtask로 예약된다 — 실행되기 전에 취소한다.
    manager.cancel(id);
    expect(findState(manager, id)?.status).toBe("canceled");

    await sleep(50);
    expect(findState(manager, id)?.status).toBe("canceled");
    expect(initUploadMock).not.toHaveBeenCalled();
    expect(uploadChunkMock).not.toHaveBeenCalled();
  });

  it("retry는 이미 성공한 청크를 다시 업로드하지 않는다", async () => {
    let chunk1ShouldFail = true;
    uploadChunkMock.mockImplementation(async (_uploadId, index) => {
      if (index === 1 && chunk1ShouldFail) {
        throw new Error("청크 업로드에 실패했습니다. (status 500)");
      }
    });

    const manager = createUploadManager(validationConfig, chunkConfig);
    manager.addFiles([makeFile("d.bin", 25)]); // 3 chunks
    const id = manager.getSnapshot()[0]!.id;

    await waitForStatus(manager, id, "error");
    const chunk0CallsBeforeRetry = chunkCallCount(0);
    expect(chunk0CallsBeforeRetry).toBeGreaterThan(0);

    chunk1ShouldFail = false;
    manager.retry(id);

    await waitForStatus(manager, id, "success");

    expect(chunkCallCount(0)).toBe(chunk0CallsBeforeRetry); // 재업로드되지 않음
    expect(initUploadMock).toHaveBeenCalledTimes(1); // uploadId도 재사용
  });

  it("파일을 추가하면 uploading으로 넘어가기 전에 queued 상태가 최소 한 번 관찰된다", async () => {
    const manager = createUploadManager(validationConfig, chunkConfig);
    const seenStatuses: string[] = [];
    manager.subscribe(() => {
      const state = manager.getSnapshot()[0];
      if (state) seenStatuses.push(state.status);
    });

    manager.addFiles([makeFile("h.bin", 10)]);
    const id = manager.getSnapshot()[0]!.id;
    await waitForStatus(manager, id, "success");

    expect(seenStatuses).toContain("queued");
  });

  it("완료된 파일은 remove()로 지울 수 있고, 지운 뒤에는 같은 이름을 다시 추가할 수 있다", async () => {
    const manager = createUploadManager(validationConfig, chunkConfig);
    manager.addFiles([makeFile("f.bin", 10)]);
    const id = manager.getSnapshot()[0]!.id;
    await waitForStatus(manager, id, "success");

    manager.remove(id);
    expect(manager.getSnapshot()).toHaveLength(0);

    const { rejected } = manager.addFiles([makeFile("f.bin", 10)]);
    expect(rejected).toHaveLength(0);
    expect(manager.getSnapshot()).toHaveLength(1);
  });

  it("업로드 중인 파일은 remove()로 지워지지 않는다", async () => {
    uploadChunkMock.mockImplementation(async () => {
      await sleep(50);
    });

    const manager = createUploadManager(validationConfig, chunkConfig);
    manager.addFiles([makeFile("g.bin", 25)]);
    const id = manager.getSnapshot()[0]!.id;
    await waitForStatus(manager, id, "uploading");

    manager.remove(id);
    expect(manager.getSnapshot()).toHaveLength(1);
  });

  it("completeUpload가 서버에서 이미 처리된 뒤 취소가 겹쳐도 success로 확정된다", async () => {
    let resolveComplete: (() => void) | null = null;
    // 서버는 이미 파일을 완성했다고 가정하고, cancel()이 abort()를
    // 호출한 뒤에야 응답이 도착하는 상황을 흉내낸다 (signal 무시).
    completeUploadMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveComplete = resolve;
        }),
    );

    const manager = createUploadManager(validationConfig, chunkConfig);
    manager.addFiles([makeFile("e.bin", 25)]);
    const id = manager.getSnapshot()[0]!.id;

    await vi.waitFor(
      () => {
        if (!resolveComplete) throw new Error("complete 호출 대기 중");
      },
      { timeout: 2000, interval: 5 },
    );

    manager.cancel(id);
    expect(findState(manager, id)?.status).toBe("canceled");

    resolveComplete!();

    await waitForStatus(manager, id, "success");
  });
});
