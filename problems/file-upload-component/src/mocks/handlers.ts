import { delay, http, HttpResponse } from "msw";

/**
 * 데모용 네트워크 상태. UI의 "네트워크 시뮬레이션" 패널에서 직접 이 값을
 * 바꿔가며 재시도/에러 UI가 실제로 동작하는 모습을 시연할 수 있다.
 * (실제 서비스라면 서버가 알아서 결정할 값이라, 클라이언트 엔진 쪽 타입에는 넣지 않았다.)
 */
export const networkSimulation = {
  failureRatePercent: 10,
  minLatencyMs: 150,
  maxLatencyMs: 500,
};

function randomLatency(): number {
  const { minLatencyMs, maxLatencyMs } = networkSimulation;
  return minLatencyMs + Math.random() * (maxLatencyMs - minLatencyMs);
}

function shouldSimulateFailure(): boolean {
  return Math.random() * 100 < networkSimulation.failureRatePercent;
}

let uploadSequence = 0;

export const handlers = [
  http.post("/api/uploads", async () => {
    await delay(randomLatency());
    uploadSequence += 1;
    return HttpResponse.json(
      { uploadId: `upload-${uploadSequence}-${Date.now()}` },
      { status: 200 },
    );
  }),

  http.put("/api/uploads/:uploadId/chunks/:index", async ({ request }) => {
    await delay(randomLatency());
    if (shouldSimulateFailure()) {
      return new HttpResponse(null, { status: 500 });
    }
    await request.arrayBuffer(); // 청크 바디를 실제로 소비해 전송을 흉내낸다
    return new HttpResponse(null, { status: 204 });
  }),

  http.post("/api/uploads/:uploadId/complete", async () => {
    await delay(randomLatency());
    return HttpResponse.json({ ok: true }, { status: 200 });
  }),
];
