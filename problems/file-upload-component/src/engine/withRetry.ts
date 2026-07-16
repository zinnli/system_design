function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 실패 시 지수 백오프로 재시도한다. abort된 경우에는 재시도하지 않고 즉시 던진다. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number,
  signal: AbortSignal,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (signal.aborted || attempt >= maxRetries) {
        throw err;
      }
      attempt += 1;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
}
