export type JobExecutionStatus = "created" | "running" | "completed" | "failed" | "cancelled";

export type JobParameters = Record<string, unknown>;

export type BatchExecutionId = string;

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

export const SKIP_ITEM: unique symbol = Symbol("nest-batch.skip-item");

export interface SkipItem {
  readonly kind: "skip";
  readonly reason?: string;
  readonly cause?: unknown;
  readonly [SKIP_ITEM]: true;
}

export type ChunkReader<Input, TCheckpoint = unknown> = (
  context: ChunkStepExecutionContext<TCheckpoint>
) => AsyncIterable<Input> | Iterable<Input>;

export type ChunkProcessor<Input, Output, TCheckpoint = unknown> = (
  item: Input,
  context: ChunkItemContext<Input, TCheckpoint>
) => Output | SkipItem | Promise<Output | SkipItem>;

export type ChunkWriter<Output, TCheckpoint = unknown> = (
  items: readonly Output[],
  context: ChunkWriteContext<TCheckpoint>
) => Promise<void> | void;

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

export interface JobDefinition<Parameters extends JobParameters = JobParameters> {
  readonly name: string;
  readonly steps: readonly AnyStepDefinition[];
  readonly parametersSchema?: (parameters: unknown) => Parameters;
}

export interface JobExecution<Parameters extends JobParameters = JobParameters> {
  readonly id: BatchExecutionId;
  readonly jobName: string;
  readonly status: JobExecutionStatus;
  readonly parameters: Parameters;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly endedAt?: Date;
  readonly failureReason?: string;
}

export interface JobRepository {
  create(execution: JobExecution): Promise<void>;
  update(execution: JobExecution): Promise<void>;
  findById(id: BatchExecutionId): Promise<JobExecution | undefined>;
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

export interface LockHandle {
  readonly resource: string;
  readonly ownerId: string;
  readonly expiresAt?: Date;
}

export interface LockAcquireOptions {
  readonly ttlMs?: number;
  readonly signal?: AbortSignal;
}

export interface LockManager {
  acquire(resource: string, ownerId: string, options?: LockAcquireOptions): Promise<LockHandle | undefined>;
  release(handle: LockHandle): Promise<void>;
}

export abstract class DatabaseBatchStorage {
  abstract readonly repository: JobRepository;
  abstract readonly checkpointStore: CheckpointStore;
  abstract readonly lockManager: LockManager;

  async initialize(): Promise<void> {}

  async close(): Promise<void> {}
}

export interface BatchRunOptions {
  readonly executionId?: BatchExecutionId;
  readonly signal?: AbortSignal;
}

export interface BatchRunner {
  run<Parameters extends JobParameters = JobParameters>(
    job: JobDefinition<Parameters>,
    parameters: Parameters,
    options?: BatchRunOptions
  ): Promise<JobExecution<Parameters>>;
}
