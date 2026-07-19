import type { BatchExecutionId, JobExecution, JobRepository } from "@nest-batch/core";
import { createMySqlScaffoldError } from "./errors.js";
import type { MySqlBatchOptions } from "./options.js";

export class MySqlJobRepository implements JobRepository {
  constructor(readonly options: MySqlBatchOptions) {}

  async create(_execution: JobExecution): Promise<void> {
    throw createMySqlScaffoldError("repository");
  }

  async update(_execution: JobExecution): Promise<void> {
    throw createMySqlScaffoldError("repository");
  }

  async findById(_id: BatchExecutionId): Promise<JobExecution | undefined> {
    throw createMySqlScaffoldError("repository");
  }
}
