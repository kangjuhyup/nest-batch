import { Inject, Injectable } from "@nestjs/common";
import type {
  BatchRunOptions,
  BatchRunner,
  JobDefinition,
  JobExecution,
  JobParameters
} from "@rvkang/batch-core";
import { BATCH_RUNNER, NEST_BATCH_OPTIONS } from "./constants.js";
import type { NestBatchModuleOptions } from "./module-options.js";
import { NestBatchRegistry } from "./registry.js";

@Injectable()
export class NestBatchRunner {
  constructor(
    @Inject(NestBatchRegistry)
    private readonly registry: NestBatchRegistry,
    @Inject(BATCH_RUNNER) private readonly runner: BatchRunner,
    @Inject(NEST_BATCH_OPTIONS) private readonly options: NestBatchModuleOptions
  ) {}

  getJobs(): readonly JobDefinition[] {
    return this.registry.getJobs();
  }

  async run<Parameters extends JobParameters = JobParameters>(
    jobName: string,
    parameters: Parameters,
    options: BatchRunOptions = {}
  ): Promise<JobExecution<Parameters>> {
    const job = this.registry.getJob<Parameters>(jobName);

    if (!job) {
      throw new Error(`Batch job "${jobName}" is not registered.`);
    }

    return this.runner.run(job, parameters, {
      ...this.options.runner,
      ...options
    });
  }
}
