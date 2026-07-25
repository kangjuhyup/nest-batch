import type { BatchExecutionId, BatchStepExecutionId, JobParameters } from "./common.js";

export interface JobRuntimeContext<Parameters extends JobParameters = JobParameters> {
  readonly jobName: string;
  readonly jobExecutionId: BatchExecutionId;
  readonly parameters: Parameters;
  readonly signal: AbortSignal;
  readonly restart: boolean;
  readonly restartFromExecutionId?: BatchExecutionId;
}

export interface StepRuntimeContext<
  Parameters extends JobParameters = JobParameters,
  TCheckpoint = unknown
> extends JobRuntimeContext<Parameters> {
  readonly stepName: string;
  readonly stepExecutionId: BatchStepExecutionId;
  readonly checkpoint?: TCheckpoint;
}
