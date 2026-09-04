import { describe, expect, it } from "vitest";
import {
  SchedulerLoop,
  createIntervalTrigger,
  createUtcDailyTrigger,
  defineSchedule
} from "@nest-batch/core/scheduler";

describe("core scheduler subpath exports / core scheduler subpath export를 검증한다", () => {
  it("exports scheduler and calendar APIs / scheduler와 calendar API를 export한다", () => {
    expect(SchedulerLoop).toBeTypeOf("function");
    expect(createIntervalTrigger).toBeTypeOf("function");
    expect(createUtcDailyTrigger).toBeTypeOf("function");
    expect(defineSchedule).toBeTypeOf("function");
  });
});
