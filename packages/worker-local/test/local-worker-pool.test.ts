import { describe, expect, it } from "vitest";
import { LocalWorkerPool } from "../src/index.js";

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("local worker pool / local worker pool", () => {
  it("limits concurrent tasks / 동시에 실행되는 task 수를 제한한다", async () => {
    const pool = new LocalWorkerPool({ capacity: 2 });
    const activeCounts: number[] = [];
    let active = 0;

    try {
      await Promise.all(
        Array.from({ length: 5 }, () =>
          pool.run(async () => {
            active += 1;
            activeCounts.push(active);

            try {
              await delay(10);
            } finally {
              active -= 1;
            }
          })
        )
      );
    } finally {
      await pool.close();
    }

    expect(Math.max(...activeCounts)).toBe(2);
  });

  it("rejects queued tasks when aborted / 대기 중인 task가 abort되면 거부한다", async () => {
    const pool = new LocalWorkerPool({ capacity: 1 });
    const queuedTaskController = new AbortController();

    try {
      const running = pool.run(async () => {
        await delay(20);
      });
      const queued = pool.run(async () => "queued", queuedTaskController.signal);

      queuedTaskController.abort();

      await expect(queued).rejects.toThrow("The operation was aborted.");
      await running;
    } finally {
      await pool.close();
    }
  });
});
