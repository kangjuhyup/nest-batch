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

    expect(pool.calls).toHaveLength(6);
    expect(pool.calls[0]).toContain('CREATE SCHEMA IF NOT EXISTS "batch"');
    expect(pool.calls[1]).toContain('CREATE TABLE IF NOT EXISTS "batch"."nb_job_executions"');
    expect(pool.calls[2]).toContain('CREATE INDEX IF NOT EXISTS "idx_nb_job_executions_job_status"');
    expect(pool.calls[3]).toContain('CREATE TABLE IF NOT EXISTS "batch"."nb_checkpoints"');
    expect(pool.calls[4]).toContain('CREATE TABLE IF NOT EXISTS "batch"."nb_locks"');
    expect(pool.calls[5]).toContain('CREATE INDEX IF NOT EXISTS "idx_nb_locks_expires_at"');
    expect(pool.closed).toBe(false);
  });
});
