import type { RejectedFile, ValidationConfig } from "./types";
import { formatBytes } from "./formatBytes";

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

/** 파일 하나에 대한 검증. 문제가 없으면 null을 반환한다. */
export function validateFile(
  file: File,
  config: ValidationConfig,
): string | null {
  if (file.size === 0) {
    return "빈 파일은 업로드할 수 없습니다.";
  }
  if (file.size > config.maxFileSizeBytes) {
    return `파일 크기는 ${formatBytes(config.maxFileSizeBytes)}를 초과할 수 없습니다.`;
  }
  if (config.allowedExtensions.length > 0) {
    const ext = getExtension(file.name);
    if (!config.allowedExtensions.includes(ext)) {
      return `허용되지 않는 파일 형식입니다. (${config.allowedExtensions.join(", ")}만 허용)`;
    }
  }
  return null;
}

export interface BatchValidationResult {
  accepted: File[];
  rejected: RejectedFile[];
}

/**
 * 여러 파일을 한 번에 검증한다. 개수 제한은 배치 단위로 확인하고,
 * 같은 이름의 파일이 이미 대기열에 있으면 중복으로 거부한다.
 */
export function validateFiles(
  incoming: File[],
  existingFileNames: Set<string>,
  config: ValidationConfig,
): BatchValidationResult {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];
  const seenInBatch = new Set<string>();

  for (const file of incoming) {
    if (existingFileNames.has(file.name) || seenInBatch.has(file.name)) {
      rejected.push({ file, error: "이미 목록에 있는 파일입니다." });
      continue;
    }
    const error = validateFile(file, config);
    if (error) {
      rejected.push({ file, error });
      continue;
    }
    if (existingFileNames.size + accepted.length >= config.maxFiles) {
      rejected.push({
        file,
        error: `한 번에 최대 ${config.maxFiles}개까지 업로드할 수 있습니다.`,
      });
      continue;
    }
    seenInBatch.add(file.name);
    accepted.push(file);
  }

  return { accepted, rejected };
}
