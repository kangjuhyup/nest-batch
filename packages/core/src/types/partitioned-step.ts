import type { BatchExecutionId, BatchStepExecutionId } from "./common.js";
import type { JobParameters } from "./common.js";
import type { StepRuntimeContext } from "./context.js";
import type { PartitionExecutionId } from "./partition.js";

export interface PartitionExecutionResult {
  readonly readCount?: number;
  readonly writeCount?: number;
  readonly skipCount?: number;
  readonly retryCount?: number;
}

export interface PartitionExecutionContext<
  TPartition = unknown,
  Parameters extends JobParameters = JobParameters
> extends Partial<StepRuntimeContext<Parameters>> {
  readonly jobExecutionId: BatchExecutionId;
  readonly stepExecutionId: BatchStepExecutionId;
  readonly partitionExecutionId: PartitionExecutionId;
  readonly stepName: string;
  readonly partition: TPartition;
  readonly signal: AbortSignal;
}

export interface PartitionedStepDefinition<TPartition = unknown> {
  readonly kind: "partitioned";
  readonly name: string;
  readonly maxConcurrency?: number;
  readonly partitions: () => readonly TPartition[] | Promise<readonly TPartition[]>;
  readonly execute: (
    partition: TPartition,
    context: PartitionExecutionContext<TPartition>
  ) => Promise<PartitionExecutionResult | void> | PartitionExecutionResult | void;
}

export type PartitionedStepOptions<TPartition = unknown> = Omit<
  PartitionedStepDefinition<TPartition>,
  "kind"
>;
