import { useState } from "react";
import { networkSimulation } from "../mocks/handlers";

/**
 * 데모 전용 패널. 실제 제품 코드였다면 존재할 이유가 없지만, 스터디에서
 * 재시도/에러 UI가 실제로 동작하는 모습을 보여주려면 실패율을 그 자리에서
 * 조절할 수 있어야 해서 추가했다.
 */
export function NetworkSimulationPanel() {
  const [failureRate, setFailureRate] = useState(
    networkSimulation.failureRatePercent,
  );

  return (
    <div className="network-panel">
      <label className="network-panel__label">
        청크 실패율 시뮬레이션: {failureRate}%
        <input
          type="range"
          min={0}
          max={100}
          value={failureRate}
          onChange={(event) => {
            const value = Number(event.target.value);
            setFailureRate(value);
            networkSimulation.failureRatePercent = value;
          }}
        />
      </label>
      <p className="network-panel__hint">
        값을 높이면 청크 업로드가 자주 실패해 자동 재시도와 에러/수동 재시도
        UI를 바로 확인할 수 있습니다.
      </p>
    </div>
  );
}
