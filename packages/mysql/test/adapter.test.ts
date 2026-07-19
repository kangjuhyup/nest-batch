import type { BatchExecutionId, JobExecution, JobInstance, StepExecution } from "@nest-batch/core";
import { describe, expect, it } from "vitest";
import {
  MySqlCheckpointStore,
  MySqlJobRepository,
  MySqlLockManager,
  ensureMySqlSchema
} from "../src/index.js";

interface MySqlCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

class FakeMySqlPool {
  readonly calls: MySqlCall[] = [];
  private readonly results: unknown[] = [];

  queueRows(rows: readonly Record<string, unknown>[]): void {
    this.results.push([rows, []]);
  }

  queueResult(affectedRows: number): void {
    this.results.push([{ affectedRows }, []]);
  }

  queueError(error: Error): void {
    this.results.push(error);
  }

  async execute(sql: string, values: readonly unknown[] = []): Promise<unknown> {
    this.calls.push({ sql, values });
    const result = this.results.shift();

    if (result instanceof Error) {
      throw result;
    }

    return result ?? [{ affectedRows: 0 }, []];
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

describe("mysql adapter / mysql adapter를 검증한다", () => {
  it("constructs driver backed adapters with explicit options / 명시한 option으로 driver 기반 adapter를 생성한다", () => {
    const options = { connectionString: "mysql://localhost/nest_batch", database: "nest_batch" };

    expect(new MySqlJobRepository(options)).toBeInstanceOf(MySqlJobRepository);
    expect(new MySqlCheckpointStore(options)).toBeInstanceOf(MySqlCheckpointStore);
    expect(new MySqlLockManager(options)).toBeInstanceOf(MySqlLockManager);
  });

  it("persists and reads job executions through the mysql driver / mysql driver로 job execution을 저장하고 읽는다", async () => {
    const pool = new FakeMySqlPool();
    const repository = new MySqlJobRepository({ pool, database: "batch", tablePrefix: "nb" });
    const createdAt = new Date("2026-07-19T00:00:00.000Z");
    const startedAt = new Date("2026-07-19T00:01:00.000Z");
    const endedAt = new Date("2026-07-19T00:02:00.000Z");

    pool.queueResult(1);
    await repository.create(createExecution({ createdAt }));

    expect(pool.calls[0]?.sql).toContain("INSERT INTO `batch`.`nb_job_executions`");
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

    expect(pool.calls[1]?.sql).toContain("UPDATE `batch`.`nb_job_executions`");
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
        parameters: JSON.stringify({ tenant: "acme" }),
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

    expect(pool.calls[3]?.sql).toContain("INSERT INTO `batch`.`nb_step_executions`");
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

    expect(pool.calls[4]?.sql).toContain("UPDATE `batch`.`nb_step_executions`");
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
    const pool = new FakeMySqlPool();
    const repository = new MySqlJobRepository({ pool, database: "batch", tablePrefix: "nb" });
    const createdAt = new Date("2026-07-19T00:00:00.000Z");

    pool.queueResult(1);
    await expect(repository.createJobInstance(createInstance({ createdAt }))).resolves.toEqual(
      createInstance({ createdAt })
    );

    expect(pool.calls[0]?.sql).toContain("INSERT INTO `batch`.`nb_job_instances`");
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
        parameters: JSON.stringify({ tenant: "acme" }),
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
        parameters: JSON.stringify({ tenant: "acme" }),
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
        parameters: JSON.stringify({ tenant: "acme" }),
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

  it("stores and removes checkpoints through upsert SQL / upsert SQL로 checkpoint를 저장하고 삭제한다", async () => {
    const pool = new FakeMySqlPool();
    const store = new MySqlCheckpointStore({ pool, tablePrefix: "nb" });

    pool.queueResult(1);
    await store.write("execution-1", "load-users", { cursor: 20 });

    expect(pool.calls[0]?.sql).toContain("INSERT INTO `nb_checkpoints`");
    expect(pool.calls[0]?.sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(pool.calls[0]?.values).toEqual(["execution-1", "load-users", JSON.stringify({ cursor: 20 })]);

    pool.queueRows([{ checkpoint: JSON.stringify({ cursor: 20 }) }]);
    await expect(store.read("execution-1", "load-users")).resolves.toEqual({ cursor: 20 });

    pool.queueResult(1);
    await store.delete("execution-1", "load-users");

    expect(pool.calls[2]?.sql).toContain("DELETE FROM `nb_checkpoints`");
    expect(pool.calls[2]?.values).toEqual(["execution-1", "load-users"]);
  });

  it("acquires releases and rejects busy locks through the mysql driver / mysql driver로 lock 획득 해제 충돌을 처리한다", async () => {
    const pool = new FakeMySqlPool();
    const lockManager = new MySqlLockManager({ pool, tablePrefix: "nb" });

    pool.queueResult(0);
    pool.queueResult(0);
    pool.queueResult(1);

    const handle = await lockManager.acquire("job:daily-user-import", "worker-1", { ttlMs: 30_000 });

    expect(handle?.resource).toBe("job:daily-user-import");
    expect(handle?.ownerId).toBe("worker-1");
    expect(handle?.expiresAt).toBeInstanceOf(Date);
    expect(pool.calls[0]?.sql).toContain("UPDATE `nb_locks`");
    expect(pool.calls[1]?.sql).toContain("DELETE FROM `nb_locks`");
    expect(pool.calls[1]?.sql).toContain("expires_at <= CURRENT_TIMESTAMP(3)");
    expect(pool.calls[2]?.sql).toContain("INSERT INTO `nb_locks`");

    pool.queueResult(0);
    pool.queueResult(0);
    pool.queueError(Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" }));

    await expect(lockManager.acquire("job:daily-user-import", "worker-2")).resolves.toBeUndefined();

    pool.queueResult(1);
    await lockManager.release({ resource: "job:daily-user-import", ownerId: "worker-1" });

    expect(pool.calls[6]?.sql).toContain("DELETE FROM `nb_locks`");
    expect(pool.calls[6]?.values).toEqual(["job:daily-user-import", "worker-1"]);
  });

  it("creates schema tables with qualified mysql identifiers / 정규화한 mysql identifier로 schema table을 생성한다", async () => {
    const pool = new FakeMySqlPool();

    for (let index = 0; index < 5; index += 1) {
      pool.queueResult(1);
    }
    await ensureMySqlSchema({ pool, database: "batch", tablePrefix: "nb" });

    expect(pool.calls.map((call) => call.sql)).toEqual([
      expect.stringContaining("CREATE TABLE IF NOT EXISTS `batch`.`nb_job_instances`"),
      expect.stringContaining("CREATE TABLE IF NOT EXISTS `batch`.`nb_job_executions`"),
      expect.stringContaining("CREATE TABLE IF NOT EXISTS `batch`.`nb_step_executions`"),
      expect.stringContaining("CREATE TABLE IF NOT EXISTS `batch`.`nb_checkpoints`"),
      expect.stringContaining("CREATE TABLE IF NOT EXISTS `batch`.`nb_locks`")
    ]);
  });

  it("rejects unsafe table prefixes / 안전하지 않은 table prefix를 거부한다", () => {
    expect(() => new MySqlJobRepository({ pool: new FakeMySqlPool(), tablePrefix: "bad-prefix" })).toThrow(
      "Invalid MySQL tablePrefix identifier."
    );
  });
});
