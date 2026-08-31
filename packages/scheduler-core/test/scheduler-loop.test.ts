import { describe, expect, it } from "vitest";
import type { LockHandle, LockManager } from "@nest-batch/core";
import type {
  ScheduleFindLatestOccurrenceOptions,
  ScheduleListOccurrencesOptions,
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

  it("reclaims stale claimed occurrences before advancing trigger boundaries / trigger 기준을 넘기기 전에 stale claimed occurrence를 회수한다", async () => {
    const store = new FakeScheduleStore();
    store.save({
      scheduleName: "billing.reclaim",
      occurrenceId: "schedule:billing.reclaim:2026-01-01T00:00:00.000Z",
      scheduledAt: new Date("2026-01-01T00:00:00.000Z"),
      status: "claimed",
      ownerId: "crashed-scheduler",
      claimedAt: new Date("2026-01-01T00:00:00.000Z"),
      claimExpiresAt: new Date("2026-01-01T00:00:10.000Z")
    });
    const dispatched: string[] = [];
    const loop = new SchedulerLoop({
      schedules: [
        defineSchedule({
          name: "billing.reclaim",
          jobName: "billing",
          trigger: createIntervalTrigger({
            everyMs: 60_000,
            startAt: new Date("2026-01-01T00:00:00.000Z")
          })
        })
      ],
      store,
      lockManager: new FakeLockManager(),
      dispatcher: async ({ occurrence }) => {
        dispatched.push(`${occurrence.occurrenceId}:${occurrence.ownerId}`);
      },
      ownerId: "scheduler-1",
      claimTtlMs: 30_000
    });

    const result = await loop.tick({ now: new Date("2026-01-01T00:00:30.000Z") });

    expect(result).toMatchObject({ claimedOccurrences: 1, dispatchedOccurrences: 1 });
    expect(dispatched).toEqual([
      "schedule:billing.reclaim:2026-01-01T00:00:00.000Z:scheduler-1"
    ]);
  });

  it("reclaims stale claimed occurrences before selecting new fire once work / 새 fire once work보다 stale claimed occurrence를 먼저 회수한다", async () => {
    const store = new FakeScheduleStore();
    store.save({
      scheduleName: "billing.reclaim-first",
      occurrenceId: "schedule:billing.reclaim-first:2026-01-01T00:00:00.000Z",
      scheduledAt: new Date("2026-01-01T00:00:00.000Z"),
      status: "claimed",
      ownerId: "crashed-scheduler",
      claimedAt: new Date("2026-01-01T00:00:00.000Z"),
      claimExpiresAt: new Date("2026-01-01T00:00:10.000Z")
    });
    const dispatched: string[] = [];
    const loop = new SchedulerLoop({
      schedules: [
        defineSchedule({
          name: "billing.reclaim-first",
          jobName: "billing",
          trigger: createIntervalTrigger({
            everyMs: 60_000,
            startAt: new Date("2026-01-01T00:00:00.000Z")
          })
        })
      ],
      store,
      lockManager: new FakeLockManager(),
      dispatcher: async ({ occurrence }) => {
        dispatched.push(occurrence.occurrenceId);
      },
      ownerId: "scheduler-1",
      claimTtlMs: 30_000
    });

    await loop.tick({ now: new Date("2026-01-01T00:02:00.000Z") });

    expect(dispatched).toEqual(["schedule:billing.reclaim-first:2026-01-01T00:00:00.000Z"]);
  });

  it("leaves claimed occurrences retryable when dispatch is aborted / dispatch 취소 시 occurrence를 재시도 가능하게 남긴다", async () => {
    const store = new FakeScheduleStore();
    const abortError = new Error("shutdown requested");
    abortError.name = "AbortError";
    const loop = new SchedulerLoop({
      schedules: [
        defineSchedule({
          name: "billing.abort",
          jobName: "billing",
          trigger: createIntervalTrigger({
            everyMs: 60_000,
            startAt: new Date("2026-01-01T00:00:00.000Z")
          })
        })
      ],
      store,
      lockManager: new FakeLockManager(),
      dispatcher: async () => {
        throw abortError;
      },
      ownerId: "scheduler-1",
      claimTtlMs: 30_000
    });

    await expect(loop.tick({ now: new Date("2026-01-01T00:00:00.000Z") })).rejects.toThrow(
      "shutdown requested"
    );
    expect(store.latest("billing.abort")).toMatchObject({
      status: "claimed",
      ownerId: "scheduler-1"
    });
  });

  it("rejects duplicate schedule names / 중복 schedule name을 거부한다", () => {
    const schedule = defineSchedule({
      name: "billing.duplicate",
      jobName: "billing",
      trigger: createIntervalTrigger({
        everyMs: 60_000,
        startAt: new Date("2026-01-01T00:00:00.000Z")
      })
    });

    expect(
      () =>
        new SchedulerLoop({
          schedules: [schedule, schedule],
          store: new FakeScheduleStore(),
          lockManager: new FakeLockManager(),
          dispatcher: async () => undefined,
          ownerId: "scheduler-1"
        })
    ).toThrow(/duplicate/i);
  });

  it("emits schedule lifecycle events / schedule lifecycle event를 발행한다", async () => {
    const events: { readonly type: string; readonly scheduleName?: string; readonly occurrenceId?: string }[] = [];
    const loop = new SchedulerLoop({
      schedules: [
        defineSchedule({
          name: "billing.observed",
          jobName: "billing",
          trigger: createIntervalTrigger({
            everyMs: 60_000,
            startAt: new Date("2026-01-01T00:00:00.000Z")
          })
        })
      ],
      store: new FakeScheduleStore(),
      lockManager: new FakeLockManager(),
      dispatcher: async () => undefined,
      ownerId: "scheduler-1",
      observer: {
        onScheduleEvent: (event) => {
          events.push({
            type: event.type,
            scheduleName: event.scheduleName,
            occurrenceId: "occurrenceId" in event ? event.occurrenceId : undefined
          });
        }
      }
    });

    await loop.tick({ now: new Date("2026-01-01T00:00:00.000Z") });

    expect(events).toEqual([
      {
        type: "schedule.occurrence.claimed",
        scheduleName: "billing.observed",
        occurrenceId: "schedule:billing.observed:2026-01-01T00:00:00.000Z"
      },
      {
        type: "schedule.occurrence.dispatched",
        scheduleName: "billing.observed",
        occurrenceId: "schedule:billing.observed:2026-01-01T00:00:00.000Z"
      }
    ]);
  });

  it("emits lock skipped and dispatch failed events / lock skip과 dispatch 실패 event를 발행한다", async () => {
    const skippedEvents: string[] = [];
    const skippedLoop = new SchedulerLoop({
      schedules: [
        defineSchedule({
          name: "billing.locked",
          jobName: "billing",
          trigger: createIntervalTrigger({
            everyMs: 60_000,
            startAt: new Date("2026-01-01T00:00:00.000Z")
          })
        })
      ],
      store: new FakeScheduleStore(),
      lockManager: new FakeLockManager({ deny: true }),
      dispatcher: async () => undefined,
      ownerId: "scheduler-1",
      observer: {
        onScheduleEvent: (event) => {
          skippedEvents.push(event.type);
        }
      }
    });

    await skippedLoop.tick({ now: new Date("2026-01-01T00:00:00.000Z") });

    expect(skippedEvents).toEqual(["schedule.lock.skipped"]);

    const failedEvents: string[] = [];
    const failedLoop = new SchedulerLoop({
      schedules: [
        defineSchedule({
          name: "billing.failed",
          jobName: "billing",
          trigger: createIntervalTrigger({
            everyMs: 60_000,
            startAt: new Date("2026-01-01T00:00:00.000Z")
          })
        })
      ],
      store: new FakeScheduleStore(),
      lockManager: new FakeLockManager(),
      dispatcher: async () => {
        throw new Error("enqueue failed");
      },
      ownerId: "scheduler-1",
      observer: {
        onScheduleEvent: (event) => {
          failedEvents.push(event.type);
        }
      }
    });

    await failedLoop.tick({ now: new Date("2026-01-01T00:00:00.000Z") });

    expect(failedEvents).toEqual([
      "schedule.occurrence.claimed",
      "schedule.occurrence.dispatch_failed"
    ]);
  });

  it("ignores observer failures during dispatch state transitions / observer 실패가 dispatch 상태 전이를 바꾸지 않는다", async () => {
    const store = new FakeScheduleStore();
    const loop = new SchedulerLoop({
      schedules: [
        defineSchedule({
          name: "billing.observer-failure",
          jobName: "billing",
          trigger: createIntervalTrigger({
            everyMs: 60_000,
            startAt: new Date("2026-01-01T00:00:00.000Z")
          })
        })
      ],
      store,
      lockManager: new FakeLockManager(),
      dispatcher: async () => undefined,
      ownerId: "scheduler-1",
      observer: {
        onScheduleEvent: () => {
          throw new Error("observer unavailable");
        }
      }
    });

    await expect(
      loop.tick({ now: new Date("2026-01-01T00:00:00.000Z") })
    ).resolves.toMatchObject({
      dispatchedOccurrences: 1,
      failedOccurrences: 0
    });
    expect(store.latest("billing.observer-failure")).toMatchObject({ status: "dispatched" });
  });
});

class FakeScheduleStore implements ScheduleStore {
  readonly occurrences = new Map<string, ScheduleOccurrence>();

  async findLatestOccurrence(
    scheduleName: string,
    options: ScheduleFindLatestOccurrenceOptions = {}
  ): Promise<ScheduleOccurrence | undefined> {
    return [...this.occurrences.values()]
      .filter((occurrence) => occurrence.scheduleName === scheduleName)
      .filter((occurrence) => matchesStatuses(occurrence, options.statuses))
      .sort((left, right) => right.scheduledAt.getTime() - left.scheduledAt.getTime())[0];
  }

  async listOccurrences(
    options: ScheduleListOccurrencesOptions = {}
  ): Promise<readonly ScheduleOccurrence[]> {
    return [...this.occurrences.values()]
      .filter((occurrence) => options.scheduleName === undefined || occurrence.scheduleName === options.scheduleName)
      .filter((occurrence) => options.status === undefined || occurrence.status === options.status)
      .sort((left, right) => right.scheduledAt.getTime() - left.scheduledAt.getTime())
      .slice(0, options.limit)
      .map((occurrence) => ({ ...occurrence }));
  }

  async claimOccurrence(
    candidate: ScheduleOccurrenceCandidate,
    options: { ownerId: string; claimedAt: Date; claimTtlMs?: number }
  ): Promise<ScheduleOccurrence | undefined> {
    const existing = this.occurrences.get(candidate.occurrenceId);
    if (existing && !canReclaim(existing, options.claimedAt)) {
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

  save(occurrence: ScheduleOccurrence): void {
    this.occurrences.set(occurrence.occurrenceId, occurrence);
  }
}

const canReclaim = (occurrence: ScheduleOccurrence, now: Date): boolean =>
  occurrence.status === "claimed" &&
  occurrence.claimExpiresAt !== undefined &&
  occurrence.claimExpiresAt.getTime() <= now.getTime();

const matchesStatuses = (
  occurrence: ScheduleOccurrence,
  statuses: readonly ScheduleOccurrence["status"][] | undefined
): boolean => statuses === undefined || statuses.length === 0 || statuses.includes(occurrence.status);

class FakeLockManager implements LockManager {
  constructor(private readonly options: { readonly deny?: boolean } = {}) {}

  async acquire(resource: string, ownerId: string): Promise<LockHandle | undefined> {
    return this.options.deny ? undefined : { resource, ownerId };
  }

  async release(): Promise<void> {
    return undefined;
  }
}
