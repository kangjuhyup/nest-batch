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
import { resolveMySqlPool } from "../driver.js";
import { toJobExecution, toJobInstance, toPartitionExecution, toStepExecution } from "./mapper.js";
import type { MySqlBatchOptions } from "../options.js";
import type { MySqlConnectionLike, MySqlPoolLike } from "../options.js";
import {
  createMySqlTables,
  affectedRowsFromMySqlResult,
  rowsFromMySqlResult,
  stringifyMySqlJson,
  type MySqlJobExecutionRow,
  type MySqlJobInstanceRow,
  type MySqlPartitionExecutionRow,
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

  async createPartitionExecution(execution: PartitionExecution): Promise<void> {
    await this.pool.execute(
      `
        INSERT INTO ${this.tables.partitionExecutions} (
          id,
          step_execution_id,
          step_name,
          status,
          \`partition\`,
          owner_id,
          heartbeat_at,
          claim_expires_at,
          read_count,
          write_count,
          skip_count,
          retry_count,
          created_at,
          started_at,
          ended_at,
          failure_reason
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        execution.id,
        execution.stepExecutionId,
        execution.stepName,
        execution.status,
        stringifyMySqlJson(execution.partition),
        execution.ownerId ?? null,
        execution.heartbeatAt ?? null,
        execution.claimExpiresAt ?? null,
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
    const result = await this.pool.execute(
      `
        SELECT
          id,
          step_execution_id,
          step_name,
          status,
          \`partition\`,
          owner_id,
          heartbeat_at,
          claim_expires_at,
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

    return rowsFromMySqlResult<MySqlPartitionExecutionRow>(result).map(toPartitionExecution);
  }

  async claimPartitionExecution(
    options: PartitionClaimOptions
  ): Promise<PartitionExecution | undefined> {
    return this.withTransaction(async (connection) => {
      const result = await connection.execute(
        `
          SELECT
            id,
            step_execution_id,
            step_name,
            status,
            \`partition\`,
            owner_id,
            heartbeat_at,
            claim_expires_at,
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
            AND (
              status = 'created'
              OR (
                status = 'running'
                AND ? IS NOT NULL
                AND heartbeat_at IS NOT NULL
                AND heartbeat_at < ?
              )
            )
          ORDER BY
            CASE WHEN status = 'created' THEN 0 ELSE 1 END,
            created_at ASC,
            id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `,
        [options.stepExecutionId, createStaleBefore(options), createStaleBefore(options)]
      );
      const [row] = rowsFromMySqlResult<MySqlPartitionExecutionRow>(result);

      if (!row) {
        return undefined;
      }

      const execution = toPartitionExecution(row);
      const claimed: PartitionExecution = {
        ...execution,
        status: "running",
        ownerId: options.ownerId,
        heartbeatAt: options.now,
        claimExpiresAt: createClaimExpiresAt(options),
        startedAt: execution.startedAt ?? options.now
      };

      await this.updatePartitionExecutionWithConnection(connection, claimed);

      return claimed;
    });
  }

  async heartbeatPartitionExecution(id: string, ownerId: string, now: Date): Promise<boolean> {
    const result = await this.pool.execute(
      `
        UPDATE ${this.tables.partitionExecutions}
        SET heartbeat_at = ?
        WHERE id = ?
          AND owner_id = ?
          AND status = 'running'
      `,
      [now, id, ownerId]
    );

    return affectedRowsFromMySqlResult(result) > 0;
  }

  async completePartitionExecution(execution: PartitionExecution, ownerId: string): Promise<boolean> {
    return this.updateOwnedPartitionExecution(this.pool, execution, ownerId);
  }

  async failPartitionExecution(execution: PartitionExecution, ownerId: string): Promise<boolean> {
    return this.updateOwnedPartitionExecution(this.pool, execution, ownerId);
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

  private async updatePartitionExecutionWithConnection(
    connection: MySqlExecutor,
    execution: PartitionExecution
  ): Promise<void> {
    await connection.execute(
      `
        UPDATE ${this.tables.partitionExecutions}
        SET
          step_execution_id = ?,
          step_name = ?,
          status = ?,
          \`partition\` = ?,
          owner_id = ?,
          heartbeat_at = ?,
          claim_expires_at = ?,
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
        stringifyMySqlJson(execution.partition),
        execution.ownerId ?? null,
        execution.heartbeatAt ?? null,
        execution.claimExpiresAt ?? null,
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

  private async updateOwnedPartitionExecution(
    connection: MySqlExecutor,
    execution: PartitionExecution,
    ownerId: string
  ): Promise<boolean> {
    const result = await connection.execute(
      `
        UPDATE ${this.tables.partitionExecutions}
        SET
          step_execution_id = ?,
          step_name = ?,
          status = ?,
          \`partition\` = ?,
          owner_id = ?,
          heartbeat_at = ?,
          claim_expires_at = ?,
          read_count = ?,
          write_count = ?,
          skip_count = ?,
          retry_count = ?,
          created_at = ?,
          started_at = ?,
          ended_at = ?,
          failure_reason = ?
        WHERE id = ?
          AND owner_id = ?
      `,
      [
        execution.stepExecutionId,
        execution.stepName,
        execution.status,
        stringifyMySqlJson(execution.partition),
        execution.ownerId ?? null,
        execution.heartbeatAt ?? null,
        execution.claimExpiresAt ?? null,
        execution.readCount,
        execution.writeCount,
        execution.skipCount,
        execution.retryCount,
        execution.createdAt,
        execution.startedAt ?? null,
        execution.endedAt ?? null,
        execution.failureReason ?? null,
        execution.id,
        ownerId
      ]
    );

    return affectedRowsFromMySqlResult(result) > 0;
  }
}

const createStaleBefore = (options: PartitionClaimOptions): Date | null => {
  return options.staleAfterMs === undefined
    ? null
    : new Date(options.now.getTime() - options.staleAfterMs);
};

const createClaimExpiresAt = (options: PartitionClaimOptions): Date | undefined => {
  return options.staleAfterMs === undefined
    ? undefined
    : new Date(options.now.getTime() + options.staleAfterMs);
};

type MySqlExecutor = Pick<MySqlConnectionLike, "execute">;
