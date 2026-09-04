import { describe, expect, it } from "vitest";
import { LocalWorkerPool as CoreLocalWorkerPool } from "@nest-batch/core/worker";
import { LocalWorkerPool } from "@nest-batch/worker-local";
import type { LocalWorkerPoolOptions } from "@nest-batch/worker-local";

describe("worker-local compatibility wrapper / worker-local 호환성 wrapper를 검증한다", () => {
  it("re-exports the local worker pool / local worker pool을 재수출한다", () => {
    const options: LocalWorkerPoolOptions = { capacity: 1 };

    expect(options).toEqual({ capacity: 1 });
    expect(LocalWorkerPool).toBe(CoreLocalWorkerPool);
  });
});
