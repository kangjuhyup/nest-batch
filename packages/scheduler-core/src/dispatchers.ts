import { resolveScheduleParameters } from "./definition.js";
import type {
  QueueScheduleDispatcherOptions,
  RunnerScheduleDispatcherOptions,
  ScheduleDispatcher,
  ScheduledJobWorkUnit
} from "./types.js";

export const createRunnerScheduleDispatcher = (
  options: RunnerScheduleDispatcherOptions
): ScheduleDispatcher => {
  const jobsByName = new Map(options.jobs.map((job) => [job.name, job]));

  return async ({ schedule, occurrence, signal }) => {
    signal.throwIfAborted();
    const job = jobsByName.get(schedule.jobName);

    if (!job) {
      throw new Error(`Scheduled job "${schedule.jobName}" is not registered.`);
    }

    const parameters = resolveScheduleParameters(
      schedule,
      occurrence.occurrenceId,
      occurrence.scheduledAt
    );

    await options.runner.run(job, parameters, {
      ...schedule.runOptions,
      executionId: occurrence.occurrenceId,
      ownerId: schedule.runOptions?.ownerId ?? options.ownerId,
      signal
    });
  };
};

export const createQueueScheduleDispatcher = (
  options: QueueScheduleDispatcherOptions
): ScheduleDispatcher => {
  return async ({ schedule, occurrence, signal }) => {
    signal.throwIfAborted();
    const parameters = resolveScheduleParameters(
      schedule,
      occurrence.occurrenceId,
      occurrence.scheduledAt
    );
    const work: ScheduledJobWorkUnit = {
      id: occurrence.occurrenceId,
      type: options.workType ?? "nest-batch.scheduled-job",
      createdAt: occurrence.scheduledAt,
      payload: {
        jobName: schedule.jobName,
        parameters,
        executionId: occurrence.occurrenceId,
        ownerId: schedule.runOptions?.ownerId,
        lockTtlMs: schedule.runOptions?.lockTtlMs,
        restart: false
      }
    };

    await options.queue.enqueue(work);
  };
};
