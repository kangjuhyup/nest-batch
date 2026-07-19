import type { BatchExecutionId } from "./common.js";
import type { JobExecution, StepExecution } from "./execution.js";

export interface JobRepository {
  create(execution: JobExecution): Promise<void>;
  update(execution: JobExecution): Promise<void>;
  findById(id: BatchExecutionId): Promise<JobExecution | undefined>;
  createStepExecution(execution: StepExecution): Promise<void>;
  updateStepExecution(execution: StepExecution): Promise<void>;
  findStepExecutions(jobExecutionId: BatchExecutionId): Promise<readonly StepExecution[]>;
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
