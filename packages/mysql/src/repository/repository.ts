import type {
  BatchExecutionId,
  JobExecution,
  JobExecutionAttempt,
  JobInstance,
  JobInstanceId,
  JobParametersHash,
  JobRepository,
  StepExecution
} from "@nest-batch/core";
import { resolveMySqlPool } from "../driver.js";
import { toJobExecution, toJobInstance, toStepExecution } from "./mapper.js";
import type { MySqlBatchOptions } from "../options.js";
import type { MySqlConnectionLike, MySqlPoolLike } from "../options.js";
import {
  createMySqlTables,
  rowsFromMySqlResult,
  stringifyMySqlJson,
  type MySqlJobExecutionRow,
  type MySqlJobInstanceRow,
  type MySqlStepExecutionRow,
  type MySqlTables
} from "../sql.js";

export class MySqlJobRepository implements JobRepository {
  private readonly pool: MySqlPoolLike;
  private readonly tables: MySqlTables;

  constructor(readonly options: MySqlBatchOptions) {
    this.pool = resolveMySqlPool(options);
    this.tables = createMySqlTables(options);
  }

  async createJobInstance(instance: JobInstance): Promise<JobInstance> {
    await this.pool.execute(
      `
        INSERT INTO ${this.tables.jobInstances} (
          id,
          job_name,
          parameters_hash,
          parameters,
          created_at
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        instance.id,
        instance.jobName,
        instance.parametersHash,
        stringifyMySqlJson(instance.parameters),
        instance.createdAt
      ]
    );

    return instance;
  }

  async findJobInstance(
    jobName: string,
    parametersHash: JobParametersHash
  ): Promise<JobInstance | undefined> {
    const result = await this.pool.execute(
      `
        SELECT
          id,
          job_name,
          parameters_hash,
          parameters,
          created_at
        FROM ${this.tables.jobInstances}
        WHERE job_name = ?
          AND parameters_hash = ?
      `,
      [jobName, parametersHash]
    );
    const [row] = rowsFromMySqlResult<MySqlJobInstanceRow>(result);

    return row ? toJobInstance(row) : undefined;
  }

  async findActiveJobExecution(instanceId: JobInstanceId): Promise<JobExecution | undefined> {
    const result = await this.pool.execute(
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
        WHERE instance_id = ?
          AND status IN ('created', 'running')
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
      [instanceId]
    );
    const [row] = rowsFromMySqlResult<MySqlJobExecutionRow>(result);

    return row ? toJobExecution(row) : undefined;
  }

  async findLatestFailedJobExecution(instanceId: JobInstanceId): Promise<JobExecution | undefined> {
    const result = await this.pool.execute(
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
        WHERE instance_id = ?
          AND status = 'failed'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      [instanceId]
    );
    const [row] = rowsFromMySqlResult<MySqlJobExecutionRow>(result);

    return row ? toJobExecution(row) : undefined;
  }

  async createExecutionAttempt(
    instance: JobInstance,
    execution: JobExecution
  ): Promise<JobExecutionAttempt> {
    return this.withTransaction(async (connection) => {
      await connection.execute(
        `
          INSERT IGNORE INTO ${this.tables.jobInstances} (
            id,
            job_name,
            parameters_hash,
            parameters,
            created_at
          )
          VALUES (?, ?, ?, ?, ?)
        `,
        [
          instance.id,
          instance.jobName,
          instance.parametersHash,
          stringifyMySqlJson(instance.parameters),
          instance.createdAt
        ]
      );

      const storedInstance = await this.findJobInstanceWithConnection(
        connection,
        instance.jobName,
        instance.parametersHash
      );

      if (!storedInstance) {
        throw new Error(`Failed to create job instance "${instance.id}".`);
      }

      const activeExecution = await this.findActiveJobExecutionWithConnection(
        connection,
        storedInstance.id
      );

      if (activeExecution) {
        return { instance: storedInstance, activeExecution };
      }

      await this.createWithConnection(connection, {
        ...execution,
        instanceId: storedInstance.id
      });

      return { instance: storedInstance };
    });
  }

  async create(execution: JobExecution): Promise<void> {
    await this.pool.execute(
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        execution.id,
        execution.instanceId,
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
          instance_id = ?,
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
        execution.instanceId,
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
          instance_id,
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

    return toJobExecution(row);
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

  private async withTransaction<T>(
    operation: (connection: MySqlExecutor) => Promise<T>
  ): Promise<T> {
    if (!this.pool.getConnection) {
      return operation(this.pool);
    }

    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();
      const result = await operation(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  private async findJobInstanceWithConnection(
    connection: MySqlExecutor,
    jobName: string,
    parametersHash: JobParametersHash
  ): Promise<JobInstance | undefined> {
    const result = await connection.execute(
      `
        SELECT
          id,
          job_name,
          parameters_hash,
          parameters,
          created_at
        FROM ${this.tables.jobInstances}
        WHERE job_name = ?
          AND parameters_hash = ?
        FOR UPDATE
      `,
      [jobName, parametersHash]
    );
    const [row] = rowsFromMySqlResult<MySqlJobInstanceRow>(result);

    return row ? toJobInstance(row) : undefined;
  }

  private async findActiveJobExecutionWithConnection(
    connection: MySqlExecutor,
    instanceId: JobInstanceId
  ): Promise<JobExecution | undefined> {
    const result = await connection.execute(
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
        WHERE instance_id = ?
          AND status IN ('created', 'running')
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
      [instanceId]
    );
    const [row] = rowsFromMySqlResult<MySqlJobExecutionRow>(result);

    return row ? toJobExecution(row) : undefined;
  }

  private async createWithConnection(
    connection: MySqlExecutor,
    execution: JobExecution
  ): Promise<void> {
    await connection.execute(
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        execution.id,
        execution.instanceId,
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
}

type MySqlExecutor = Pick<MySqlConnectionLike, "execute">;
