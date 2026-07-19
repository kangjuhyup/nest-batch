import type {
  BatchExecutionId,
  BatchStepExecutionId,
  JobInstanceId,
  JobParameters,
  JobParametersHash
} from "./common.js";

export type JobExecutionStatus = "created" | "running" | "completed" | "failed" | "cancelled";

export type StepExecutionStatus = JobExecutionStatus;

export interface JobInstance<Parameters extends JobParameters = JobParameters> {
  readonly id: JobInstanceId;
  readonly jobName: string;
  readonly parametersHash: JobParametersHash;
  readonly parameters: Parameters;
  readonly createdAt: Date;
}

export interface JobExecution<Parameters extends JobParameters = JobParameters> {
  readonly id: BatchExecutionId;
  readonly instanceId: JobInstanceId;
  readonly jobName: string;
  readonly status: JobExecutionStatus;
  readonly parameters: Parameters;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly endedAt?: Date;
  readonly failureReason?: string;
}

export interface StepExecution {
  readonly id: BatchStepExecutionId;
  readonly jobExecutionId: BatchExecutionId;
  readonly stepName: string;
  readonly status: StepExecutionStatus;
  readonly readCount: number;
  readonly writeCount: number;
  readonly skipCount: number;
  readonly retryCount: number;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly endedAt?: Date;
  readonly failureReason?: string;
}
