import { createScheduleOccurrenceId } from "./occurrence-id.js";
import type {
  ScheduleDefinition,
  ScheduleOccurrence,
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
        continue;
      }

      try {
        const latest = await this.options.store.findLatestOccurrence(schedule.name);
        const due = schedule.trigger.getDueOccurrences({ after: latest?.scheduledAt, now });
        const selected = selectDueOccurrences(schedule, due);

        for (const scheduledAt of selected) {
          signal.throwIfAborted();
          const occurrenceId = createScheduleOccurrenceId(schedule.name, scheduledAt);
          const claimed = await this.options.store.claimOccurrence(
            { scheduleName: schedule.name, occurrenceId, scheduledAt },
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
      if (!isAbortError(error)) {
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
      }
    } catch (error) {
      await this.options.store.markFailed(occurrence, {
        ownerId: this.options.ownerId,
        failedAt: now,
        failureReason: error instanceof Error ? error.message : String(error)
      });
      result.failedOccurrences += 1;
    }
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
