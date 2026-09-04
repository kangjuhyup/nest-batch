import { describe, expect, it } from "vitest";
import { createUtcDailyTrigger as createCoreUtcDailyTrigger } from "@nest-batch/core/scheduler";
import { createUtcDailyTrigger } from "@nest-batch/scheduler-calendar";
import type { UtcTimeOfDay } from "@nest-batch/scheduler-calendar";

describe("scheduler-calendar compatibility wrapper / scheduler-calendar 호환성 wrapper를 검증한다", () => {
  it("re-exports calendar triggers from core scheduler / core scheduler의 calendar trigger를 재수출한다", () => {
    const time: UtcTimeOfDay = { hour: 9 };

    expect(time).toEqual({ hour: 9 });
    expect(createUtcDailyTrigger).toBe(createCoreUtcDailyTrigger);
  });
});
