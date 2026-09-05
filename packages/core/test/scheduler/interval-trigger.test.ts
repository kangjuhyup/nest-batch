import { describe, expect, it } from "vitest";
import { createIntervalTrigger } from "@rvkang/batch-core/scheduler";

describe("interval schedule trigger / interval schedule trigger를 검증한다", () => {
  it("returns due occurrences after durable state / durable state 이후 due occurrence를 반환한다", () => {
    const trigger = createIntervalTrigger({
      everyMs: 60_000,
      startAt: new Date("2026-01-01T00:00:00.000Z")
    });

    expect(
      trigger.getDueOccurrences({
        after: new Date("2026-01-01T00:01:00.000Z"),
        now: new Date("2026-01-01T00:04:00.000Z")
      })
    ).toEqual([
      new Date("2026-01-01T00:02:00.000Z"),
      new Date("2026-01-01T00:03:00.000Z"),
      new Date("2026-01-01T00:04:00.000Z")
    ]);
  });

  it("rejects invalid intervals / 유효하지 않은 interval을 거부한다", () => {
    expect(() =>
      createIntervalTrigger({
        everyMs: 0,
        startAt: new Date("2026-01-01T00:00:00.000Z")
      })
    ).toThrow("Interval trigger everyMs must be a positive safe integer.");
  });
});
