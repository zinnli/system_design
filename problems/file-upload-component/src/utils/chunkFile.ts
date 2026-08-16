/**
 * File을 고정 크기 Blob 목록으로 나눈다. Blob.slice는 데이터를 복사하지 않고
 * 참조 범위만 기록하므로, 파일이 아무리 커도 이 시점에 메모리 부담이 없다.
 */
export function chunkFile(file: File, chunkSizeBytes: number): Blob[] {
  const chunks: Blob[] = [];
  for (let offset = 0; offset < file.size; offset += chunkSizeBytes) {
    chunks.push(file.slice(offset, offset + chunkSizeBytes));
  }
  return chunks;
}
