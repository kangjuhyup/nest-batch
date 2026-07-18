import type { BatchExecutionId, JobExecution, JobRepository } from "@nest-batch/core";
import { createPostgresScaffoldError } from "./errors.js";
import type { PostgresBatchOptions } from "./options.js";

export class PostgresJobRepository implements JobRepository {
  constructor(readonly options: PostgresBatchOptions) {}

  async create(_execution: JobExecution): Promise<void> {
    throw createPostgresScaffoldError("repository");
  }

  async update(_execution: JobExecution): Promise<void> {
    throw createPostgresScaffoldError("repository");
  }

  async findById(_id: BatchExecutionId): Promise<JobExecution | undefined> {
    throw createPostgresScaffoldError("repository");
  }
}
