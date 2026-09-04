import { availableParallelism } from "node:os";
import { describe, expect, it } from "vitest";
import { WorkerThreadPool } from "@nest-batch/core/worker";

const fixtureUrl = (name: string): string => new URL(`./fixtures/${name}`, import.meta.url).href;
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("worker thread pool / worker thread pool", () => {
  it("uses available parallelism for default capacity / 기본 capacity를 availableParallelism으로 계산한다", async () => {
    const pool = new WorkerThreadPool();

    try {
      expect(pool.capacity).toBe(Math.max(1, availableParallelism() - 1));
    } finally {
      await pool.close();
    }
  });

  it("runs CPU tasks in worker threads / CPU 작업을 worker thread에서 실행한다", async () => {
    const pool = new WorkerThreadPool({ capacity: 2 });

    try {
      const result = await pool.run<{ readonly n: number }, { readonly value: number }>({
        moduleUrl: fixtureUrl("fibonacci-worker.mjs"),
        payload: { n: 10 }
      });

      expect(result).toEqual({ value: 55 });
    } finally {
      await pool.close();
    }
  });

  it("limits concurrent worker threads / worker thread 동시 실행 수를 제한한다", async () => {
    const pool = new WorkerThreadPool({ capacity: 2 });
    const startedAt = performance.now();

    try {
      await Promise.all(
        Array.from({ length: 4 }, () =>
          pool.run({
            moduleUrl: fixtureUrl("slow-worker.mjs"),
            payload: { delayMs: 30 }
          })
        )
      );
    } finally {
      await pool.close();
    }

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(50);
  });

  it("rejects queued tasks when aborted / 대기 중인 task가 abort되면 거부한다", async () => {
    const pool = new WorkerThreadPool({ capacity: 1 });
    const queuedController = new AbortController();

    try {
      const running = pool.run({
        moduleUrl: fixtureUrl("slow-worker.mjs"),
        payload: { delayMs: 40 }
      });
      const queued = pool.run(
        {
          moduleUrl: fixtureUrl("fibonacci-worker.mjs"),
          payload: { n: 10 }
        },
        queuedController.signal
      );

      queuedController.abort();

      await expect(queued).rejects.toThrow("The operation was aborted.");
      await running;
    } finally {
      await pool.close();
    }
  });

  it("terminates running tasks when aborted / 실행 중인 task가 abort되면 worker를 종료한다", async () => {
    const pool = new WorkerThreadPool({ capacity: 1 });
    const controller = new AbortController();

    try {
      const running = pool.run(
        {
          moduleUrl: fixtureUrl("slow-worker.mjs"),
          payload: { delayMs: 100 }
        },
        controller.signal
      );

      await delay(10);
      controller.abort();

      await expect(running).rejects.toThrow("The operation was aborted.");
    } finally {
      await pool.close();
    }
  });
});
