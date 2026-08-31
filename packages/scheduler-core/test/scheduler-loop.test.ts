import { describe, expect, it } from "vitest";
import type { LockHandle, LockManager } from "@nest-batch/core";
import type {
  ScheduleDispatcher,
  ScheduleOccurrence,
  ScheduleOccurrenceCandidate,
  ScheduleStore
} from "@nest-batch/scheduler-core";
import { SchedulerLoop, createIntervalTrigger, defineSchedule } from "@nest-batch/scheduler-core";

describe("scheduler loop / scheduler loop를 검증한다", () => {
  it("claims and dispatches due occurrences / due occurrence를 claim하고 dispatch한다", async () => {
    const store = new FakeScheduleStore();
    const lockManager = new FakeLockManager();
    const dispatched: string[] = [];
    const dispatcher: ScheduleDispatcher = async ({ occurrence }) => {
      dispatched.push(occurrence.occurrenceId);
    };
    const loop = new SchedulerLoop({
      schedules: [
        defineSchedule({
          name: "billing.every-minute",
          jobName: "billing",
          trigger: createIntervalTrigger({
            everyMs: 60_000,
            startAt: new Date("2026-01-01T00:00:00.000Z")
          })
        })
      ],
      store,
      lockManager,
      dispatcher,
      ownerId: "scheduler-1",
      now: () => new Date("2026-01-01T00:00:00.000Z")
    });

    const result = await loop.tick();

    expect(result).toEqual({
      scannedSchedules: 1,
      claimedOccurrences: 1,
      dispatchedOccurrences: 1,
      failedOccurrences: 0
    });
    expect(dispatched).toEqual(["schedule:billing.every-minute:2026-01-01T00:00:00.000Z"]);
    expect(store.latest("billing.every-minute")?.status).toBe("dispatched");
  });

  it("does not dispatch without schedule lock / schedule lock이 없으면 dispatch하지 않는다", async () => {
    const store = new FakeScheduleStore();
    const lockManager = new FakeLockManager({ deny: true });
    const dispatched: string[] = [];
    const loop = new SchedulerLoop({
      schedules: [
        defineSchedule({
          name: "billing.every-minute",
          jobName: "billing",
          trigger: createIntervalTrigger({
            everyMs: 60_000,
            startAt: new Date("2026-01-01T00:00:00.000Z")
          })
        })
      ],
      store,
      lockManager,
      dispatcher: async ({ occurrence }) => {
        dispatched.push(occurrence.occurrenceId);
      },
      ownerId: "scheduler-1",
      now: () => new Date("2026-01-01T00:00:00.000Z")
    });

    await expect(loop.tick()).resolves.toMatchObject({ scannedSchedules: 1, claimedOccurrences: 0 });
    expect(dispatched).toEqual([]);
  });

  it("applies fire all catch up limits / fire all catch up 상한을 적용한다", async () => {
    const store = new FakeScheduleStore();
    const dispatched: string[] = [];
    const loop = new SchedulerLoop({
      schedules: [
        defineSchedule({
          name: "billing.catch-up",
          jobName: "billing",
          trigger: createIntervalTrigger({
            everyMs: 60_000,
            startAt: new Date("2026-01-01T00:00:00.000Z")
          }),
          misfirePolicy: "fire-all",
          maxCatchUpOccurrences: 2
        })
      ],
      store,
      lockManager: new FakeLockManager(),
      dispatcher: async ({ occurrence }) => {
        dispatched.push(occurrence.occurrenceId);
      },
      ownerId: "scheduler-1",
      now: () => new Date("2026-01-01T00:04:00.000Z")
    });

    await loop.tick();

    expect(dispatched).toEqual([
      "schedule:billing.catch-up:2026-01-01T00:00:00.000Z",
      "schedule:billing.catch-up:2026-01-01T00:01:00.000Z"
    ]);
  });
});

class FakeScheduleStore implements ScheduleStore {
  readonly occurrences = new Map<string, ScheduleOccurrence>();

  async findLatestOccurrence(scheduleName: string): Promise<ScheduleOccurrence | undefined> {
    return [...this.occurrences.values()]
      .filter((occurrence) => occurrence.scheduleName === scheduleName)
      .sort((left, right) => right.scheduledAt.getTime() - left.scheduledAt.getTime())[0];
  }

  async claimOccurrence(
    candidate: ScheduleOccurrenceCandidate,
    options: { ownerId: string; claimedAt: Date; claimTtlMs?: number }
  ): Promise<ScheduleOccurrence | undefined> {
    const existing = this.occurrences.get(candidate.occurrenceId);
    if (existing && existing.status !== "claimed") {
      return undefined;
    }
    const occurrence: ScheduleOccurrence = {
      ...candidate,
      status: "claimed",
      ownerId: options.ownerId,
      claimedAt: options.claimedAt,
      claimExpiresAt:
        options.claimTtlMs === undefined
          ? undefined
          : new Date(options.claimedAt.getTime() + options.claimTtlMs)
    };
    this.occurrences.set(occurrence.occurrenceId, occurrence);
    return occurrence;
  }

  async markDispatched(
    occurrence: ScheduleOccurrence,
    options: { ownerId: string; dispatchedAt: Date }
  ): Promise<boolean> {
    if (occurrence.ownerId !== options.ownerId) {
      return false;
    }
    this.occurrences.set(occurrence.occurrenceId, {
      ...occurrence,
      status: "dispatched",
      dispatchedAt: options.dispatchedAt
    });
    return true;
  }

  async markFailed(
    occurrence: ScheduleOccurrence,
    options: { ownerId: string; failedAt: Date; failureReason: string }
  ): Promise<boolean> {
    this.occurrences.set(occurrence.occurrenceId, {
      ...occurrence,
      status: "failed",
      failedAt: options.failedAt,
      failureReason: options.failureReason
    });
    return true;
  }

  latest(scheduleName: string): ScheduleOccurrence | undefined {
    return [...this.occurrences.values()].find(
      (occurrence) => occurrence.scheduleName === scheduleName
    );
  }
}

class FakeLockManager implements LockManager {
  constructor(private readonly options: { readonly deny?: boolean } = {}) {}

  async acquire(resource: string, ownerId: string): Promise<LockHandle | undefined> {
    return this.options.deny ? undefined : { resource, ownerId };
  }

  async release(): Promise<void> {
    return undefined;
  }
}
