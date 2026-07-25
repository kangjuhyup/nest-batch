import type { JobParameters } from "./common.js";
import type { JobExecution } from "./execution.js";
import type { JobDefinition } from "./job.js";
import type { BatchRunOptions } from "./runner.js";

export interface ExecutionEngine {
  runJob<Parameters extends JobParameters = JobParameters>(
    job: JobDefinition<Parameters>,
    parameters: Parameters,
    options?: BatchRunOptions
  ): Promise<JobExecution<Parameters>>;
}
