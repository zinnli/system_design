import { describe, expect, it } from "vitest";
import type { ValidationConfig } from "./types";
import { formatBytes, validateFile, validateFiles } from "./validateFile";

const config: ValidationConfig = {
  maxFileSizeBytes: 1024,
  allowedExtensions: [".png", ".jpg"],
  maxFiles: 3,
};

function makeFile(name: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name);
}

describe("validateFile", () => {
  it("빈 파일을 거부한다", () => {
    expect(validateFile(makeFile("a.png", 0), config)).toMatch("빈 파일");
  });

  it("허용 크기를 초과하면 거부한다", () => {
    expect(validateFile(makeFile("a.png", 2048), config)).toMatch(
      "초과할 수 없습니다",
    );
  });

  it("허용되지 않은 확장자를 거부한다", () => {
    expect(validateFile(makeFile("a.exe", 10), config)).toMatch(
      "허용되지 않는 파일 형식",
    );
  });

  it("조건을 만족하면 null을 반환한다", () => {
    expect(validateFile(makeFile("a.png", 10), config)).toBeNull();
  });
});

describe("validateFiles", () => {
  it("이미 존재하는 파일명을 중복으로 거부한다", () => {
    const result = validateFiles(
      [makeFile("dup.png", 10)],
      new Set(["dup.png"]),
      config,
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]?.error).toMatch("이미 목록");
  });

  it("배치 내 중복 파일명도 거부한다", () => {
    const result = validateFiles(
      [makeFile("same.png", 10), makeFile("same.png", 10)],
      new Set(),
      config,
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });

  it("최대 개수를 초과하면 넘치는 파일을 거부한다", () => {
    const result = validateFiles(
      [
        makeFile("a.png", 10),
        makeFile("b.png", 10),
        makeFile("c.png", 10),
        makeFile("d.png", 10),
      ],
      new Set(["existing.png", "existing2.png"]),
      config,
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(3);
  });
});

describe("formatBytes", () => {
  it("단위를 사람이 읽기 좋은 형태로 변환한다", () => {
    expect(formatBytes(0)).toBe("0B");
    expect(formatBytes(1024)).toBe("1KB");
    expect(formatBytes(1536)).toBe("1.5KB");
  });
});
