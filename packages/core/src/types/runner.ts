import type { BatchExecutionId, JobParameters } from "./common.js";
import type { JobExecution } from "./execution.js";
import type { JobDefinition } from "./job.js";

export interface BatchRunOptions {
  readonly executionId?: BatchExecutionId;
  readonly ownerId?: string;
  readonly lockTtlMs?: number;
  readonly signal?: AbortSignal;
}

export interface BatchRunner {
  run<Parameters extends JobParameters = JobParameters>(
    job: JobDefinition<Parameters>,
    parameters: Parameters,
    options?: BatchRunOptions
  ): Promise<JobExecution<Parameters>>;
}
