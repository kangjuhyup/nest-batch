import type { BatchExecutionId, JobParameters } from "./common.js";
import type { JobExecution, StepExecution } from "./execution.js";
import type { JobDefinition } from "./job.js";
import type { ChunkFailurePhase } from "./step.js";

export type BatchEvent =
  | { readonly type: "job.started" | "job.completed" | "job.failed" | "job.cancelled"; readonly execution: JobExecution }
  | { readonly type: "step.started" | "step.completed" | "step.failed" | "step.cancelled"; readonly execution: StepExecution }
  | {
      readonly type: "chunk.written";
      readonly jobExecutionId: BatchExecutionId;
      readonly stepName: string;
      readonly chunkIndex: number;
      readonly itemCount: number;
      readonly readCount: number;
      readonly writeCount: number;
      readonly skipCount: number;
    }
  | {
      readonly type: "retry";
      readonly jobExecutionId: BatchExecutionId;
      readonly stepName: string;
      readonly phase: ChunkFailurePhase;
      readonly attempt: number;
      readonly error: unknown;
    }
  | {
      readonly type: "item.skipped";
      readonly jobExecutionId: BatchExecutionId;
      readonly stepName: string;
      readonly item: unknown;
      readonly error?: unknown;
      readonly reason?: string;
    };

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
