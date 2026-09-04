import { describe, expect, it } from "vitest";
import { WorkerLoop as CoreWorkerLoop } from "@nest-batch/core/queue";
import { WorkerLoop } from "@nest-batch/queue-core";
import type { WorkQueue, WorkUnit } from "@nest-batch/queue-core";

describe("queue-core compatibility wrapper / queue-core 호환성 wrapper를 검증한다", () => {
  it("re-exports the core queue API / core queue API를 재수출한다", () => {
    const queue: WorkQueue = {
      enqueue: async (_work: WorkUnit) => undefined,
      claim: async () => undefined,
      complete: async () => undefined,
      fail: async () => undefined
    };

    expect(queue).toBeDefined();
    expect(WorkerLoop).toBe(CoreWorkerLoop);
  });
});
