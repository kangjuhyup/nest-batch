import { describe, expect, it } from "vitest";
import { WorkerThreadPool as CoreWorkerThreadPool } from "@nest-batch/core/worker";
import { WorkerThreadPool } from "@nest-batch/worker-threads";
import type { WorkerThreadPoolOptions, WorkerThreadTask } from "@nest-batch/worker-threads";

describe("worker-threads compatibility wrapper / worker-threads 호환성 wrapper를 검증한다", () => {
  it("re-exports the worker thread pool / worker thread pool을 재수출한다", () => {
    const options: WorkerThreadPoolOptions = { capacity: 1 };
    const task: WorkerThreadTask = { moduleUrl: "file:///worker.mjs" };

    expect(options).toEqual({ capacity: 1 });
    expect(task.moduleUrl).toBe("file:///worker.mjs");
    expect(WorkerThreadPool).toBe(CoreWorkerThreadPool);
  });
});
