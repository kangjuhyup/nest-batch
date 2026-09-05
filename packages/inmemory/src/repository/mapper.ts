import type { JobExecution, JobInstance, PartitionExecution, StepExecution } from "@rv-nest-batch/core";

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

export const clonePartitionExecution = <TPartition>(
  execution: PartitionExecution<TPartition>
): PartitionExecution<TPartition> => ({
  ...execution,
  partition: cloneJsonLike(execution.partition),
  createdAt: new Date(execution.createdAt.getTime()),
  startedAt: cloneOptionalDate(execution.startedAt),
  endedAt: cloneOptionalDate(execution.endedAt),
  heartbeatAt: cloneOptionalDate(execution.heartbeatAt),
  claimExpiresAt: cloneOptionalDate(execution.claimExpiresAt)
});

const cloneOptionalDate = (date?: Date): Date | undefined => {
  return date ? new Date(date.getTime()) : undefined;
};

const cloneJsonLike = <TValue>(value: TValue): TValue => {
  if (value === undefined || value === null) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as TValue;
};
