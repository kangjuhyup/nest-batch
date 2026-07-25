import type { SkipItem } from "../skip-item.js";
import type { ChunkReader } from "../readers/reader.js";
import type { BatchExecutionId, JobParameters } from "./common.js";
import type { StepRuntimeContext } from "./context.js";
import type { PartitionedStepDefinition } from "./partitioned-step.js";

export type ChunkFailurePhase = "read" | "process" | "write";

export interface ChunkRetryContext<
  Input = unknown,
  Output = unknown,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> extends ChunkStepExecutionContext<TCheckpoint, Parameters> {
  readonly phase: ChunkFailurePhase;
  readonly error: unknown;
  readonly attempt: number;
  readonly item?: Input;
  readonly items?: readonly Output[];
  readonly readCount: number;
  readonly writeCount: number;
  readonly skipCount: number;
}

export interface ChunkSkipContext<
  Input = unknown,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> extends ChunkStepExecutionContext<TCheckpoint, Parameters> {
  readonly phase: "process";
  readonly error: unknown;
  readonly item: Input;
  readonly readCount: number;
  readonly writeCount: number;
  readonly skipCount: number;
}

export interface RetryPolicy<
  Input = unknown,
  Output = unknown,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> {
  canRetry(
    context: ChunkRetryContext<Input, Output, TCheckpoint, Parameters>
  ): boolean | Promise<boolean>;
  backoffMs?(
    context: ChunkRetryContext<Input, Output, TCheckpoint, Parameters>
  ): number | Promise<number>;
}

export interface SkipPolicy<
  Input = unknown,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> {
  canSkip(context: ChunkSkipContext<Input, TCheckpoint, Parameters>): boolean | Promise<boolean>;
}

export interface TaskletStepExecutionContext<
  Input = unknown,
  Parameters extends JobParameters = JobParameters
> extends StepRuntimeContext<Parameters> {
  readonly input?: Input;
  readonly signal: AbortSignal;
  readonly checkpoint?: unknown;
}

export type StepExecutionContext<
  Input = unknown,
  Parameters extends JobParameters = JobParameters
> = TaskletStepExecutionContext<Input, Parameters>;

export interface ChunkStepExecutionContext<
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> extends StepRuntimeContext<Parameters, TCheckpoint> {
  readonly signal: AbortSignal;
  readonly checkpoint?: TCheckpoint;
}

export interface ChunkItemContext<
  Input = unknown,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> extends ChunkStepExecutionContext<TCheckpoint, Parameters> {
  readonly item: Input;
  readonly index: number;
}

export interface ChunkWriteContext<
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> extends ChunkStepExecutionContext<TCheckpoint, Parameters> {
  readonly chunkIndex: number;
  readonly attempt: number;
}

export interface ChunkCheckpointContext<
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> extends ChunkStepExecutionContext<TCheckpoint, Parameters> {
  readonly executionId: BatchExecutionId;
  readonly stepName: string;
  readonly chunkIndex: number;
  readonly readCount: number;
  readonly writeCount: number;
  readonly skipCount: number;
}

export interface Processor<
  Input,
  Output,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> {
  process(
    item: Input,
    context: ChunkItemContext<Input, TCheckpoint, Parameters>
  ): Output | SkipItem | Promise<Output | SkipItem>;
}

export interface Writer<
  Output,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> {
  write(items: readonly Output[], context: ChunkWriteContext<TCheckpoint, Parameters>): Promise<void> | void;
}

export type ChunkProcessor<
  Input,
  Output,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> = Processor<Input, Output, TCheckpoint, Parameters>;

export type ChunkWriter<
  Output,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> = Writer<Output, TCheckpoint, Parameters>;

export interface TaskletStepDefinition<
  Input = unknown,
  Output = unknown,
  Parameters extends JobParameters = JobParameters
> {
  readonly kind?: "tasklet";
  readonly name: string;
  readonly execute: (context: TaskletStepExecutionContext<Input, Parameters>) => Promise<Output> | Output;
}

export interface ChunkStepDefinition<
  Input = unknown,
  Output = Input,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> {
  readonly kind: "chunk";
  readonly name: string;
  readonly chunkSize: number;
  readonly reader: ChunkReader<Input, TCheckpoint, Parameters>;
  readonly processor?: ChunkProcessor<Input, Output, TCheckpoint, Parameters>;
  readonly writer: ChunkWriter<Output, TCheckpoint, Parameters>;
  readonly retryPolicy?: RetryPolicy<Input, Output, TCheckpoint, Parameters>;
  readonly skipPolicy?: SkipPolicy<Input, TCheckpoint, Parameters>;
  readonly checkpoint?: (
    context: ChunkCheckpointContext<TCheckpoint, Parameters>
  ) => Promise<TCheckpoint | undefined> | TCheckpoint | undefined;
}

export type ChunkStepWithoutProcessorOptions<
  Input = unknown,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> = Omit<
  ChunkStepDefinition<Input, Input, TCheckpoint, Parameters>,
  "kind" | "processor"
> & {
  readonly processor?: undefined;
};

export type ChunkStepWithProcessorOptions<
  Input = unknown,
  Output = unknown,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> = Omit<
  ChunkStepDefinition<Input, Output, TCheckpoint, Parameters>,
  "kind"
> & {
  readonly processor: ChunkProcessor<Input, Output, TCheckpoint, Parameters>;
};

export type ChunkStepOptions<
  Input = unknown,
  Output = Input,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> =
  | ChunkStepWithoutProcessorOptions<Input, TCheckpoint, Parameters>
  | ChunkStepWithProcessorOptions<Input, Output, TCheckpoint, Parameters>;

export type StepDefinition<
  Input = unknown,
  Output = unknown,
  Parameters extends JobParameters = JobParameters
> =
  | TaskletStepDefinition<Input, Output, Parameters>
  | ChunkStepDefinition<Input, Output, unknown, Parameters>
  | PartitionedStepDefinition<unknown, Parameters>;

export type AnyStepDefinition<Parameters extends JobParameters = JobParameters> = StepDefinition<any, any, Parameters>;
