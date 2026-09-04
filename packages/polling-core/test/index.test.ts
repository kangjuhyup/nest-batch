import { describe, expect, it } from "vitest";
import { ContinuousPollingLoop as CoreContinuousPollingLoop } from "@nest-batch/core/polling";
import { ContinuousPollingLoop } from "@nest-batch/polling-core";
import type { PollingTask } from "@nest-batch/polling-core";

describe("polling-core compatibility wrapper / polling-core 호환성 wrapper를 검증한다", () => {
  it("re-exports the core polling API / core polling API를 재수출한다", () => {
    const task: PollingTask = () => 0;

    expect(task).toBeTypeOf("function");
    expect(ContinuousPollingLoop).toBe(CoreContinuousPollingLoop);
  });
});
