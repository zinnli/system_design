interface ProgressBarProps {
  percent: number;
  tone?: "normal" | "success" | "error";
}

export function ProgressBar({ percent, tone = "normal" }: ProgressBarProps) {
  return (
    <div
      className="progress-bar"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`progress-bar__fill progress-bar__fill--${tone}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
