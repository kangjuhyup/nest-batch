import { DatabaseBatchStorage } from "@nest-batch/core";
import { describe, expect, it } from "vitest";
import { MySqlBatchStorage, MySqlCheckpointStore, MySqlJobRepository, MySqlLockManager } from "../src/index.js";

class FakeMySqlPool {
  readonly calls: string[] = [];
  closed = false;

  async execute(sql: string): Promise<unknown> {
    this.calls.push(sql);
    return [{ affectedRows: 1 }, []];
  }

  async end(): Promise<void> {
    this.closed = true;
  }
}

describe("mysql batch storage / mysql batch storage를 검증한다", () => {
  it("implements DatabaseBatchStorage with mysql adapters / mysql adapter로 DatabaseBatchStorage를 구현한다", () => {
    const options = { pool: new FakeMySqlPool(), database: "nest_batch" };
    const storage = new MySqlBatchStorage(options);

    expect(storage).toBeInstanceOf(DatabaseBatchStorage);
    expect(storage.repository).toBeInstanceOf(MySqlJobRepository);
    expect(storage.checkpointStore).toBeInstanceOf(MySqlCheckpointStore);
    expect(storage.lockManager).toBeInstanceOf(MySqlLockManager);
  });

  it("initializes schema through the shared mysql pool / 공유 mysql pool로 schema를 초기화한다", async () => {
    const pool = new FakeMySqlPool();
    const storage = new MySqlBatchStorage({ pool, database: "batch", tablePrefix: "nb" });

    await storage.initialize();
    await storage.close();

    expect(pool.calls).toHaveLength(7);
    expect(pool.calls[0]).toContain("CREATE TABLE IF NOT EXISTS `batch`.`nb_job_instances`");
    expect(pool.calls[1]).toContain("CREATE TABLE IF NOT EXISTS `batch`.`nb_job_executions`");
    expect(pool.calls[2]).toContain("CREATE TABLE IF NOT EXISTS `batch`.`nb_step_executions`");
    expect(pool.calls[3]).toContain("CREATE TABLE IF NOT EXISTS `batch`.`nb_partition_executions`");
    expect(pool.calls[4]).toContain("CREATE TABLE IF NOT EXISTS `batch`.`nb_checkpoints`");
    expect(pool.calls[5]).toContain("CREATE TABLE IF NOT EXISTS `batch`.`nb_execution_contexts`");
    expect(pool.calls[6]).toContain("CREATE TABLE IF NOT EXISTS `batch`.`nb_locks`");
    expect(pool.closed).toBe(false);
  });
});
