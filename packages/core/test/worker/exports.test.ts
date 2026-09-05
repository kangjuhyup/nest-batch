import { describe, expect, it } from "vitest";
import { LocalWorkerPool, WorkerThreadPool } from "@rv-nest-batch/core/worker";

describe("core worker subpath exports / core worker subpath export를 검증한다", () => {
  it("exports local and thread worker pools / local과 thread worker pool을 export한다", () => {
    expect(LocalWorkerPool).toBeTypeOf("function");
    expect(WorkerThreadPool).toBeTypeOf("function");
  });
});
