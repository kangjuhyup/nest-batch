import type { BatchExecutionId, JobParameters } from "./common.js";
import type { JobExecution, StepExecution } from "./execution.js";
import type { JobDefinition } from "./job.js";
import type { ChunkFailurePhase } from "./step.js";

export const JOB_BATCH_EVENT_TYPES = [
  "job.started",
  "job.completed",
  "job.failed",
  "job.cancelled"
] as const;

export const STEP_BATCH_EVENT_TYPES = [
  "step.started",
  "step.completed",
  "step.failed",
  "step.cancelled"
] as const;

export const BATCH_EVENT_TYPES = [
  ...JOB_BATCH_EVENT_TYPES,
  ...STEP_BATCH_EVENT_TYPES,
  "chunk.written",
  "retry",
  "item.skipped"
] as const;

export type JobBatchEventType = (typeof JOB_BATCH_EVENT_TYPES)[number];

export type StepBatchEventType = (typeof STEP_BATCH_EVENT_TYPES)[number];

export type ChunkBatchEventType = "chunk.written";

export type RetryBatchEventType = "retry";

export type ItemBatchEventType = "item.skipped";

export type BatchEventType = (typeof BATCH_EVENT_TYPES)[number];

export interface JobStartedBatchEvent {
  readonly type: "job.started";
  readonly execution: JobExecution;
}

export interface JobCompletedBatchEvent {
  readonly type: "job.completed";
  readonly execution: JobExecution;
}

export interface JobFailedBatchEvent {
  readonly type: "job.failed";
  readonly execution: JobExecution;
}

export interface JobCancelledBatchEvent {
  readonly type: "job.cancelled";
  readonly execution: JobExecution;
}

export type JobBatchEvent =
  | JobStartedBatchEvent
  | JobCompletedBatchEvent
  | JobFailedBatchEvent
  | JobCancelledBatchEvent;

export interface StepStartedBatchEvent {
  readonly type: "step.started";
  readonly execution: StepExecution;
}

export interface StepCompletedBatchEvent {
  readonly type: "step.completed";
  readonly execution: StepExecution;
}

export interface StepFailedBatchEvent {
  readonly type: "step.failed";
  readonly execution: StepExecution;
}

export interface StepCancelledBatchEvent {
  readonly type: "step.cancelled";
  readonly execution: StepExecution;
}

export type StepBatchEvent =
  | StepStartedBatchEvent
  | StepCompletedBatchEvent
  | StepFailedBatchEvent
  | StepCancelledBatchEvent;

export interface ChunkWrittenBatchEvent {
  readonly type: ChunkBatchEventType;
  readonly jobExecutionId: BatchExecutionId;
  readonly stepName: string;
  readonly chunkIndex: number;
  readonly itemCount: number;
  readonly readCount: number;
  readonly writeCount: number;
  readonly skipCount: number;
}

export interface RetryBatchEvent {
  readonly type: RetryBatchEventType;
  readonly jobExecutionId: BatchExecutionId;
  readonly stepName: string;
  readonly phase: ChunkFailurePhase;
  readonly attempt: number;
  readonly error: unknown;
}

export interface ItemSkippedBatchEvent {
  readonly type: ItemBatchEventType;
  readonly jobExecutionId: BatchExecutionId;
  readonly stepName: string;
  readonly item: unknown;
  readonly error?: unknown;
  readonly reason?: string;
}

export type BatchEvent =
  | JobBatchEvent
  | StepBatchEvent
  | ChunkWrittenBatchEvent
  | RetryBatchEvent
  | ItemSkippedBatchEvent;

export interface BatchObserver {
  onBatchEvent(event: BatchEvent): Promise<void> | void;
}

export interface BatchRunOptions {
  readonly executionId?: BatchExecutionId;
  readonly ownerId?: string;
  readonly lockTtlMs?: number;
  readonly signal?: AbortSignal;
  readonly restart?: boolean;
  readonly observer?: BatchObserver;
}

export interface BatchRunner {
  run<Parameters extends JobParameters = JobParameters>(
    job: JobDefinition<Parameters>,
    parameters: Parameters,
    options?: BatchRunOptions
  ): Promise<JobExecution<Parameters>>;
}
