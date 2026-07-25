import type {
  BatchEventListenerRegistration,
  BatchExecutionId,
  BatchObserver,
  BatchStepExecutionId,
  JobParameters,
  StepRuntimeContext
} from "../types/index.js";

export interface StepRunContext<Parameters extends JobParameters = JobParameters> {
  readonly jobName: string;
  readonly jobExecutionId: BatchExecutionId;
  readonly checkpointExecutionId: BatchExecutionId;
  readonly stepIndex: number;
  readonly input: unknown;
  readonly parameters: Parameters;
  readonly restart: boolean;
  readonly restartFromExecutionId?: BatchExecutionId;
  readonly signal?: AbortSignal;
  readonly observer?: BatchObserver;
  readonly eventListeners?: readonly BatchEventListenerRegistration[];
}

export interface ActiveStepRunContext<Parameters extends JobParameters = JobParameters>
  extends StepRunContext<Parameters> {
  readonly stepName: string;
  readonly stepExecutionId: BatchStepExecutionId;
}

export interface StepRunResult {
  readonly output?: unknown;
  readonly readCount: number;
  readonly writeCount: number;
  readonly skipCount: number;
  readonly retryCount: number;
}

export const createStepRuntimeContext = <
  Parameters extends JobParameters,
  TCheckpoint
>(
  context: ActiveStepRunContext<Parameters>,
  signal: AbortSignal,
  checkpoint: TCheckpoint | undefined
): StepRuntimeContext<Parameters, TCheckpoint> => ({
  jobName: context.jobName,
  jobExecutionId: context.jobExecutionId,
  stepName: context.stepName,
  stepExecutionId: context.stepExecutionId,
  parameters: context.parameters,
  signal,
  checkpoint,
  restart: context.restart,
  restartFromExecutionId: context.restartFromExecutionId
});
