import { createScheduleOccurrenceId } from "./occurrence-id.js";
import type {
  ScheduleEvent,
  ScheduleDefinition,
  ScheduleOccurrence,
  ScheduleOccurrenceCandidate,
  SchedulerLoopOptions,
  SchedulerTickOptions,
  SchedulerTickResult
} from "./types.js";

export class SchedulerLoop {
  private readonly schedules: readonly ScheduleDefinition[];
  private readonly pollIntervalMs: number;

  constructor(private readonly options: SchedulerLoopOptions) {
    assertOwnerId(options.ownerId);
    assertPollInterval(options.pollIntervalMs ?? 1_000);
    assertUniqueScheduleNames(options.schedules);

    this.schedules = options.schedules;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
  }

  async tick(options: SchedulerTickOptions = {}): Promise<SchedulerTickResult> {
    const signal = options.signal ?? new AbortController().signal;
    const now = options.now ?? this.options.now?.() ?? new Date();
    const result: MutableSchedulerTickResult = {
      scannedSchedules: 0,
      claimedOccurrences: 0,
      dispatchedOccurrences: 0,
      failedOccurrences: 0
    };

    for (const schedule of this.schedules) {
      signal.throwIfAborted();
      result.scannedSchedules += 1;
      const lock = await this.options.lockManager.acquire(
        `schedule:${schedule.name}`,
        this.options.ownerId,
        {
          signal,
          ttlMs: this.options.lockTtlMs
        }
      );

      if (!lock) {
        await this.emit({
          type: "schedule.lock.skipped",
          scheduleName: schedule.name,
          ownerId: this.options.ownerId,
          observedAt: now
        });
        continue;
      }

      try {
        const selected = await this.selectCandidates(schedule, now);

        for (const candidate of selected) {
          signal.throwIfAborted();
          const claimed = await this.options.store.claimOccurrence(
            candidate,
            {
              ownerId: this.options.ownerId,
              claimedAt: now,
              claimTtlMs: this.options.claimTtlMs
            }
          );

          if (!claimed) {
            continue;
          }

          result.claimedOccurrences += 1;
          await this.emit({
            type: "schedule.occurrence.claimed",
            scheduleName: schedule.name,
            ownerId: this.options.ownerId,
            observedAt: now,
            occurrenceId: claimed.occurrenceId,
            scheduledAt: claimed.scheduledAt,
            claimExpiresAt: claimed.claimExpiresAt
          });
          await this.dispatch(schedule, claimed, signal, now, result);
        }
      } finally {
        await this.options.lockManager.release(lock);
      }
    }

    return result;
  }

  async runUntilStopped(options: { readonly signal?: AbortSignal } = {}): Promise<void> {
    const controller = createRunController(options.signal);

    try {
      while (!controller.signal.aborted) {
        await this.tick({ signal: controller.signal });
        await delay(this.pollIntervalMs, controller.signal);
      }
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) {
        throw error;
      }
    } finally {
      controller.cleanup();
    }
  }

  private async dispatch(
    schedule: ScheduleDefinition,
    occurrence: ScheduleOccurrence,
    signal: AbortSignal,
    now: Date,
    result: MutableSchedulerTickResult
  ): Promise<void> {
    try {
      signal.throwIfAborted();
      await this.options.dispatcher({ schedule, occurrence, signal });
      if (
        await this.options.store.markDispatched(occurrence, {
          ownerId: this.options.ownerId,
          dispatchedAt: now
        })
      ) {
        result.dispatchedOccurrences += 1;
        await this.emit({
          type: "schedule.occurrence.dispatched",
          scheduleName: schedule.name,
          ownerId: this.options.ownerId,
          observedAt: now,
          occurrenceId: occurrence.occurrenceId,
          scheduledAt: occurrence.scheduledAt,
          dispatchedAt: now
        });
      }
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        throw error;
      }

      const failureReason = error instanceof Error ? error.message : String(error);
      await this.options.store.markFailed(occurrence, {
        ownerId: this.options.ownerId,
        failedAt: now,
        failureReason
      });
      await this.emit({
        type: "schedule.occurrence.dispatch_failed",
        scheduleName: schedule.name,
        ownerId: this.options.ownerId,
        observedAt: now,
        occurrenceId: occurrence.occurrenceId,
        scheduledAt: occurrence.scheduledAt,
        failedAt: now,
        failureReason
      });
      result.failedOccurrences += 1;
    }
  }

  private async emit(event: ScheduleEvent): Promise<void> {
    try {
      await this.options.observer?.onScheduleEvent(event);
    } catch {
      // Observer failures must not change scheduler state transitions.
    }
  }

  private async selectCandidates(
    schedule: ScheduleDefinition,
    now: Date
  ): Promise<readonly ScheduleOccurrenceCandidate[]> {
    const reclaimable = await this.findReclaimableClaimedOccurrences(schedule, now);

    if (reclaimable.length > 0) {
      return reclaimable;
    }

    const latest = await this.options.store.findLatestOccurrence(schedule.name, {
      statuses: ["dispatched", "failed"]
    });
    const due = schedule.trigger.getDueOccurrences({ after: latest?.scheduledAt, now });

    return selectDueOccurrences(schedule, due).map((scheduledAt) => ({
      scheduleName: schedule.name,
      occurrenceId: createScheduleOccurrenceId(schedule.name, scheduledAt),
      scheduledAt
    }));
  }

  private async findReclaimableClaimedOccurrences(
    schedule: ScheduleDefinition,
    now: Date
  ): Promise<readonly ScheduleOccurrenceCandidate[]> {
    const occurrences = await this.options.store.listOccurrences({
      scheduleName: schedule.name,
      status: "claimed"
    });

    return occurrences
      .filter((occurrence) => isReclaimable(occurrence, now))
      .sort(compareOccurrenceAsc)
      .slice(0, schedule.maxCatchUpOccurrences ?? 100)
      .map((occurrence) => ({
        scheduleName: occurrence.scheduleName,
        occurrenceId: occurrence.occurrenceId,
        scheduledAt: occurrence.scheduledAt
      }));
  }
}

type MutableSchedulerTickResult = {
  -readonly [Key in keyof SchedulerTickResult]: SchedulerTickResult[Key];
};

const selectDueOccurrences = (
  schedule: ScheduleDefinition,
  due: readonly Date[]
): readonly Date[] => {
  if (due.length === 0) {
    return [];
  }

  const sorted = [...due].sort((left, right) => left.getTime() - right.getTime());

  if ((schedule.misfirePolicy ?? "fire-once") === "fire-once") {
    return [sorted[sorted.length - 1]!];
  }

  return sorted.slice(0, schedule.maxCatchUpOccurrences ?? 100);
};

const isReclaimable = (occurrence: ScheduleOccurrence, now: Date): boolean =>
  occurrence.claimExpiresAt !== undefined &&
  occurrence.claimExpiresAt.getTime() <= now.getTime() &&
  occurrence.scheduledAt.getTime() <= now.getTime();

const compareOccurrenceAsc = (
  left: Pick<ScheduleOccurrence, "scheduledAt" | "occurrenceId">,
  right: Pick<ScheduleOccurrence, "scheduledAt" | "occurrenceId">
): number => {
  const diff = left.scheduledAt.getTime() - right.scheduledAt.getTime();
  return diff === 0 ? left.occurrenceId.localeCompare(right.occurrenceId) : diff;
};

const assertOwnerId = (ownerId: string): void => {
  if (ownerId.trim().length === 0) {
    throw new TypeError("SchedulerLoop ownerId is required.");
  }
};

const assertPollInterval = (pollIntervalMs: number): void => {
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0) {
    throw new TypeError("SchedulerLoop pollIntervalMs must be a non-negative safe integer.");
  }
};

const assertUniqueScheduleNames = (schedules: readonly ScheduleDefinition[]): void => {
  const names = new Set<string>();

  for (const schedule of schedules) {
    if (names.has(schedule.name)) {
      throw new TypeError(`SchedulerLoop schedules must have unique names. Duplicate: ${schedule.name}.`);
    }
    names.add(schedule.name);
  }
};

const createRunController = (
  parentSignal: AbortSignal | undefined
): AbortController & { cleanup(): void } => {
  const controller = new AbortController();

  if (!parentSignal) {
    return Object.assign(controller, { cleanup: () => undefined });
  }

  if (parentSignal.aborted) {
    controller.abort(parentSignal.reason);
    return Object.assign(controller, { cleanup: () => undefined });
  }

  const abort = (): void => {
    controller.abort(parentSignal.reason);
  };
  parentSignal.addEventListener("abort", abort, { once: true });

  return Object.assign(controller, {
    cleanup: () => parentSignal.removeEventListener("abort", abort)
  });
};

const delay = (ms: number, signal: AbortSignal): Promise<void> => {
  signal.throwIfAborted();

  if (ms === 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = (): void => {
      cleanup();
      reject(createAbortError(signal.reason));
    };

    signal.addEventListener("abort", abort, { once: true });
  });
};

const isAbortError = (error: unknown): boolean => {
  return error instanceof Error && error.name === "AbortError";
};

const createAbortError = (reason: unknown): Error => {
  if (reason instanceof Error) {
    return reason;
  }

  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
};
