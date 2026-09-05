import { describe, expect, it } from "vitest";
import * as schedulerCore from "@rvkang/batch-core/scheduler";
import type {
  ScheduleDefinition,
  ScheduleDispatcher,
  ScheduleOccurrence,
  ScheduleStore,
  ScheduleTrigger
} from "@rvkang/batch-core/scheduler";

describe("scheduler core type exports / scheduler core type export를 검증한다", () => {
  it("exports scheduler contracts / scheduler contract를 export한다", async () => {
    const trigger: ScheduleTrigger = {
      getDueOccurrences({ now }) {
        return [now];
      }
    };
    const schedule: ScheduleDefinition = {
      name: "billing.every-minute",
      jobName: "billing",
      trigger,
      misfirePolicy: "fire-once"
    };
    const occurrence: ScheduleOccurrence = {
      scheduleName: schedule.name,
      occurrenceId: "schedule:billing.every-minute:2026-01-01T00:00:00.000Z",
      scheduledAt: new Date("2026-01-01T00:00:00.000Z"),
      status: "claimed",
      ownerId: "scheduler-1",
      claimedAt: new Date("2026-01-01T00:00:01.000Z")
    };
    const store: ScheduleStore = {
      async findLatestOccurrence() {
        return occurrence;
      },
      async listOccurrences() {
        return [occurrence];
      },
      async claimOccurrence(candidate) {
        return { ...candidate, status: "claimed", ownerId: "scheduler-1" };
      },
      async markDispatched() {
        return true;
      },
      async markFailed() {
        return true;
      }
    };
    const dispatcher: ScheduleDispatcher = async () => undefined;

    expect(schedulerCore).toBeDefined();
    expect(schedule.jobName).toBe("billing");
    expect(await store.findLatestOccurrence(schedule.name)).toBe(occurrence);
    await expect(store.listOccurrences({ status: "claimed" })).resolves.toEqual([occurrence]);
    await expect(
      dispatcher({ schedule, occurrence, signal: new AbortController().signal })
    ).resolves.toBeUndefined();
  });
});
