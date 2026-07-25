import type {
  BatchEventListenerRegistration,
  BatchExecutionId,
  BatchObserver
} from "../types/index.js";

export interface StepRunContext {
  readonly jobExecutionId: BatchExecutionId;
  readonly checkpointExecutionId: BatchExecutionId;
  readonly stepIndex: number;
  readonly input: unknown;
  readonly signal?: AbortSignal;
  readonly observer?: BatchObserver;
  readonly eventListeners?: readonly BatchEventListenerRegistration[];
}

export interface StepRunResult {
  readonly output?: unknown;
  readonly readCount: number;
  readonly writeCount: number;
  readonly skipCount: number;
  readonly retryCount: number;
}
