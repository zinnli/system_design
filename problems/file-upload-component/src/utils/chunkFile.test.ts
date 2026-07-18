import { describe, expect, it } from "vitest";
import { chunkFile } from "./chunkFile";

function makeFile(sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], "big.bin");
}

describe("chunkFile", () => {
  it("파일 크기가 청크 크기의 배수이면 정확히 나눈다", () => {
    const chunks = chunkFile(makeFile(30), 10);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.size === 10)).toBe(true);
  });

  it("나머지가 있으면 마지막 청크가 더 작다", () => {
    const chunks = chunkFile(makeFile(25), 10);
    expect(chunks.map((c) => c.size)).toEqual([10, 10, 5]);
  });

  it("파일이 청크보다 작으면 청크 1개만 생긴다", () => {
    const chunks = chunkFile(makeFile(3), 10);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.size).toBe(3);
  });
});
