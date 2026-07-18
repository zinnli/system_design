import type { RejectedFile } from "../engine/types";

interface RejectionListProps {
  rejections: RejectedFile[];
}

/** 검증에서 거부된 파일들을 사유와 함께 보여준다. */
export function RejectionList({ rejections }: RejectionListProps) {
  if (rejections.length === 0) return null;

  return (
    <ul className="rejection-list">
      {rejections.map(({ file, error }, index) => (
        <li key={`${index}-${file.name}`}>
          <strong>{file.name}</strong>: {error}
        </li>
      ))}
    </ul>
  );
}
