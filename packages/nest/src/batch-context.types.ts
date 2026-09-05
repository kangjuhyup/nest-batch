import type {
  ChunkCheckpointContext,
  ChunkItemContext,
  ChunkRetryContext,
  ChunkSkipContext,
  ChunkStepExecutionContext,
  ChunkWriteContext,
  JobParameters,
  PartitionExecutionContext,
  TaskletStepExecutionContext
} from "@rv-nest-batch/core";

export type NestBatchExecutionContext<Parameters extends JobParameters = JobParameters> =
  | TaskletStepExecutionContext<unknown, Parameters>
  | ChunkStepExecutionContext<unknown, Parameters>
  | ChunkItemContext<unknown, unknown, Parameters>
  | ChunkWriteContext<unknown, Parameters>
  | ChunkCheckpointContext<unknown, Parameters>
  | ChunkRetryContext<unknown, unknown, unknown, Parameters>
  | ChunkSkipContext<unknown, unknown, Parameters>
  | PartitionExecutionContext<unknown, Parameters>;
