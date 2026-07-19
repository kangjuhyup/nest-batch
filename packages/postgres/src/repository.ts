import type {
  BatchExecutionId,
  JobExecution,
  JobInstance,
  JobInstanceId,
  JobParametersHash,
  JobRepository,
  StepExecution
} from "@nest-batch/core";
import { resolvePostgresPool } from "./driver.js";
import type { PostgresBatchOptions } from "./options.js";
import type { PostgresPoolLike } from "./options.js";
import {
  createPostgresTables,
  parsePostgresJobParameters,
  parsePostgresJobStatus,
  parsePostgresOptionalDate,
  parsePostgresRequiredDate,
  parsePostgresStepStatus,
  rowsFromPostgresResult,
  stringifyPostgresJson,
  type PostgresJobExecutionRow,
  type PostgresJobInstanceRow,
  type PostgresStepExecutionRow,
  type PostgresTables
} from "./sql.js";

export class PostgresJobRepository implements JobRepository {
  private readonly pool: PostgresPoolLike;
  private readonly tables: PostgresTables;

  constructor(readonly options: PostgresBatchOptions) {
    this.pool = resolvePostgresPool(options);
    this.tables = createPostgresTables(options);
  }

  async createJobInstance(instance: JobInstance): Promise<JobInstance> {
    await this.pool.query(
      `
        INSERT INTO ${this.tables.jobInstances} (
          id,
          job_name,
          parameters_hash,
          parameters,
          created_at
        )
        VALUES ($1, $2, $3, $4::jsonb, $5)
      `,
      [
        instance.id,
        instance.jobName,
        instance.parametersHash,
        stringifyPostgresJson(instance.parameters),
        instance.createdAt
      ]
    );

    return instance;
  }

  async findJobInstance(
    jobName: string,
    parametersHash: JobParametersHash
  ): Promise<JobInstance | undefined> {
    const result = await this.pool.query<PostgresJobInstanceRow>(
      `
        SELECT
          id,
          job_name,
          parameters_hash,
          parameters,
          created_at
        FROM ${this.tables.jobInstances}
        WHERE job_name = $1
          AND parameters_hash = $2
      `,
      [jobName, parametersHash]
    );
    const [row] = rowsFromPostgresResult<PostgresJobInstanceRow>(result);

    return row ? toJobInstance(row) : undefined;
  }

  async findActiveJobExecution(instanceId: JobInstanceId): Promise<JobExecution | undefined> {
    const result = await this.pool.query<PostgresJobExecutionRow>(
      `
        SELECT
          id,
          instance_id,
          job_name,
          status,
          parameters,
          created_at,
          started_at,
          ended_at,
          failure_reason
        FROM ${this.tables.jobExecutions}
        WHERE instance_id = $1
          AND status IN ('created', 'running')
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
      [instanceId]
    );
    const [row] = rowsFromPostgresResult<PostgresJobExecutionRow>(result);

    return row ? toJobExecution(row) : undefined;
  }

  async findLatestFailedJobExecution(instanceId: JobInstanceId): Promise<JobExecution | undefined> {
    const result = await this.pool.query<PostgresJobExecutionRow>(
      `
        SELECT
          id,
          instance_id,
          job_name,
          status,
          parameters,
          created_at,
          started_at,
          ended_at,
          failure_reason
        FROM ${this.tables.jobExecutions}
        WHERE instance_id = $1
          AND status = 'failed'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      [instanceId]
    );
    const [row] = rowsFromPostgresResult<PostgresJobExecutionRow>(result);

    return row ? toJobExecution(row) : undefined;
  }

  async create(execution: JobExecution): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO ${this.tables.jobExecutions} (
          id,
          instance_id,
          job_name,
          status,
          parameters,
          created_at,
          started_at,
          ended_at,
          failure_reason
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
      `,
      [
        execution.id,
        execution.instanceId,
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
          instance_id = $1,
          job_name = $2,
          status = $3,
          parameters = $4::jsonb,
          created_at = $5,
          started_at = $6,
          ended_at = $7,
          failure_reason = $8
        WHERE id = $9
      `,
      [
        execution.instanceId,
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
          instance_id,
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

    return toJobExecution(row);
  }

  async createStepExecution(execution: StepExecution): Promise<void> {
    await this.pool.query(
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
    await this.pool.query(
      `
        UPDATE ${this.tables.stepExecutions}
        SET
          job_execution_id = $1,
          step_name = $2,
          status = $3,
          read_count = $4,
          write_count = $5,
          skip_count = $6,
          retry_count = $7,
          created_at = $8,
          started_at = $9,
          ended_at = $10,
          failure_reason = $11
        WHERE id = $12
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
    const result = await this.pool.query<PostgresStepExecutionRow>(
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
        WHERE job_execution_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [jobExecutionId]
    );

    return rowsFromPostgresResult<PostgresStepExecutionRow>(result).map(toStepExecution);
  }
}

const toJobInstance = (row: PostgresJobInstanceRow): JobInstance => ({
  id: row.id,
  jobName: row.job_name,
  parametersHash: row.parameters_hash,
  parameters: parsePostgresJobParameters(row.parameters),
  createdAt: parsePostgresRequiredDate(row.created_at, "created_at")
});

const toJobExecution = (row: PostgresJobExecutionRow): JobExecution => ({
  id: row.id,
  instanceId: row.instance_id,
  jobName: row.job_name,
  status: parsePostgresJobStatus(row.status),
  parameters: parsePostgresJobParameters(row.parameters),
  createdAt: parsePostgresRequiredDate(row.created_at, "created_at"),
  startedAt: parsePostgresOptionalDate(row.started_at),
  endedAt: parsePostgresOptionalDate(row.ended_at),
  failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined
});

const toStepExecution = (row: PostgresStepExecutionRow): StepExecution => ({
  id: row.id,
  jobExecutionId: row.job_execution_id,
  stepName: row.step_name,
  status: parsePostgresStepStatus(row.status),
  readCount: parsePostgresCount(row.read_count, "read_count"),
  writeCount: parsePostgresCount(row.write_count, "write_count"),
  skipCount: parsePostgresCount(row.skip_count, "skip_count"),
  retryCount: parsePostgresCount(row.retry_count, "retry_count"),
  createdAt: parsePostgresRequiredDate(row.created_at, "created_at"),
  startedAt: parsePostgresOptionalDate(row.started_at),
  endedAt: parsePostgresOptionalDate(row.ended_at),
  failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined
});

const parsePostgresCount = (value: unknown, fieldName: string): number => {
  const count = typeof value === "number" ? value : Number(value);

  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError(`Invalid Postgres ${fieldName} count.`);
  }

  return count;
};
