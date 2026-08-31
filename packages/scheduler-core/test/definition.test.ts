import { describe, expect, it } from "vitest";
import {
  createScheduleOccurrenceId,
  defineSchedule,
  resolveScheduleParameters
} from "@nest-batch/scheduler-core";

describe("schedule definition / schedule definition을 검증한다", () => {
  it("normalizes schedule defaults and occurrence ids / schedule 기본값과 occurrence id를 정규화한다", () => {
    const scheduledAt = new Date("2026-01-01T00:00:00.000Z");
    const schedule = defineSchedule({
      name: "billing.every-minute",
      jobName: "billing",
      trigger: { getDueOccurrences: () => [scheduledAt] }
    });

    expect(schedule.misfirePolicy).toBe("fire-once");
    expect(schedule.maxCatchUpOccurrences).toBe(1);
    expect(createScheduleOccurrenceId(schedule.name, scheduledAt)).toBe(
      "schedule:billing.every-minute:2026-01-01T00:00:00.000Z"
    );
    expect(
      resolveScheduleParameters(
        schedule,
        createScheduleOccurrenceId(schedule.name, scheduledAt),
        scheduledAt
      )
    ).toEqual({});
  });

  it("resolves parameter factories / parameter factory를 실행한다", () => {
    const scheduledAt = new Date("2026-01-02T03:04:05.000Z");
    const occurrenceId = "schedule:billing.daily:2026-01-02T03:04:05.000Z";
    const schedule = defineSchedule({
      name: "billing.daily",
      jobName: "billing",
      trigger: { getDueOccurrences: () => [scheduledAt] },
      parameters: ({ scheduledAt: value, occurrenceId: id }) => ({
        billingDate: value.toISOString().slice(0, 10),
        occurrenceId: id
      })
    });

    expect(resolveScheduleParameters(schedule, occurrenceId, scheduledAt)).toEqual({
      billingDate: "2026-01-02",
      occurrenceId
    });
  });

  it("rejects invalid schedule names / 유효하지 않은 schedule 이름을 거부한다", () => {
    expect(() =>
      defineSchedule({
        name: " ",
        jobName: "billing",
        trigger: { getDueOccurrences: () => [] }
      })
    ).toThrow("Schedule name is required.");
  });
});
