import { describe, expect, it, vi } from "vitest";
import { withRetry } from "./withRetry";

describe("withRetry", () => {
  it("성공하면 재시도하지 않는다", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, 3, 1, new AbortController().signal);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("실패하면 maxRetries 횟수만큼 재시도 후 성공할 수 있다", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail1"))
      .mockRejectedValueOnce(new Error("fail2"))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, 3, 1, new AbortController().signal);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("maxRetries를 넘기면 마지막 에러를 던진다", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("항상 실패"));
    await expect(
      withRetry(fn, 2, 1, new AbortController().signal),
    ).rejects.toThrow("항상 실패");
    expect(fn).toHaveBeenCalledTimes(3); // 최초 시도 + 재시도 2회
  });

  it("abort된 경우 즉시 중단한다", async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    await expect(withRetry(fn, 5, 1, controller.signal)).rejects.toThrow(
      "fail",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
