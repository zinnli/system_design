import { describe, expect, it } from "vitest";
import { formatBytes } from "./formatBytes";

describe("formatBytes", () => {
  it("단위를 사람이 읽기 좋은 형태로 변환한다", () => {
    expect(formatBytes(0)).toBe("0B");
    expect(formatBytes(1024)).toBe("1KB");
    expect(formatBytes(1536)).toBe("1.5KB");
  });
});
