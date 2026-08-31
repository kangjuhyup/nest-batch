import type { ScheduleTrigger } from "./types.js";

export interface IntervalTriggerOptions {
  readonly everyMs: number;
  readonly startAt: Date;
}

export const createIntervalTrigger = (options: IntervalTriggerOptions): ScheduleTrigger => {
  assertEveryMs(options.everyMs);
  assertValidDate(options.startAt, "Interval trigger startAt must be a valid Date.");
  const startAt = new Date(options.startAt);

  return {
    getDueOccurrences({ after, now }) {
      assertValidDate(now, "Interval trigger now must be a valid Date.");
      if (after) {
        assertValidDate(after, "Interval trigger after must be a valid Date.");
      }

      if (now.getTime() < startAt.getTime()) {
        return [];
      }

      const lowerBound =
        after && after.getTime() >= startAt.getTime()
          ? after.getTime()
          : startAt.getTime() - options.everyMs;
      const firstTick = Math.floor((lowerBound - startAt.getTime()) / options.everyMs) + 1;
      const lastTick = Math.floor((now.getTime() - startAt.getTime()) / options.everyMs);
      const occurrences: Date[] = [];

      for (let tick = Math.max(0, firstTick); tick <= lastTick; tick += 1) {
        occurrences.push(new Date(startAt.getTime() + tick * options.everyMs));
      }

      return occurrences;
    }
  };
};

const assertEveryMs = (everyMs: number): void => {
  if (!Number.isSafeInteger(everyMs) || everyMs <= 0) {
    throw new TypeError("Interval trigger everyMs must be a positive safe integer.");
  }
};

const assertValidDate = (value: Date, message: string): void => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(message);
  }
};
