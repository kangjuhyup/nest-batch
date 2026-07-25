import type { BatchExecutionId, BatchStepExecutionId, JobInstanceId, JobParametersHash } from "./common.js";
import type { JobExecution, JobInstance, StepExecution } from "./execution.js";
import type { PartitionClaimOptions, PartitionExecution } from "./partition.js";

export interface JobExecutionAttempt {
  readonly instance: JobInstance;
  readonly activeExecution?: JobExecution;
}

export interface JobRepository {
  createJobInstance(instance: JobInstance): Promise<JobInstance>;
  findJobInstance(jobName: string, parametersHash: JobParametersHash): Promise<JobInstance | undefined>;
  findActiveJobExecution(instanceId: JobInstanceId): Promise<JobExecution | undefined>;
  findLatestFailedJobExecution(instanceId: JobInstanceId): Promise<JobExecution | undefined>;
  createExecutionAttempt(
    instance: JobInstance,
    execution: JobExecution
  ): Promise<JobExecutionAttempt>;
  create(execution: JobExecution): Promise<void>;
  update(execution: JobExecution): Promise<void>;
  findById(id: BatchExecutionId): Promise<JobExecution | undefined>;
  createStepExecution(execution: StepExecution): Promise<void>;
  updateStepExecution(execution: StepExecution): Promise<void>;
  findStepExecutions(jobExecutionId: BatchExecutionId): Promise<readonly StepExecution[]>;
  createPartitionExecution(execution: PartitionExecution): Promise<void>;
  updatePartitionExecution(execution: PartitionExecution): Promise<void>;
  findPartitionExecutions(stepExecutionId: BatchStepExecutionId): Promise<readonly PartitionExecution[]>;
  claimPartitionExecution(options: PartitionClaimOptions): Promise<PartitionExecution | undefined>;
}

export interface CheckpointStore {
  read<TCheckpoint = unknown>(executionId: BatchExecutionId, stepName: string): Promise<TCheckpoint | undefined>;
  write<TCheckpoint = unknown>(
    executionId: BatchExecutionId,
    stepName: string,
    checkpoint: TCheckpoint
  ): Promise<void>;
  delete(executionId: BatchExecutionId, stepName: string): Promise<void>;
}
