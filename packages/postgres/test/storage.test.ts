import { DatabaseBatchStorage } from "@nest-batch/core";
import { describe, expect, it } from "vitest";
import {
  PostgresBatchStorage,
  PostgresCheckpointStore,
  PostgresJobRepository,
  PostgresLockManager
} from "../src/index.js";

class FakePostgresPool {
  readonly calls: string[] = [];
  closed = false;

  async query(sql: string): Promise<unknown> {
    this.calls.push(sql);
    return { rows: [], rowCount: 1 };
  }

  async end(): Promise<void> {
    this.closed = true;
  }
}

describe("postgres batch storage / postgres batch storage를 검증한다", () => {
  it("implements DatabaseBatchStorage with postgres adapters / postgres adapter로 DatabaseBatchStorage를 구현한다", () => {
    const options = { pool: new FakePostgresPool(), schema: "batch" };
    const storage = new PostgresBatchStorage(options);

    expect(storage).toBeInstanceOf(DatabaseBatchStorage);
    expect(storage.repository).toBeInstanceOf(PostgresJobRepository);
    expect(storage.checkpointStore).toBeInstanceOf(PostgresCheckpointStore);
    expect(storage.lockManager).toBeInstanceOf(PostgresLockManager);
  });

  it("initializes schema through the shared postgres pool / 공유 postgres pool로 schema를 초기화한다", async () => {
    const pool = new FakePostgresPool();
    const storage = new PostgresBatchStorage({ pool, schema: "batch", tablePrefix: "nb" });

    await storage.initialize();
    await storage.close();

    expect(pool.calls).toHaveLength(14);
    expect(pool.calls[0]).toContain('CREATE SCHEMA IF NOT EXISTS "batch"');
    expect(pool.calls[1]).toContain('CREATE TABLE IF NOT EXISTS "batch"."nb_job_instances"');
    expect(pool.calls[2]).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "idx_nb_job_instances_job_parameters"');
    expect(pool.calls[3]).toContain('CREATE TABLE IF NOT EXISTS "batch"."nb_job_executions"');
    expect(pool.calls[4]).toContain('CREATE INDEX IF NOT EXISTS "idx_nb_job_executions_job_status"');
    expect(pool.calls[5]).toContain('CREATE INDEX IF NOT EXISTS "idx_nb_job_executions_instance_status"');
    expect(pool.calls[6]).toContain('CREATE TABLE IF NOT EXISTS "batch"."nb_step_executions"');
    expect(pool.calls[7]).toContain('CREATE INDEX IF NOT EXISTS "idx_nb_step_executions_job_step_status"');
    expect(pool.calls[8]).toContain('CREATE TABLE IF NOT EXISTS "batch"."nb_partition_executions"');
    expect(pool.calls[9]).toContain('CREATE INDEX IF NOT EXISTS "idx_nb_partition_executions_step_status"');
    expect(pool.calls[10]).toContain('CREATE TABLE IF NOT EXISTS "batch"."nb_checkpoints"');
    expect(pool.calls[11]).toContain('CREATE TABLE IF NOT EXISTS "batch"."nb_execution_contexts"');
    expect(pool.calls[12]).toContain('CREATE TABLE IF NOT EXISTS "batch"."nb_locks"');
    expect(pool.calls[13]).toContain('CREATE INDEX IF NOT EXISTS "idx_nb_locks_expires_at"');
    expect(pool.closed).toBe(false);
  });
});
