import type { JobExecution, JobInstance, PartitionExecution, StepExecution } from "@nest-batch/core";
import { describe, expect, it } from "vitest";
import {
  PostgresCheckpointStore,
  PostgresJobRepository,
  PostgresLockManager,
  ensurePostgresSchema
} from "../src/index.js";

interface PostgresCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

class FakePostgresPool {
  readonly calls: PostgresCall[] = [];
  releasedConnections = 0;
  private readonly results: unknown[] = [];

  queueRows(rows: readonly Record<string, unknown>[]): void {
    this.results.push({ rows, rowCount: rows.length });
  }

  queueResult(rowCount: number): void {
    this.results.push({ rows: [], rowCount });
  }

  queueError(error: Error): void {
    this.results.push(error);
  }

  async query(sql: string, values: readonly unknown[] = []): Promise<unknown> {
    this.calls.push({ sql, values });
    const result = this.results.shift();

    if (result instanceof Error) {
      throw result;
    }

    return result ?? { rows: [], rowCount: 0 };
  }

  async connect(): Promise<{ query: FakePostgresPool["query"]; release(): void }> {
    return {
      query: (sql, values) => this.query(sql, values),
      release: () => {
        this.releasedConnections += 1;
      }
    };
  }
}

const createExecution = (overrides: Partial<JobExecution> = {}): JobExecution => ({
  id: "execution-1",
  instanceId: "instance-1",
  jobName: "daily-user-import",
  status: "created",
  parameters: { tenant: "acme" },
  createdAt: new Date("2026-07-19T00:00:00.000Z"),
  ...overrides
});

const createInstance = (overrides: Partial<JobInstance> = {}): JobInstance => ({
  id: "instance-1",
  jobName: "daily-user-import",
  parametersHash: "sha256:parameters",
  parameters: { tenant: "acme" },
  createdAt: new Date("2026-07-19T00:00:00.000Z"),
  ...overrides
});

const createStepExecution = (overrides: Partial<StepExecution> = {}): StepExecution => ({
  id: "step-execution-1",
  jobExecutionId: "execution-1",
  stepName: "load-users",
  status: "created",
  readCount: 0,
  writeCount: 0,
  skipCount: 0,
  retryCount: 0,
  createdAt: new Date("2026-07-19T00:00:00.000Z"),
  ...overrides
});

const createPartitionExecution = (
  overrides: Partial<PartitionExecution<{ readonly shard: number }>> = {}
): PartitionExecution<{ readonly shard: number }> => ({
  id: "partition-1",
  stepExecutionId: "step-execution-1",
  stepName: "load-users",
  status: "created",
  partition: { shard: 0 },
  heartbeatAt: undefined,
  claimExpiresAt: undefined,
  readCount: 0,
  writeCount: 0,
  skipCount: 0,
  retryCount: 0,
  createdAt: new Date("2026-07-19T00:00:00.000Z"),
  ...overrides
});

describe("postgres adapter / postgres adapter를 검증한다", () => {
  it("constructs driver backed adapters with explicit options / 명시한 option으로 driver 기반 adapter를 생성한다", () => {
    const options = { connectionString: "postgres://localhost/nest_batch", schema: "batch" };

    expect(new PostgresJobRepository(options)).toBeInstanceOf(PostgresJobRepository);
    expect(new PostgresCheckpointStore(options)).toBeInstanceOf(PostgresCheckpointStore);
    expect(new PostgresLockManager(options)).toBeInstanceOf(PostgresLockManager);
  });

  it("persists and reads job executions through the postgres driver / postgres driver로 job execution을 저장하고 읽는다", async () => {
    const pool = new FakePostgresPool();
    const repository = new PostgresJobRepository({ pool, schema: "batch", tablePrefix: "nb" });
    const createdAt = new Date("2026-07-19T00:00:00.000Z");
    const startedAt = new Date("2026-07-19T00:01:00.000Z");
    const endedAt = new Date("2026-07-19T00:02:00.000Z");

    pool.queueResult(1);
    await repository.create(createExecution({ createdAt }));

    expect(pool.calls[0]?.sql).toContain('INSERT INTO "batch"."nb_job_executions"');
    expect(pool.calls[0]?.sql).toContain("$1");
    expect(pool.calls[0]?.values).toEqual([
      "execution-1",
      "instance-1",
      "daily-user-import",
      "created",
      JSON.stringify({ tenant: "acme" }),
      createdAt,
      null,
      null,
      null
    ]);

    pool.queueResult(1);
    await repository.update(createExecution({ status: "completed", createdAt, startedAt, endedAt }));

    expect(pool.calls[1]?.sql).toContain('UPDATE "batch"."nb_job_executions"');
    expect(pool.calls[1]?.values).toEqual([
      "instance-1",
      "daily-user-import",
      "completed",
      JSON.stringify({ tenant: "acme" }),
      createdAt,
      startedAt,
      endedAt,
      null,
      "execution-1"
    ]);

    pool.queueRows([
      {
        id: "execution-1",
        instance_id: "instance-1",
        job_name: "daily-user-import",
        status: "completed",
        parameters: { tenant: "acme" },
        created_at: createdAt,
        started_at: startedAt,
        ended_at: endedAt,
        failure_reason: null
      }
    ]);

    await expect(repository.findById("execution-1")).resolves.toEqual({
      id: "execution-1",
      instanceId: "instance-1",
      jobName: "daily-user-import",
      status: "completed",
      parameters: { tenant: "acme" },
      createdAt,
      startedAt,
      endedAt
    });

    const stepCreatedAt = new Date("2026-07-19T00:03:00.000Z");
    const stepStartedAt = new Date("2026-07-19T00:04:00.000Z");
    const stepEndedAt = new Date("2026-07-19T00:05:00.000Z");

    pool.queueResult(1);
    await repository.createStepExecution(createStepExecution({ createdAt: stepCreatedAt }));

    expect(pool.calls[3]?.sql).toContain('INSERT INTO "batch"."nb_step_executions"');
    expect(pool.calls[3]?.values).toEqual([
      "step-execution-1",
      "execution-1",
      "load-users",
      "created",
      0,
      0,
      0,
      0,
      stepCreatedAt,
      null,
      null,
      null
    ]);

    pool.queueResult(1);
    await repository.updateStepExecution(
      createStepExecution({
        status: "completed",
        readCount: 3,
        writeCount: 2,
        skipCount: 1,
        createdAt: stepCreatedAt,
        startedAt: stepStartedAt,
        endedAt: stepEndedAt
      })
    );

    expect(pool.calls[4]?.sql).toContain('UPDATE "batch"."nb_step_executions"');
    expect(pool.calls[4]?.values).toEqual([
      "execution-1",
      "load-users",
      "completed",
      3,
      2,
      1,
      0,
      stepCreatedAt,
      stepStartedAt,
      stepEndedAt,
      null,
      "step-execution-1"
    ]);

    pool.queueRows([
      {
        id: "step-execution-1",
        job_execution_id: "execution-1",
        step_name: "load-users",
        status: "completed",
        read_count: 3,
        write_count: 2,
        skip_count: 1,
        retry_count: 0,
        created_at: stepCreatedAt,
        started_at: stepStartedAt,
        ended_at: stepEndedAt,
        failure_reason: null
      }
    ]);

    await expect(repository.findStepExecutions("execution-1")).resolves.toEqual([
      {
        id: "step-execution-1",
        jobExecutionId: "execution-1",
        stepName: "load-users",
        status: "completed",
        readCount: 3,
        writeCount: 2,
        skipCount: 1,
        retryCount: 0,
        createdAt: stepCreatedAt,
        startedAt: stepStartedAt,
        endedAt: stepEndedAt
      }
    ]);
  });

  it("persists job instances and finds active executions / job instance를 저장하고 실행 중 execution을 조회한다", async () => {
    const pool = new FakePostgresPool();
    const repository = new PostgresJobRepository({ pool, schema: "batch", tablePrefix: "nb" });
    const createdAt = new Date("2026-07-19T00:00:00.000Z");

    pool.queueResult(1);
    await expect(repository.createJobInstance(createInstance({ createdAt }))).resolves.toEqual(
      createInstance({ createdAt })
    );

    expect(pool.calls[0]?.sql).toContain('INSERT INTO "batch"."nb_job_instances"');
    expect(pool.calls[0]?.values).toEqual([
      "instance-1",
      "daily-user-import",
      "sha256:parameters",
      JSON.stringify({ tenant: "acme" }),
      createdAt
    ]);

    pool.queueRows([
      {
        id: "instance-1",
        job_name: "daily-user-import",
        parameters_hash: "sha256:parameters",
        parameters: { tenant: "acme" },
        created_at: createdAt
      }
    ]);

    await expect(repository.findJobInstance("daily-user-import", "sha256:parameters")).resolves.toEqual(
      createInstance({ createdAt })
    );

    pool.queueRows([
      {
        id: "execution-1",
        instance_id: "instance-1",
        job_name: "daily-user-import",
        status: "running",
        parameters: { tenant: "acme" },
        created_at: createdAt,
        started_at: createdAt,
        ended_at: null,
        failure_reason: null
      }
    ]);

    await expect(repository.findActiveJobExecution("instance-1")).resolves.toEqual({
      id: "execution-1",
      instanceId: "instance-1",
      jobName: "daily-user-import",
      status: "running",
      parameters: { tenant: "acme" },
      createdAt,
      startedAt: createdAt
    });

    pool.queueRows([
      {
        id: "failed-execution",
        instance_id: "instance-1",
        job_name: "daily-user-import",
        status: "failed",
        parameters: { tenant: "acme" },
        created_at: createdAt,
        started_at: createdAt,
        ended_at: createdAt,
        failure_reason: "writer unavailable"
      }
    ]);

    await expect(repository.findLatestFailedJobExecution("instance-1")).resolves.toEqual({
      id: "failed-execution",
      instanceId: "instance-1",
      jobName: "daily-user-import",
      status: "failed",
      parameters: { tenant: "acme" },
      createdAt,
      startedAt: createdAt,
      endedAt: createdAt,
      failureReason: "writer unavailable"
    });
    expect(pool.calls[3]?.sql).toContain("status = 'failed'");
    expect(pool.calls[3]?.sql).toContain("ORDER BY created_at DESC, id DESC");
  });

  it("creates execution attempts inside a postgres transaction / postgres transaction 안에서 execution attempt를 생성한다", async () => {
    const pool = new FakePostgresPool();
    const repository = new PostgresJobRepository({ pool, schema: "batch", tablePrefix: "nb" });
    const createdAt = new Date("2026-07-19T00:00:00.000Z");

    pool.queueResult(1);
    pool.queueResult(1);
    pool.queueRows([
      {
        id: "instance-1",
        job_name: "daily-user-import",
        parameters_hash: "sha256:parameters",
        parameters: { tenant: "acme" },
        created_at: createdAt
      }
    ]);
    pool.queueRows([]);
    pool.queueResult(1);
    pool.queueResult(1);

    await expect(
      repository.createExecutionAttempt(
        createInstance({ createdAt }),
        createExecution({ createdAt })
      )
    ).resolves.toEqual({ instance: createInstance({ createdAt }) });

    expect(pool.calls.map((call) => call.sql.trim().split(/\s+/)[0])).toEqual([
      "BEGIN",
      "INSERT",
      "SELECT",
      "SELECT",
      "INSERT",
      "COMMIT"
    ]);
    expect(pool.calls[1]?.sql).toContain('INSERT INTO "batch"."nb_job_instances"');
    expect(pool.calls[1]?.sql).toContain("ON CONFLICT (job_name, parameters_hash) DO NOTHING");
    expect(pool.calls[2]?.sql).toContain("FOR UPDATE");
    expect(pool.calls[4]?.sql).toContain('INSERT INTO "batch"."nb_job_executions"');
    expect(pool.releasedConnections).toBe(1);
  });

  it("persists partition executions through the postgres driver / postgres driver로 partition execution을 저장한다", async () => {
    const pool = new FakePostgresPool();
    const repository = new PostgresJobRepository({ pool, schema: "batch", tablePrefix: "nb" });
    const createdAt = new Date("2026-07-19T00:00:00.000Z");
    const startedAt = new Date("2026-07-19T00:01:00.000Z");
    const endedAt = new Date("2026-07-19T00:02:00.000Z");

    pool.queueResult(1);
    await repository.createPartitionExecution(createPartitionExecution({ createdAt }));

    expect(pool.calls[0]?.sql).toContain('INSERT INTO "batch"."nb_partition_executions"');
    expect(pool.calls[0]?.values).toEqual([
      "partition-1",
      "step-execution-1",
      "load-users",
      "created",
      JSON.stringify({ shard: 0 }),
      null,
      null,
      null,
      0,
      0,
      0,
      0,
      createdAt,
      null,
      null,
      null
    ]);

    pool.queueResult(1);
    await repository.updatePartitionExecution(
      createPartitionExecution({
        status: "completed",
        ownerId: "worker-1",
        readCount: 10,
        writeCount: 9,
        skipCount: 1,
        retryCount: 2,
        createdAt,
        startedAt,
        endedAt
      })
    );

    expect(pool.calls[1]?.sql).toContain('UPDATE "batch"."nb_partition_executions"');
    expect(pool.calls[1]?.values).toEqual([
      "step-execution-1",
      "load-users",
      "completed",
      JSON.stringify({ shard: 0 }),
      "worker-1",
      null,
      null,
      10,
      9,
      1,
      2,
      createdAt,
      startedAt,
      endedAt,
      null,
      "partition-1"
    ]);

    pool.queueRows([
      {
        id: "partition-1",
        step_execution_id: "step-execution-1",
        step_name: "load-users",
        status: "completed",
        partition: { shard: 0 },
        owner_id: "worker-1",
        heartbeat_at: null,
        claim_expires_at: null,
        read_count: 10,
        write_count: 9,
        skip_count: 1,
        retry_count: 2,
        created_at: createdAt,
        started_at: startedAt,
        ended_at: endedAt,
        failure_reason: null
      }
    ]);

    await expect(repository.findPartitionExecutions("step-execution-1")).resolves.toEqual([
      createPartitionExecution({
        status: "completed",
        ownerId: "worker-1",
        readCount: 10,
        writeCount: 9,
        skipCount: 1,
        retryCount: 2,
        createdAt,
        startedAt,
        endedAt
      })
    ]);
  });

  it("claims partition executions with postgres row locking / postgres row lock으로 partition execution을 claim한다", async () => {
    const pool = new FakePostgresPool();
    const repository = new PostgresJobRepository({ pool, schema: "batch", tablePrefix: "nb" });
    const createdAt = new Date("2026-07-19T00:00:00.000Z");
    const claimedAt = new Date("2026-07-19T00:01:00.000Z");

    pool.queueResult(1);
    pool.queueRows([
      {
        id: "partition-1",
        step_execution_id: "step-execution-1",
        step_name: "load-users",
        status: "created",
        partition: { shard: 0 },
        owner_id: null,
        heartbeat_at: null,
        claim_expires_at: null,
        read_count: 0,
        write_count: 0,
        skip_count: 0,
        retry_count: 0,
        created_at: createdAt,
        started_at: null,
        ended_at: null,
        failure_reason: null
      }
    ]);
    pool.queueResult(1);
    pool.queueResult(1);
    pool.queueResult(1);

    await expect(
      repository.claimPartitionExecution({
        stepExecutionId: "step-execution-1",
        ownerId: "worker-1",
        now: claimedAt
      })
    ).resolves.toEqual(
      createPartitionExecution({
        status: "running",
        ownerId: "worker-1",
        createdAt,
        heartbeatAt: claimedAt,
        startedAt: claimedAt
      })
    );

    expect(pool.calls.map((call) => call.sql.trim().split(/\s+/)[0])).toEqual([
      "BEGIN",
      "SELECT",
      "UPDATE",
      "COMMIT"
    ]);
    expect(pool.calls[1]?.sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(pool.calls[2]?.values).toContain("worker-1");
    expect(pool.releasedConnections).toBe(1);
  });

  it("recovers stale running partition executions / 오래된 running partition execution을 회수한다", async () => {
    const pool = new FakePostgresPool();
    const repository = new PostgresJobRepository({ pool, schema: "batch", tablePrefix: "nb" });
    const createdAt = new Date("2026-07-19T00:00:00.000Z");
    const heartbeatAt = new Date("2026-07-19T00:00:00.000Z");
    const claimedAt = new Date("2026-07-19T00:01:00.000Z");
    const staleBefore = new Date("2026-07-19T00:00:30.000Z");

    pool.queueResult(1);
    pool.queueRows([
      {
        id: "partition-1",
        step_execution_id: "step-execution-1",
        step_name: "load-users",
        status: "running",
        partition: { shard: 0 },
        owner_id: "dead-worker",
        heartbeat_at: heartbeatAt,
        claim_expires_at: null,
        read_count: 0,
        write_count: 0,
        skip_count: 0,
        retry_count: 0,
        created_at: createdAt,
        started_at: heartbeatAt,
        ended_at: null,
        failure_reason: null
      }
    ]);
    pool.queueResult(1);

    await expect(
      repository.claimPartitionExecution({
        stepExecutionId: "step-execution-1",
        ownerId: "worker-2",
        staleAfterMs: 30_000,
        now: claimedAt
      })
    ).resolves.toEqual(
      createPartitionExecution({
        status: "running",
        ownerId: "worker-2",
        createdAt,
        startedAt: heartbeatAt,
        heartbeatAt: claimedAt,
        claimExpiresAt: new Date("2026-07-19T00:01:30.000Z")
      })
    );

    expect(pool.calls[1]?.sql).toContain("heartbeat_at < $2::timestamptz");
    expect(pool.calls[1]?.values).toEqual(["step-execution-1", staleBefore]);
  });

  it("guards partition completion by owner / partition 완료를 owner로 보호한다", async () => {
    const pool = new FakePostgresPool();
    const repository = new PostgresJobRepository({ pool, schema: "batch", tablePrefix: "nb" });

    pool.queueResult(0);
    await expect(
      repository.completePartitionExecution(
        createPartitionExecution({
          status: "completed",
          ownerId: "worker-2"
        }),
        "worker-1"
      )
    ).resolves.toBe(false);

    pool.queueResult(1);
    await expect(
      repository.completePartitionExecution(
        createPartitionExecution({
          status: "completed",
          ownerId: "worker-1"
        }),
        "worker-1"
      )
    ).resolves.toBe(true);
    expect(pool.calls[0]?.sql).toContain("AND owner_id = $17");
  });

  it("stores and removes checkpoints through postgres upsert SQL / postgres upsert SQL로 checkpoint를 저장하고 삭제한다", async () => {
    const pool = new FakePostgresPool();
    const store = new PostgresCheckpointStore({ pool, tablePrefix: "nb" });

    pool.queueResult(1);
    await store.write("execution-1", "load-users", { cursor: 20 });

    expect(pool.calls[0]?.sql).toContain('INSERT INTO "nb_checkpoints"');
    expect(pool.calls[0]?.sql).toContain("ON CONFLICT (execution_id, step_name) DO UPDATE");
    expect(pool.calls[0]?.values).toEqual(["execution-1", "load-users", JSON.stringify({ cursor: 20 })]);

    pool.queueRows([{ checkpoint: { cursor: 20 } }]);
    await expect(store.read("execution-1", "load-users")).resolves.toEqual({ cursor: 20 });

    pool.queueResult(1);
    await store.delete("execution-1", "load-users");

    expect(pool.calls[2]?.sql).toContain('DELETE FROM "nb_checkpoints"');
    expect(pool.calls[2]?.values).toEqual(["execution-1", "load-users"]);
  });

  it("acquires releases and rejects busy locks through the postgres driver / postgres driver로 lock 획득 해제 충돌을 처리한다", async () => {
    const pool = new FakePostgresPool();
    const lockManager = new PostgresLockManager({ pool, tablePrefix: "nb" });

    pool.queueResult(0);
    pool.queueResult(0);
    pool.queueResult(1);

    const handle = await lockManager.acquire("job:daily-user-import", "worker-1", { ttlMs: 30_000 });

    expect(handle?.resource).toBe("job:daily-user-import");
    expect(handle?.ownerId).toBe("worker-1");
    expect(handle?.expiresAt).toBeInstanceOf(Date);
    expect(pool.calls[0]?.sql).toContain('UPDATE "nb_locks"');
    expect(pool.calls[1]?.sql).toContain('DELETE FROM "nb_locks"');
    expect(pool.calls[1]?.sql).toContain("expires_at <= CURRENT_TIMESTAMP(3)");
    expect(pool.calls[2]?.sql).toContain('INSERT INTO "nb_locks"');

    pool.queueResult(0);
    pool.queueResult(0);
    pool.queueError(Object.assign(new Error("duplicate"), { code: "23505" }));

    await expect(lockManager.acquire("job:daily-user-import", "worker-2")).resolves.toBeUndefined();

    pool.queueResult(1);
    await lockManager.release({ resource: "job:daily-user-import", ownerId: "worker-1" });

    expect(pool.calls[6]?.sql).toContain('DELETE FROM "nb_locks"');
    expect(pool.calls[6]?.values).toEqual(["job:daily-user-import", "worker-1"]);
  });

  it("creates schema tables with qualified postgres identifiers / 정규화한 postgres identifier로 schema table을 생성한다", async () => {
    const pool = new FakePostgresPool();

    for (let index = 0; index < 14; index += 1) {
      pool.queueResult(1);
    }
    await ensurePostgresSchema({ pool, schema: "batch", tablePrefix: "nb" });

    expect(pool.calls.map((call) => call.sql)).toEqual([
      expect.stringContaining('CREATE SCHEMA IF NOT EXISTS "batch"'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "batch"."nb_job_instances"'),
      expect.stringContaining('CREATE UNIQUE INDEX IF NOT EXISTS "idx_nb_job_instances_job_parameters"'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "batch"."nb_job_executions"'),
      expect.stringContaining('CREATE INDEX IF NOT EXISTS "idx_nb_job_executions_job_status"'),
      expect.stringContaining('CREATE INDEX IF NOT EXISTS "idx_nb_job_executions_instance_status"'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "batch"."nb_step_executions"'),
      expect.stringContaining('CREATE INDEX IF NOT EXISTS "idx_nb_step_executions_job_step_status"'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "batch"."nb_partition_executions"'),
      expect.stringContaining('CREATE INDEX IF NOT EXISTS "idx_nb_partition_executions_step_status"'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "batch"."nb_checkpoints"'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "batch"."nb_execution_contexts"'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "batch"."nb_locks"'),
      expect.stringContaining('CREATE INDEX IF NOT EXISTS "idx_nb_locks_expires_at"')
    ]);
  });

  it("rejects unsafe schema and table prefixes / 안전하지 않은 schema와 table prefix를 거부한다", () => {
    expect(() => new PostgresJobRepository({ pool: new FakePostgresPool(), schema: "bad-schema" })).toThrow(
      "Invalid Postgres schema identifier."
    );
    expect(() => new PostgresJobRepository({ pool: new FakePostgresPool(), tablePrefix: "bad-prefix" })).toThrow(
      "Invalid Postgres tablePrefix identifier."
    );
  });
});
