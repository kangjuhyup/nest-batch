import type { BatchExecutionId, JobExecution, JobRepository } from "@nest-batch/core";
import { resolveMariaDbPool } from "./driver.js";
import type { MariaDbBatchOptions } from "./options.js";
import type { MariaDbPoolLike } from "./options.js";
import {
  createMariaDbTables,
  parseMariaDbJobParameters,
  parseMariaDbJobStatus,
  parseMariaDbOptionalDate,
  parseMariaDbRequiredDate,
  rowsFromMariaDbResult,
  stringifyMariaDbJson,
  type MariaDbJobExecutionRow,
  type MariaDbTables
} from "./sql.js";

export class MariaDbJobRepository implements JobRepository {
  private readonly pool: MariaDbPoolLike;
  private readonly tables: MariaDbTables;

  constructor(readonly options: MariaDbBatchOptions) {
    this.pool = resolveMariaDbPool(options);
    this.tables = createMariaDbTables(options);
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        execution.id,
        execution.jobName,
        execution.status,
        stringifyMariaDbJson(execution.parameters),
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
        stringifyMariaDbJson(execution.parameters),
        execution.createdAt,
        execution.startedAt ?? null,
        execution.endedAt ?? null,
        execution.failureReason ?? null,
        execution.id
      ]
    );
  }

  async findById(id: BatchExecutionId): Promise<JobExecution | undefined> {
    const result = await this.pool.query(
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
    const [row] = rowsFromMariaDbResult<MariaDbJobExecutionRow>(result);

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      jobName: row.job_name,
      status: parseMariaDbJobStatus(row.status),
      parameters: parseMariaDbJobParameters(row.parameters),
      createdAt: parseMariaDbRequiredDate(row.created_at, "created_at"),
      startedAt: parseMariaDbOptionalDate(row.started_at),
      endedAt: parseMariaDbOptionalDate(row.ended_at),
      failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined
    };
  }
}
