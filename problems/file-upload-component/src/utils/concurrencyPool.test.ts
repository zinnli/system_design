import { describe, expect, it } from "vitest";
import { createConcurrencyPool } from "./concurrencyPool";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ConcurrencyPool", () => {
  it("동시 실행 개수가 limit을 넘지 않는다", async () => {
    const pool = createConcurrencyPool(2);
    let current = 0;
    let max = 0;

    const task = async () => {
      current += 1;
      max = Math.max(max, current);
      await sleep(10);
      current -= 1;
    };

    await Promise.all(Array.from({ length: 6 }, () => pool.run(task)));

    expect(max).toBeLessThanOrEqual(2);
  });

  it("모든 task가 결국 실행된다", async () => {
    const pool = createConcurrencyPool(1);
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3].map((n) =>
        pool.run(async () => {
          order.push(n);
        }),
      ),
    );

    expect(order.sort()).toEqual([1, 2, 3]);
  });

  it("task의 반환값을 그대로 전달한다", async () => {
    const pool = createConcurrencyPool(3);
    const result = await pool.run(async () => 42);
    expect(result).toBe(42);
  });

  it("task가 실패해도 슬롯을 반납한다", async () => {
    const pool = createConcurrencyPool(1);

    await expect(
      pool.run(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");

    const result = await pool.run(async () => "ok");
    expect(result).toBe("ok");
  });
});
