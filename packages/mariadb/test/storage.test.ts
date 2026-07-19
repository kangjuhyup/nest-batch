import { DatabaseBatchStorage } from "@nest-batch/core";
import { describe, expect, it } from "vitest";
import {
  MariaDbBatchStorage,
  MariaDbCheckpointStore,
  MariaDbJobRepository,
  MariaDbLockManager
} from "../src/index.js";

class FakeMariaDbPool {
  readonly calls: string[] = [];
  closed = false;

  async query(sql: string): Promise<unknown> {
    this.calls.push(sql);
    return { affectedRows: 1 };
  }

  async end(): Promise<void> {
    this.closed = true;
  }
}

describe("mariadb batch storage / mariadb batch storage를 검증한다", () => {
  it("implements DatabaseBatchStorage with mariadb adapters / mariadb adapter로 DatabaseBatchStorage를 구현한다", () => {
    const options = { pool: new FakeMariaDbPool(), database: "nest_batch" };
    const storage = new MariaDbBatchStorage(options);

    expect(storage).toBeInstanceOf(DatabaseBatchStorage);
    expect(storage.repository).toBeInstanceOf(MariaDbJobRepository);
    expect(storage.checkpointStore).toBeInstanceOf(MariaDbCheckpointStore);
    expect(storage.lockManager).toBeInstanceOf(MariaDbLockManager);
  });

  it("initializes schema through the shared mariadb pool / 공유 mariadb pool로 schema를 초기화한다", async () => {
    const pool = new FakeMariaDbPool();
    const storage = new MariaDbBatchStorage({ pool, database: "batch", tablePrefix: "nb" });

    await storage.initialize();
    await storage.close();

    expect(pool.calls).toHaveLength(5);
    expect(pool.calls[0]).toContain("CREATE TABLE IF NOT EXISTS `batch`.`nb_job_instances`");
    expect(pool.calls[1]).toContain("CREATE TABLE IF NOT EXISTS `batch`.`nb_job_executions`");
    expect(pool.calls[2]).toContain("CREATE TABLE IF NOT EXISTS `batch`.`nb_step_executions`");
    expect(pool.calls[3]).toContain("CREATE TABLE IF NOT EXISTS `batch`.`nb_checkpoints`");
    expect(pool.calls[4]).toContain("CREATE TABLE IF NOT EXISTS `batch`.`nb_locks`");
    expect(pool.closed).toBe(false);
  });
});
