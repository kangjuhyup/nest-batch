import type { BatchExecutionId, JobExecution, JobRepository } from "@nest-batch/core";
import { createMariaDbScaffoldError } from "./errors.js";
import type { MariaDbBatchOptions } from "./options.js";

export class MariaDbJobRepository implements JobRepository {
  constructor(readonly options: MariaDbBatchOptions) {}

  async create(_execution: JobExecution): Promise<void> {
    throw createMariaDbScaffoldError("repository");
  }

  async update(_execution: JobExecution): Promise<void> {
    throw createMariaDbScaffoldError("repository");
  }

  async findById(_id: BatchExecutionId): Promise<JobExecution | undefined> {
    throw createMariaDbScaffoldError("repository");
  }
}
