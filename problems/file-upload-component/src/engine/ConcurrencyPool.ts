/**
 * 여러 파일의 청크가 하나의 동시성 한도를 공유하도록 하는 세마포어.
 * 파일 단위가 아니라 청크 단위로 슬롯을 배분해, 대용량 파일 하나가
 * 네트워크 동시 연결을 독점하지 않도록 한다.
 */
export class ConcurrencyPool {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (limit < 1) {
      throw new Error("limit은 1 이상이어야 합니다.");
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.running += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.running -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}
