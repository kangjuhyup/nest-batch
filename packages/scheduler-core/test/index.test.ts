import { describe, expect, it } from "vitest";
import { SchedulerLoop as CoreSchedulerLoop } from "@nest-batch/core/scheduler";
import { SchedulerLoop } from "@nest-batch/scheduler-core";
import type { ScheduleTrigger } from "@nest-batch/scheduler-core";

describe("scheduler-core compatibility wrapper / scheduler-core 호환성 wrapper를 검증한다", () => {
  it("re-exports the core scheduler API / core scheduler API를 재수출한다", () => {
    const trigger: ScheduleTrigger = { getDueOccurrences: () => [] };

    expect(trigger).toBeDefined();
    expect(SchedulerLoop).toBe(CoreSchedulerLoop);
  });
});
