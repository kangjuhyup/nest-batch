import type { JobExecution, JobInstance, StepExecution } from "@nest-batch/core";

export const cloneJobInstance = (instance: JobInstance): JobInstance => ({
  ...instance,
  createdAt: new Date(instance.createdAt.getTime())
});

export const cloneJobExecution = (execution: JobExecution): JobExecution => ({
  ...execution,
  createdAt: new Date(execution.createdAt.getTime()),
  startedAt: cloneOptionalDate(execution.startedAt),
  endedAt: cloneOptionalDate(execution.endedAt)
});

export const cloneStepExecution = (execution: StepExecution): StepExecution => ({
  ...execution,
  createdAt: new Date(execution.createdAt.getTime()),
  startedAt: cloneOptionalDate(execution.startedAt),
  endedAt: cloneOptionalDate(execution.endedAt)
});

const cloneOptionalDate = (date?: Date): Date | undefined => {
  return date ? new Date(date.getTime()) : undefined;
};
