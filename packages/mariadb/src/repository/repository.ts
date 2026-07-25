import type {
  BatchExecutionId,
  BatchStepExecutionId,
  JobExecution,
  JobExecutionAttempt,
  JobInstance,
  JobInstanceId,
  JobParametersHash,
  JobRepository,
  PartitionClaimOptions,
  PartitionExecution,
  StepExecution
} from "@nest-batch/core";
import { resolveMariaDbPool } from "../driver.js";
import { toJobExecution, toJobInstance, toPartitionExecution, toStepExecution } from "./mapper.js";
import type { MariaDbBatchOptions } from "../options.js";
import type { MariaDbConnectionLike, MariaDbPoolLike } from "../options.js";
import {
  createMariaDbTables,
  rowsFromMariaDbResult,
  stringifyMariaDbJson,
  type MariaDbJobExecutionRow,
  type MariaDbJobInstanceRow,
  type MariaDbPartitionExecutionRow,
  type MariaDbStepExecutionRow,
  type MariaDbTables
} from "../sql.js";

export class MariaDbJobRepository implements JobRepository {
  private readonly pool: MariaDbPoolLike;
  private readonly tables: MariaDbTables;

  constructor(readonly options: MariaDbBatchOptions) {
    this.pool = resolveMariaDbPool(options);
    this.tables = createMariaDbTables(options);
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
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        instance.id,
        instance.jobName,
        instance.parametersHash,
        stringifyMariaDbJson(instance.parameters),
        instance.createdAt
      ]
    );

    return instance;
  }

  async findJobInstance(
    jobName: string,
    parametersHash: JobParametersHash
  ): Promise<JobInstance | undefined> {
    const result = await this.pool.query(
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
    const [row] = rowsFromMariaDbResult<MariaDbJobInstanceRow>(result);

    return row ? toJobInstance(row) : undefined;
  }

  async findActiveJobExecution(instanceId: JobInstanceId): Promise<JobExecution | undefined> {
    const result = await this.pool.query(
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
    const [row] = rowsFromMariaDbResult<MariaDbJobExecutionRow>(result);

    return row ? toJobExecution(row) : undefined;
  }

  async findLatestFailedJobExecution(instanceId: JobInstanceId): Promise<JobExecution | undefined> {
    const result = await this.pool.query(
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
    const [row] = rowsFromMariaDbResult<MariaDbJobExecutionRow>(result);

    return row ? toJobExecution(row) : undefined;
  }

  async createExecutionAttempt(
    instance: JobInstance,
    execution: JobExecution
  ): Promise<JobExecutionAttempt> {
    return this.withTransaction(async (connection) => {
      await connection.query(
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
          stringifyMariaDbJson(instance.parameters),
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        execution.id,
        execution.instanceId,
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
    const [row] = rowsFromMariaDbResult<MariaDbJobExecutionRow>(result);

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
    await this.pool.query(
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
    const result = await this.pool.query(
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

    return rowsFromMariaDbResult<MariaDbStepExecutionRow>(result).map(toStepExecution);
  }

  async createPartitionExecution(execution: PartitionExecution): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO ${this.tables.partitionExecutions} (
          id,
          step_execution_id,
          step_name,
          status,
          partition,
          owner_id,
          read_count,
          write_count,
          skip_count,
          retry_count,
          created_at,
          started_at,
          ended_at,
          failure_reason
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        execution.id,
        execution.stepExecutionId,
        execution.stepName,
        execution.status,
        stringifyMariaDbJson(execution.partition),
        execution.ownerId ?? null,
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

  async updatePartitionExecution(execution: PartitionExecution): Promise<void> {
    await this.updatePartitionExecutionWithConnection(this.pool, execution);
  }

  async findPartitionExecutions(
    stepExecutionId: BatchStepExecutionId
  ): Promise<readonly PartitionExecution[]> {
    const result = await this.pool.query(
      `
        SELECT
          id,
          step_execution_id,
          step_name,
          status,
          partition,
          owner_id,
          read_count,
          write_count,
          skip_count,
          retry_count,
          created_at,
          started_at,
          ended_at,
          failure_reason
        FROM ${this.tables.partitionExecutions}
        WHERE step_execution_id = ?
        ORDER BY created_at ASC, id ASC
      `,
      [stepExecutionId]
    );

    return rowsFromMariaDbResult<MariaDbPartitionExecutionRow>(result).map(toPartitionExecution);
  }

  async claimPartitionExecution(
    options: PartitionClaimOptions
  ): Promise<PartitionExecution | undefined> {
    return this.withTransaction(async (connection) => {
      const result = await connection.query(
        `
          SELECT
            id,
            step_execution_id,
            step_name,
            status,
            partition,
            owner_id,
            read_count,
            write_count,
            skip_count,
            retry_count,
            created_at,
            started_at,
            ended_at,
            failure_reason
          FROM ${this.tables.partitionExecutions}
          WHERE step_execution_id = ?
            AND status = 'created'
          ORDER BY created_at ASC, id ASC
          LIMIT 1
          FOR UPDATE
        `,
        [options.stepExecutionId]
      );
      const [row] = rowsFromMariaDbResult<MariaDbPartitionExecutionRow>(result);

      if (!row) {
        return undefined;
      }

      const claimed: PartitionExecution = {
        ...toPartitionExecution(row),
        status: "running",
        ownerId: options.ownerId,
        startedAt: options.now
      };

      await this.updatePartitionExecutionWithConnection(connection, claimed);

      return claimed;
    });
  }

  private async withTransaction<T>(
    operation: (connection: MariaDbExecutor) => Promise<T>
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
    connection: MariaDbExecutor,
    jobName: string,
    parametersHash: JobParametersHash
  ): Promise<JobInstance | undefined> {
    const result = await connection.query(
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
    const [row] = rowsFromMariaDbResult<MariaDbJobInstanceRow>(result);

    return row ? toJobInstance(row) : undefined;
  }

  private async findActiveJobExecutionWithConnection(
    connection: MariaDbExecutor,
    instanceId: JobInstanceId
  ): Promise<JobExecution | undefined> {
    const result = await connection.query(
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
    const [row] = rowsFromMariaDbResult<MariaDbJobExecutionRow>(result);

    return row ? toJobExecution(row) : undefined;
  }

  private async createWithConnection(
    connection: MariaDbExecutor,
    execution: JobExecution
  ): Promise<void> {
    await connection.query(
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
        stringifyMariaDbJson(execution.parameters),
        execution.createdAt,
        execution.startedAt ?? null,
        execution.endedAt ?? null,
        execution.failureReason ?? null
      ]
    );
  }

  private async updatePartitionExecutionWithConnection(
    connection: MariaDbExecutor,
    execution: PartitionExecution
  ): Promise<void> {
    await connection.query(
      `
        UPDATE ${this.tables.partitionExecutions}
        SET
          step_execution_id = ?,
          step_name = ?,
          status = ?,
          partition = ?,
          owner_id = ?,
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
        execution.stepExecutionId,
        execution.stepName,
        execution.status,
        stringifyMariaDbJson(execution.partition),
        execution.ownerId ?? null,
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
}

type MariaDbExecutor = Pick<MariaDbConnectionLike, "query">;
