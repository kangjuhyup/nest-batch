import type { BatchExecutionId, JobExecution, JobRepository } from "@nest-batch/core";
import { resolvePostgresPool } from "./driver.js";
import type { PostgresBatchOptions } from "./options.js";
import type { PostgresPoolLike } from "./options.js";
import {
  createPostgresTables,
  parsePostgresJobParameters,
  parsePostgresJobStatus,
  parsePostgresOptionalDate,
  parsePostgresRequiredDate,
  rowsFromPostgresResult,
  stringifyPostgresJson,
  type PostgresJobExecutionRow,
  type PostgresTables
} from "./sql.js";

export class PostgresJobRepository implements JobRepository {
  private readonly pool: PostgresPoolLike;
  private readonly tables: PostgresTables;

  constructor(readonly options: PostgresBatchOptions) {
    this.pool = resolvePostgresPool(options);
    this.tables = createPostgresTables(options);
  }

  async create(execution: JobExecution): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO ${this.tables.jobExecutions} (
          id,
          job_name,
          status,
          parameters,
          created_at,
          started_at,
          ended_at,
          failure_reason
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
      `,
      [
        execution.id,
        execution.jobName,
        execution.status,
        stringifyPostgresJson(execution.parameters),
        execution.createdAt,
        execution.startedAt ?? null,
        execution.endedAt ?? null,
        execution.failureReason ?? null
      ]
    );
  }

  async update(execution: JobExecution): Promise<void> {
    await this.pool.query(
      `
        UPDATE ${this.tables.jobExecutions}
        SET
          job_name = $1,
          status = $2,
          parameters = $3::jsonb,
          created_at = $4,
          started_at = $5,
          ended_at = $6,
          failure_reason = $7
        WHERE id = $8
      `,
      [
        execution.jobName,
        execution.status,
        stringifyPostgresJson(execution.parameters),
        execution.createdAt,
        execution.startedAt ?? null,
        execution.endedAt ?? null,
        execution.failureReason ?? null,
        execution.id
      ]
    );
  }

  async findById(id: BatchExecutionId): Promise<JobExecution | undefined> {
    const result = await this.pool.query<PostgresJobExecutionRow>(
      `
        SELECT
          id,
          job_name,
          status,
          parameters,
          created_at,
          started_at,
          ended_at,
          failure_reason
        FROM ${this.tables.jobExecutions}
        WHERE id = $1
      `,
      [id]
    );
    const [row] = rowsFromPostgresResult<PostgresJobExecutionRow>(result);

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      jobName: row.job_name,
      status: parsePostgresJobStatus(row.status),
      parameters: parsePostgresJobParameters(row.parameters),
      createdAt: parsePostgresRequiredDate(row.created_at, "created_at"),
      startedAt: parsePostgresOptionalDate(row.started_at),
      endedAt: parsePostgresOptionalDate(row.ended_at),
      failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined
    };
  }
}
