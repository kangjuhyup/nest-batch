import { describe, expect, it } from "vitest";
import { PostgresBatchStorage, PostgresExecutionContextStore } from "../src/index.js";

class FakePostgresPool {
  readonly calls: Array<{ readonly sql: string; readonly values: readonly unknown[] }> = [];
  private readonly results: unknown[] = [];

  queueRows(rows: readonly Record<string, unknown>[]): void {
    this.results.push({ rows, rowCount: rows.length });
  }

  async query(sql: string, values: readonly unknown[] = []): Promise<unknown> {
    this.calls.push({ sql, values });
    return this.results.shift() ?? { rows: [], rowCount: 0 };
  }
}

describe("postgres execution context store / postgres execution context store를 검증한다", () => {
  it("connects execution context store to batch storage / batch storage에 execution context store를 연결한다", () => {
    const storage = new PostgresBatchStorage({ pool: new FakePostgresPool() });

    expect(storage.executionContextStore).toBeInstanceOf(PostgresExecutionContextStore);
  });

  it("reads writes merges and deletes context rows / context row를 조회 저장 병합 삭제한다", async () => {
    const pool = new FakePostgresPool();
    const store = new PostgresExecutionContextStore({ pool, schema: "batch", tablePrefix: "nb" });
    const key = { executionId: "execution-1", scope: "step" as const, name: "copy-users" };

    pool.queueRows([{ context: { cursor: 10, tenantId: "acme" } }]);
    await expect(store.read(key)).resolves.toEqual({ cursor: 10, tenantId: "acme" });

    await store.write(key, { cursor: 20 });

    pool.queueRows([{ context: { cursor: 20, tenantId: "acme" } }]);
    await expect(store.merge(key, { processed: 30 })).resolves.toEqual({
      cursor: 20,
      tenantId: "acme",
      processed: 30
    });

    await store.delete(key);

    expect(pool.calls[0]?.sql).toContain('FROM "batch"."nb_execution_contexts"');
    expect(pool.calls[1]?.sql).toContain('INSERT INTO "batch"."nb_execution_contexts"');
    expect(pool.calls[1]?.values).toEqual(["execution-1", "step", "copy-users", JSON.stringify({ cursor: 20 })]);
    expect(pool.calls.at(-1)?.sql).toContain('DELETE FROM "batch"."nb_execution_contexts"');
  });
});
