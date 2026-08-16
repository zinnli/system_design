/**
 * 데모용 네트워크 상태. UI의 "네트워크 시뮬레이션" 패널에서 직접 이 값을
 * 바꿔가며 재시도/에러 UI가 실제로 동작하는 모습을 시연할 수 있다.
 * (실제 서비스라면 서버가 알아서 결정할 값이라, 클라이언트 엔진 쪽 타입에는 넣지 않았다.)
 *
 * msw를 import하지 않는 별도 모듈로 분리했다 — NetworkSimulationPanel(항상
 * 렌더링되는 컴포넌트)이 이 값을 읽으려면 뭔가를 import해야 하는데, 그게
 * mocks/handlers.ts였다면 msw가 프로덕션 번들에도 딸려 들어가 main.tsx의
 * dev 전용 동적 import 게이팅이 무의미해진다.
 */
export const networkSimulation = {
  failureRatePercent: 10,
  minLatencyMs: 150,
  maxLatencyMs: 500,
};
