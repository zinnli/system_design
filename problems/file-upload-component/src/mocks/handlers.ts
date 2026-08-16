import { delay, http, HttpResponse } from "msw";
import { networkSimulation } from "./networkSimulationConfig";

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
