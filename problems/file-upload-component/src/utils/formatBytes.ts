/** 바이트 수를 사람이 읽기 좋은 단위 문자열로 바꾼다 (예: 1536 → "1.5KB"). */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  // 소수점 첫째 자리까지 반올림. 정수가 되면 소수점 없이 표기된다 (1KB, 1.5KB).
  const rounded = Math.round((bytes / 1024 ** exponent) * 10) / 10;
  return `${rounded}${units[exponent]}`;
}
