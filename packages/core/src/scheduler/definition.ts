import type { JobParameters } from "../types/index.js";
import type { ScheduleDefinition } from "./types.js";

export const defineSchedule = <Parameters extends JobParameters = JobParameters>(
  definition: ScheduleDefinition<Parameters>
): ScheduleDefinition<Parameters> => {
  assertNonBlank(definition.name, "Schedule name is required.");
  assertNonBlank(definition.jobName, "Schedule jobName is required.");

  const misfirePolicy = definition.misfirePolicy ?? "fire-once";
  const maxCatchUpOccurrences =
    definition.maxCatchUpOccurrences ?? (misfirePolicy === "fire-all" ? 100 : 1);

  if (!Number.isSafeInteger(maxCatchUpOccurrences) || maxCatchUpOccurrences <= 0) {
    throw new TypeError("Schedule maxCatchUpOccurrences must be a positive safe integer.");
  }

  return Object.freeze({
    ...definition,
    misfirePolicy,
    maxCatchUpOccurrences
  });
};

export const resolveScheduleParameters = (
  schedule: ScheduleDefinition,
  occurrenceId: string,
  scheduledAt: Date
): JobParameters => {
  if (schedule.parameters === undefined) {
    return {};
  }

  if (typeof schedule.parameters === "function") {
    return schedule.parameters({
      scheduleName: schedule.name,
      jobName: schedule.jobName,
      occurrenceId,
      scheduledAt
    });
  }

  return schedule.parameters;
};

const assertNonBlank = (value: string, message: string): void => {
  if (value.trim().length === 0) {
    throw new TypeError(message);
  }
};
