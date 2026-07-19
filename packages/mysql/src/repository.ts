import type { BatchExecutionId, JobExecution, JobRepository, StepExecution } from "@nest-batch/core";
import { resolveMySqlPool } from "./driver.js";
import type { MySqlBatchOptions } from "./options.js";
import type { MySqlPoolLike } from "./options.js";
import {
  createMySqlTables,
  parseMySqlJobParameters,
  parseMySqlJobStatus,
  parseMySqlOptionalDate,
  parseMySqlRequiredDate,
  parseMySqlStepStatus,
  rowsFromMySqlResult,
  stringifyMySqlJson,
  type MySqlJobExecutionRow,
  type MySqlStepExecutionRow,
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

  async createStepExecution(execution: StepExecution): Promise<void> {
    await this.pool.execute(
      `
        INSERT INTO ${this.tables.stepExecutions} (
          id,
          job_execution_id,
          step_name,
          status,
          read_count,
          write_count,
          skip_count,
          retry_count,
          created_at,
          started_at,
          ended_at,
          failure_reason
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        execution.id,
        execution.jobExecutionId,
        execution.stepName,
        execution.status,
        execution.readCount,
        execution.writeCount,
        execution.skipCount,
        execution.retryCount,
        execution.createdAt,
        execution.startedAt ?? null,
        execution.endedAt ?? null,
        execution.failureReason ?? null
      ]
    );
  }

  async updateStepExecution(execution: StepExecution): Promise<void> {
    await this.pool.execute(
      `
        UPDATE ${this.tables.stepExecutions}
        SET
          job_execution_id = ?,
          step_name = ?,
          status = ?,
          read_count = ?,
          write_count = ?,
          skip_count = ?,
          retry_count = ?,
          created_at = ?,
          started_at = ?,
          ended_at = ?,
          failure_reason = ?
        WHERE id = ?
      `,
      [
        execution.jobExecutionId,
        execution.stepName,
        execution.status,
        execution.readCount,
        execution.writeCount,
        execution.skipCount,
        execution.retryCount,
        execution.createdAt,
        execution.startedAt ?? null,
        execution.endedAt ?? null,
        execution.failureReason ?? null,
        execution.id
      ]
    );
  }

  async findStepExecutions(jobExecutionId: BatchExecutionId): Promise<readonly StepExecution[]> {
    const result = await this.pool.execute(
      `
        SELECT
          id,
          job_execution_id,
          step_name,
          status,
          read_count,
          write_count,
          skip_count,
          retry_count,
          created_at,
          started_at,
          ended_at,
          failure_reason
        FROM ${this.tables.stepExecutions}
        WHERE job_execution_id = ?
        ORDER BY created_at ASC, id ASC
      `,
      [jobExecutionId]
    );

    return rowsFromMySqlResult<MySqlStepExecutionRow>(result).map(toStepExecution);
  }
}

const toStepExecution = (row: MySqlStepExecutionRow): StepExecution => ({
  id: row.id,
  jobExecutionId: row.job_execution_id,
  stepName: row.step_name,
  status: parseMySqlStepStatus(row.status),
  readCount: parseMySqlCount(row.read_count, "read_count"),
  writeCount: parseMySqlCount(row.write_count, "write_count"),
  skipCount: parseMySqlCount(row.skip_count, "skip_count"),
  retryCount: parseMySqlCount(row.retry_count, "retry_count"),
  createdAt: parseMySqlRequiredDate(row.created_at, "created_at"),
  startedAt: parseMySqlOptionalDate(row.started_at),
  endedAt: parseMySqlOptionalDate(row.ended_at),
  failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined
});

const parseMySqlCount = (value: unknown, fieldName: string): number => {
  const count = typeof value === "number" ? value : Number(value);

  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError(`Invalid MySQL ${fieldName} count.`);
  }

  return count;
};
