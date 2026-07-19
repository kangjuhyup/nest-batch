import type { SkipItem } from "../skip-item.js";
import type { BatchExecutionId } from "./common.js";

export interface StepExecutionContext<Input = unknown> {
  readonly input?: Input;
  readonly signal: AbortSignal;
  readonly checkpoint?: unknown;
}

export interface ChunkStepExecutionContext<TCheckpoint = unknown> {
  readonly signal: AbortSignal;
  readonly checkpoint?: TCheckpoint;
}

export interface ChunkItemContext<Input = unknown, TCheckpoint = unknown>
  extends ChunkStepExecutionContext<TCheckpoint> {
  readonly item: Input;
  readonly index: number;
}

export interface ChunkWriteContext<TCheckpoint = unknown> extends ChunkStepExecutionContext<TCheckpoint> {
  readonly chunkIndex: number;
  readonly attempt: number;
}

export interface ChunkCheckpointContext<TCheckpoint = unknown>
  extends ChunkStepExecutionContext<TCheckpoint> {
  readonly executionId: BatchExecutionId;
  readonly stepName: string;
  readonly chunkIndex: number;
  readonly readCount: number;
  readonly writeCount: number;
  readonly skipCount: number;
}

export interface Reader<Input, TCheckpoint = unknown> {
  read(context: ChunkStepExecutionContext<TCheckpoint>): AsyncIterable<Input> | Iterable<Input>;
}

export interface Processor<Input, Output, TCheckpoint = unknown> {
  process(
    item: Input,
    context: ChunkItemContext<Input, TCheckpoint>
  ): Output | SkipItem | Promise<Output | SkipItem>;
}

export interface Writer<Output, TCheckpoint = unknown> {
  write(items: readonly Output[], context: ChunkWriteContext<TCheckpoint>): Promise<void> | void;
}

export type ChunkReader<Input, TCheckpoint = unknown> = Reader<Input, TCheckpoint>;

export type ChunkProcessor<Input, Output, TCheckpoint = unknown> = Processor<Input, Output, TCheckpoint>;

export type ChunkWriter<Output, TCheckpoint = unknown> = Writer<Output, TCheckpoint>;

export interface TaskletStepDefinition<Input = unknown, Output = unknown> {
  readonly kind?: "tasklet";
  readonly name: string;
  readonly execute: (context: StepExecutionContext<Input>) => Promise<Output> | Output;
}

export interface ChunkStepDefinition<Input = unknown, Output = Input, TCheckpoint = unknown> {
  readonly kind: "chunk";
  readonly name: string;
  readonly chunkSize: number;
  readonly reader: ChunkReader<Input, TCheckpoint>;
  readonly processor?: ChunkProcessor<Input, Output, TCheckpoint>;
  readonly writer: ChunkWriter<Output, TCheckpoint>;
  readonly checkpoint?: (
    context: ChunkCheckpointContext<TCheckpoint>
  ) => Promise<TCheckpoint | undefined> | TCheckpoint | undefined;
}

export type ChunkStepWithoutProcessorOptions<Input = unknown, TCheckpoint = unknown> = Omit<
  ChunkStepDefinition<Input, Input, TCheckpoint>,
  "kind" | "processor"
> & {
  readonly processor?: undefined;
};

export type ChunkStepWithProcessorOptions<Input = unknown, Output = unknown, TCheckpoint = unknown> = Omit<
  ChunkStepDefinition<Input, Output, TCheckpoint>,
  "kind"
> & {
  readonly processor: ChunkProcessor<Input, Output, TCheckpoint>;
};

export type ChunkStepOptions<Input = unknown, Output = Input, TCheckpoint = unknown> =
  | ChunkStepWithoutProcessorOptions<Input, TCheckpoint>
  | ChunkStepWithProcessorOptions<Input, Output, TCheckpoint>;

export type StepDefinition<Input = unknown, Output = unknown> =
  | TaskletStepDefinition<Input, Output>
  | ChunkStepDefinition<Input, Output>;

export type AnyStepDefinition = StepDefinition<any, any>;
