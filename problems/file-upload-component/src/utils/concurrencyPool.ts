/**
 * 여러 파일의 청크가 하나의 동시성 한도를 공유하도록 하는 세마포어.
 * 파일 단위가 아니라 청크 단위로 슬롯을 배분해, 대용량 파일 하나가
 * 네트워크 동시 연결을 독점하지 않도록 한다.
 */
export function createConcurrencyPool(limit: number) {
  if (limit < 1) {
    throw new Error("limit은 1 이상이어야 합니다.");
  }

  let running = 0;
  const queue: Array<() => void> = [];

  function acquire(): Promise<void> {
    if (running < limit) {
      running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      queue.push(() => {
        running += 1;
        resolve();
      });
    });
  }

  function release(): void {
    running -= 1;
    const next = queue.shift();
    if (next) next();
  }

  async function run<T>(task: () => Promise<T>): Promise<T> {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  }

  return { run };
}

export type ConcurrencyPool = ReturnType<typeof createConcurrencyPool>;
