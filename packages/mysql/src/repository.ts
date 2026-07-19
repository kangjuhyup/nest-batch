import type { BatchExecutionId, JobExecution, JobRepository } from "@nest-batch/core";
import { resolveMySqlPool } from "./driver.js";
import type { MySqlBatchOptions } from "./options.js";
import type { MySqlPoolLike } from "./options.js";
import {
  createMySqlTables,
  parseMySqlJobParameters,
  parseMySqlJobStatus,
  parseMySqlOptionalDate,
  parseMySqlRequiredDate,
  rowsFromMySqlResult,
  stringifyMySqlJson,
  type MySqlJobExecutionRow,
  type MySqlTables
} from "./sql.js";

export class MySqlJobRepository implements JobRepository {
  private readonly pool: MySqlPoolLike;
  private readonly tables: MySqlTables;

  constructor(readonly options: MySqlBatchOptions) {
    this.pool = resolveMySqlPool(options);
    this.tables = createMySqlTables(options);
  }

  async create(execution: JobExecution): Promise<void> {
    await this.pool.execute(
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        execution.id,
        execution.jobName,
        execution.status,
        stringifyMySqlJson(execution.parameters),
        execution.createdAt,
        execution.startedAt ?? null,
        execution.endedAt ?? null,
        execution.failureReason ?? null
      ]
    );
  }

  async update(execution: JobExecution): Promise<void> {
    await this.pool.execute(
      `
        UPDATE ${this.tables.jobExecutions}
        SET
          job_name = ?,
          status = ?,
          parameters = ?,
          created_at = ?,
          started_at = ?,
          ended_at = ?,
          failure_reason = ?
        WHERE id = ?
      `,
      [
        execution.jobName,
        execution.status,
        stringifyMySqlJson(execution.parameters),
        execution.createdAt,
        execution.startedAt ?? null,
        execution.endedAt ?? null,
        execution.failureReason ?? null,
        execution.id
      ]
    );
  }

  async findById(id: BatchExecutionId): Promise<JobExecution | undefined> {
    const result = await this.pool.execute(
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
        WHERE id = ?
      `,
      [id]
    );
    const [row] = rowsFromMySqlResult<MySqlJobExecutionRow>(result);

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      jobName: row.job_name,
      status: parseMySqlJobStatus(row.status),
      parameters: parseMySqlJobParameters(row.parameters),
      createdAt: parseMySqlRequiredDate(row.created_at, "created_at"),
      startedAt: parseMySqlOptionalDate(row.started_at),
      endedAt: parseMySqlOptionalDate(row.ended_at),
      failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined
    };
  }
}
