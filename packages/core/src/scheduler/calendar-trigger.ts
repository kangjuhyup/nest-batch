import type { ScheduleTrigger } from "./types.js";

export interface UtcTimeOfDay {
  readonly hour: number;
  readonly minute?: number;
  readonly second?: number;
  readonly millisecond?: number;
}

export interface UtcDailyTriggerOptions {
  readonly startAt: Date;
  readonly time: UtcTimeOfDay;
  readonly everyDays?: number;
  readonly endAt?: Date;
}

export interface UtcWeeklyTriggerOptions {
  readonly startAt: Date;
  readonly daysOfWeek: readonly number[];
  readonly time: UtcTimeOfDay;
  readonly endAt?: Date;
}

export interface UtcMonthlyTriggerOptions {
  readonly startAt: Date;
  readonly daysOfMonth: readonly number[];
  readonly time: UtcTimeOfDay;
  readonly endAt?: Date;
}

export const createUtcDailyTrigger = (options: UtcDailyTriggerOptions): ScheduleTrigger => {
  const startAt = cloneValidDate(options.startAt, "UTC daily trigger startAt must be a valid Date.");
  const endAt = cloneOptionalEndAt(options.endAt, startAt, "UTC daily trigger endAt must be a valid Date.");
  const time = normalizeTimeOfDay(options.time);
  const everyDays = normalizeEveryDays(options.everyDays);

  return createCalendarTrigger({
    startAt,
    endAt,
    matchesDate: (date) => daysBetweenUtc(startOfUtcDate(startAt), date) % everyDays === 0,
    occurrenceAt: (date) => dateAtUtcTime(date, time)
  });
};

export const createUtcWeeklyTrigger = (options: UtcWeeklyTriggerOptions): ScheduleTrigger => {
  const startAt = cloneValidDate(options.startAt, "UTC weekly trigger startAt must be a valid Date.");
  const endAt = cloneOptionalEndAt(options.endAt, startAt, "UTC weekly trigger endAt must be a valid Date.");
  const time = normalizeTimeOfDay(options.time);
  const daysOfWeek = normalizeIntegerSet(options.daysOfWeek, "daysOfWeek", 0, 6);

  return createCalendarTrigger({
    startAt,
    endAt,
    matchesDate: (date) => daysOfWeek.has(date.getUTCDay()),
    occurrenceAt: (date) => dateAtUtcTime(date, time)
  });
};

export const createUtcMonthlyTrigger = (options: UtcMonthlyTriggerOptions): ScheduleTrigger => {
  const startAt = cloneValidDate(options.startAt, "UTC monthly trigger startAt must be a valid Date.");
  const endAt = cloneOptionalEndAt(options.endAt, startAt, "UTC monthly trigger endAt must be a valid Date.");
  const time = normalizeTimeOfDay(options.time);
  const daysOfMonth = normalizeIntegerSet(options.daysOfMonth, "daysOfMonth", 1, 31);

  return createCalendarTrigger({
    startAt,
    endAt,
    matchesDate: (date) => daysOfMonth.has(date.getUTCDate()),
    occurrenceAt: (date) => dateAtUtcTime(date, time)
  });
};

interface CalendarTriggerOptions {
  readonly startAt: Date;
  readonly endAt?: Date;
  readonly matchesDate: (date: Date) => boolean;
  readonly occurrenceAt: (date: Date) => Date;
}

const createCalendarTrigger = (options: CalendarTriggerOptions): ScheduleTrigger => ({
  getDueOccurrences({ after, now }) {
    assertValidDate(now, "UTC calendar trigger now must be a valid Date.");
    if (after) {
      assertValidDate(after, "UTC calendar trigger after must be a valid Date.");
    }

    const upperBound = minDate(now, options.endAt);
    if (upperBound.getTime() < options.startAt.getTime()) {
      return [];
    }

    const occurrences: Date[] = [];
    let date = startOfUtcDate(maxDate(options.startAt, after ?? options.startAt));

    while (date.getTime() <= upperBound.getTime()) {
      if (options.matchesDate(date)) {
        const occurrence = options.occurrenceAt(date);
        if (
          occurrence.getTime() >= options.startAt.getTime() &&
          occurrence.getTime() <= upperBound.getTime() &&
          (after === undefined || occurrence.getTime() > after.getTime())
        ) {
          occurrences.push(occurrence);
        }
      }

      date = addUtcDays(date, 1);
    }

    return occurrences;
  }
});

const normalizeTimeOfDay = (time: UtcTimeOfDay): Required<UtcTimeOfDay> => ({
  hour: normalizeInteger(time.hour, "hour", 0, 23),
  minute: normalizeInteger(time.minute ?? 0, "minute", 0, 59),
  second: normalizeInteger(time.second ?? 0, "second", 0, 59),
  millisecond: normalizeInteger(time.millisecond ?? 0, "millisecond", 0, 999)
});

const normalizeEveryDays = (everyDays: number | undefined): number =>
  normalizeInteger(everyDays ?? 1, "everyDays", 1, Number.MAX_SAFE_INTEGER);

const normalizeIntegerSet = (
  values: readonly number[],
  optionName: string,
  min: number,
  max: number
): ReadonlySet<number> => {
  if (values.length === 0) {
    throw new TypeError(`UTC calendar trigger ${optionName} must not be empty.`);
  }

  return new Set(values.map((value) => normalizeInteger(value, optionName, min, max)));
};

const normalizeInteger = (value: number, optionName: string, min: number, max: number): number => {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`UTC calendar trigger ${optionName} must be an integer from ${min} to ${max}.`);
  }

  return value;
};

const cloneValidDate = (value: Date, message: string): Date => {
  assertValidDate(value, message);
  return new Date(value);
};

const cloneOptionalEndAt = (value: Date | undefined, startAt: Date, message: string): Date | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const endAt = cloneValidDate(value, message);
  if (endAt.getTime() < startAt.getTime()) {
    throw new TypeError("UTC calendar trigger endAt must not be before startAt.");
  }
  return endAt;
};

const assertValidDate = (value: Date, message: string): void => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(message);
  }
};

const startOfUtcDate = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const dateAtUtcTime = (date: Date, time: Required<UtcTimeOfDay>): Date =>
  new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      time.hour,
      time.minute,
      time.second,
      time.millisecond
    )
  );

const addUtcDays = (date: Date, days: number): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));

const daysBetweenUtc = (start: Date, end: Date): number =>
  Math.floor((startOfUtcDate(end).getTime() - startOfUtcDate(start).getTime()) / 86_400_000);

const maxDate = (left: Date, right: Date): Date =>
  left.getTime() >= right.getTime() ? left : right;

const minDate = (left: Date, right: Date | undefined): Date =>
  right !== undefined && right.getTime() < left.getTime() ? right : left;
