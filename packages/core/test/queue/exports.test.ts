import { describe, expect, it } from "vitest";
import { WorkerLoop } from "@rv-nest-batch/core/queue";
import type { WorkQueue, WorkUnit } from "@rv-nest-batch/core/queue";

describe("core queue subpath exports / core queue subpath export를 검증한다", () => {
  it("exports queue contracts and worker loop / queue contract와 worker loop를 export한다", () => {
    const queue: WorkQueue = {
      enqueue: async (_work: WorkUnit) => undefined,
      claim: async () => undefined,
      complete: async () => undefined,
      fail: async () => undefined
    };

    expect(queue).toBeDefined();
    expect(WorkerLoop).toBeTypeOf("function");
  });
});
