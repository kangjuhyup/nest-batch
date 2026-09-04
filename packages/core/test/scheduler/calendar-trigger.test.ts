import { describe, expect, it } from "vitest";
import {
  createUtcDailyTrigger,
  createUtcMonthlyTrigger,
  createUtcWeeklyTrigger
} from "@nest-batch/core/scheduler";

describe("UTC calendar triggers / UTC calendar trigger를 검증한다", () => {
  it("returns daily occurrences after durable state / durable state 이후 daily occurrence를 반환한다", () => {
    const trigger = createUtcDailyTrigger({
      startAt: new Date("2026-01-01T00:00:00.000Z"),
      time: { hour: 9, minute: 30 }
    });

    const occurrences = trigger.getDueOccurrences({
      after: new Date("2026-01-02T09:30:00.000Z"),
      now: new Date("2026-01-03T10:00:00.000Z")
    });

    expect(occurrences).toEqual([new Date("2026-01-03T09:30:00.000Z")]);
  });

  it("returns selected weekdays only / 선택한 weekday만 반환한다", () => {
    const trigger = createUtcWeeklyTrigger({
      startAt: new Date("2026-01-01T00:00:00.000Z"),
      daysOfWeek: [1, 3],
      time: { hour: 9 }
    });

    const occurrences = trigger.getDueOccurrences({
      now: new Date("2026-01-08T00:00:00.000Z")
    });

    expect(occurrences).toEqual([
      new Date("2026-01-05T09:00:00.000Z"),
      new Date("2026-01-07T09:00:00.000Z")
    ]);
  });

  it("skips invalid month days / 존재하지 않는 month day를 건너뛴다", () => {
    const trigger = createUtcMonthlyTrigger({
      startAt: new Date("2026-01-01T00:00:00.000Z"),
      daysOfMonth: [31],
      time: { hour: 1 }
    });

    const occurrences = trigger.getDueOccurrences({
      now: new Date("2026-03-31T01:00:00.000Z")
    });

    expect(occurrences).toEqual([
      new Date("2026-01-31T01:00:00.000Z"),
      new Date("2026-03-31T01:00:00.000Z")
    ]);
  });

  it("rejects invalid calendar options / 잘못된 calendar option을 거부한다", () => {
    expect(() =>
      createUtcDailyTrigger({
        startAt: new Date("2026-01-01T00:00:00.000Z"),
        time: { hour: 24 }
      })
    ).toThrow(/hour/i);
    expect(() =>
      createUtcWeeklyTrigger({
        startAt: new Date("2026-01-01T00:00:00.000Z"),
        daysOfWeek: [],
        time: { hour: 9 }
      })
    ).toThrow(/daysOfWeek/i);
    expect(() =>
      createUtcMonthlyTrigger({
        startAt: new Date("2026-01-01T00:00:00.000Z"),
        daysOfMonth: [0],
        time: { hour: 9 }
      })
    ).toThrow(/daysOfMonth/i);
  });
});
