export type JobExecutionStatus = "created" | "running" | "completed" | "failed" | "cancelled";

export type JobParameters = Record<string, unknown>;

export type BatchExecutionId = string;

export interface StepExecutionContext<Input = unknown> {
  readonly input?: Input;
  readonly signal: AbortSignal;
  readonly checkpoint?: unknown;
}

export interface StepDefinition<Input = unknown, Output = unknown> {
  readonly name: string;
  readonly execute: (context: StepExecutionContext<Input>) => Promise<Output> | Output;
}

export interface JobDefinition<Parameters extends JobParameters = JobParameters> {
  readonly name: string;
  readonly steps: readonly StepDefinition[];
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
