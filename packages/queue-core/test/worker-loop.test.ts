import { describe, expect, it } from "vitest";
import { WorkerLoop } from "../src/index.js";
import type { WorkClaimOptions, WorkQueue, WorkUnit } from "../src/index.js";

class InMemoryWorkQueue<TWork extends WorkUnit = WorkUnit> implements WorkQueue<TWork> {
  readonly completed: string[] = [];
  readonly failed: Array<{ readonly id: string; readonly error: unknown }> = [];
  readonly claims: WorkClaimOptions[] = [];
  private readonly pending: TWork[];

  constructor(work: readonly TWork[] = []) {
    this.pending = [...work];
  }

  async enqueue(work: TWork): Promise<void> {
    this.pending.push(work);
  }

  async claim(options: WorkClaimOptions): Promise<TWork | undefined> {
    this.claims.push(options);
    return this.pending.shift();
  }

  async complete(work: TWork): Promise<void> {
    this.completed.push(work.id);
  }

  async fail(work: TWork, error: unknown): Promise<void> {
    this.failed.push({ id: work.id, error });
  }
}

const createWorkUnit = (id: string): WorkUnit => ({ id, type: "test" });

describe("worker loop / worker loop", () => {
  it("claims, runs, and completes queued work / queue work를 claim, 실행, 완료한다", async () => {
    const queue = new InMemoryWorkQueue([createWorkUnit("work-1")]);
    const completed: string[] = [];
    const loop = new WorkerLoop({
      queue,
      workerId: "worker-1",
      now: () => new Date("2026-07-25T00:00:00.000Z"),
      handler: (work) => {
        completed.push(work.id);
      }
    });

    await expect(loop.runOnce()).resolves.toBe(true);

    expect(completed).toEqual(["work-1"]);
    expect(queue.completed).toEqual(["work-1"]);
    expect(queue.claims).toMatchObject([
      {
        workerId: "worker-1",
        now: new Date("2026-07-25T00:00:00.000Z")
      }
    ]);
  });

  it("returns false when no work is claimed / claim할 work가 없으면 false를 반환한다", async () => {
    const queue = new InMemoryWorkQueue();
    const loop = new WorkerLoop({
      queue,
      workerId: "worker-1",
      handler: () => undefined
    });

    await expect(loop.runOnce()).resolves.toBe(false);
    expect(queue.completed).toEqual([]);
  });

  it("marks failed work and rethrows handler errors / handler 오류를 실패 처리하고 다시 던진다", async () => {
    const queue = new InMemoryWorkQueue([createWorkUnit("work-1")]);
    const error = new Error("handler failed");
    const loop = new WorkerLoop({
      queue,
      workerId: "worker-1",
      handler: () => {
        throw error;
      }
    });

    await expect(loop.runOnce()).rejects.toThrow("handler failed");
    expect(queue.completed).toEqual([]);
    expect(queue.failed).toEqual([{ id: "work-1", error }]);
  });

  it("stops runUntilStopped when aborted / abort되면 runUntilStopped를 중단한다", async () => {
    const queue = new InMemoryWorkQueue();
    const controller = new AbortController();
    const loop = new WorkerLoop({
      queue,
      workerId: "worker-1",
      pollIntervalMs: 100,
      handler: () => undefined
    });

    const running = loop.runUntilStopped({ signal: controller.signal });
    controller.abort();

    await expect(running).resolves.toBeUndefined();
  });
});
