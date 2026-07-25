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
import { resolvePostgresPool } from "../driver.js";
import { toJobExecution, toJobInstance, toPartitionExecution, toStepExecution } from "./mapper.js";
import type { PostgresBatchOptions } from "../options.js";
import type { PostgresClientLike, PostgresPoolLike } from "../options.js";
import {
  createPostgresTables,
  rowsFromPostgresResult,
  stringifyPostgresJson,
  type PostgresJobExecutionRow,
  type PostgresJobInstanceRow,
  type PostgresPartitionExecutionRow,
  type PostgresStepExecutionRow,
  type PostgresTables
} from "../sql.js";

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

  async createExecutionAttempt(
    instance: JobInstance,
    execution: JobExecution
  ): Promise<JobExecutionAttempt> {
    return this.withTransaction(async (client) => {
      await client.query(
        `
          INSERT INTO ${this.tables.jobInstances} (
            id,
            job_name,
            parameters_hash,
            parameters,
            created_at
          )
          VALUES ($1, $2, $3, $4::jsonb, $5)
          ON CONFLICT (job_name, parameters_hash) DO NOTHING
        `,
        [
          instance.id,
          instance.jobName,
          instance.parametersHash,
          stringifyPostgresJson(instance.parameters),
          instance.createdAt
        ]
      );

      const storedInstance = await this.findJobInstanceWithClient(
        client,
        instance.jobName,
        instance.parametersHash
      );

      if (!storedInstance) {
        throw new Error(`Failed to create job instance "${instance.id}".`);
      }

      const activeExecution = await this.findActiveJobExecutionWithClient(client, storedInstance.id);

      if (activeExecution) {
        return { instance: storedInstance, activeExecution };
      }

      await this.createWithClient(client, {
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
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        execution.id,
        execution.stepExecutionId,
        execution.stepName,
        execution.status,
        stringifyPostgresJson(execution.partition),
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
    await this.updatePartitionExecutionWithClient(this.pool, execution);
  }

  async findPartitionExecutions(
    stepExecutionId: BatchStepExecutionId
  ): Promise<readonly PartitionExecution[]> {
    const result = await this.pool.query<PostgresPartitionExecutionRow>(
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
        WHERE step_execution_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [stepExecutionId]
    );

    return rowsFromPostgresResult<PostgresPartitionExecutionRow>(result).map(toPartitionExecution);
  }

  async claimPartitionExecution(
    options: PartitionClaimOptions
  ): Promise<PartitionExecution | undefined> {
    return this.withTransaction(async (client) => {
      const result = await client.query<PostgresPartitionExecutionRow>(
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
          WHERE step_execution_id = $1
            AND status = 'created'
          ORDER BY created_at ASC, id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `,
        [options.stepExecutionId]
      );
      const [row] = rowsFromPostgresResult<PostgresPartitionExecutionRow>(result);

      if (!row) {
        return undefined;
      }

      const claimed: PartitionExecution = {
        ...toPartitionExecution(row),
        status: "running",
        ownerId: options.ownerId,
        startedAt: options.now
      };

      await this.updatePartitionExecutionWithClient(client, claimed);

      return claimed;
    });
  }

  private async withTransaction<T>(
    operation: (client: PostgresClientLike) => Promise<T>
  ): Promise<T> {
    if (!this.pool.connect) {
      return operation(this.pool);
    }

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release?.();
    }
  }

  private async findJobInstanceWithClient(
    client: PostgresClientLike,
    jobName: string,
    parametersHash: JobParametersHash
  ): Promise<JobInstance | undefined> {
    const result = await client.query<PostgresJobInstanceRow>(
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
        FOR UPDATE
      `,
      [jobName, parametersHash]
    );
    const [row] = rowsFromPostgresResult<PostgresJobInstanceRow>(result);

    return row ? toJobInstance(row) : undefined;
  }

  private async findActiveJobExecutionWithClient(
    client: PostgresClientLike,
    instanceId: JobInstanceId
  ): Promise<JobExecution | undefined> {
    const result = await client.query<PostgresJobExecutionRow>(
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

  private async createWithClient(
    client: PostgresClientLike,
    execution: JobExecution
  ): Promise<void> {
    await client.query(
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

  private async updatePartitionExecutionWithClient(
    client: PostgresClientLike,
    execution: PartitionExecution
  ): Promise<void> {
    await client.query(
      `
        UPDATE ${this.tables.partitionExecutions}
        SET
          step_execution_id = $1,
          step_name = $2,
          status = $3,
          partition = $4::jsonb,
          owner_id = $5,
          read_count = $6,
          write_count = $7,
          skip_count = $8,
          retry_count = $9,
          created_at = $10,
          started_at = $11,
          ended_at = $12,
          failure_reason = $13
        WHERE id = $14
      `,
      [
        execution.stepExecutionId,
        execution.stepName,
        execution.status,
        stringifyPostgresJson(execution.partition),
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
