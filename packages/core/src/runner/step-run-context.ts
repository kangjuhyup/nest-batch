import type { BatchExecutionId } from "../types/index.js";

export interface StepRunContext {
  readonly jobExecutionId: BatchExecutionId;
  readonly checkpointExecutionId: BatchExecutionId;
  readonly stepIndex: number;
  readonly input: unknown;
  readonly signal?: AbortSignal;
}

export interface StepRunResult {
  readonly output?: unknown;
  readonly readCount: number;
  readonly writeCount: number;
  readonly skipCount: number;
  readonly retryCount: number;
}
