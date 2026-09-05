import { getReaderCheckpoint, openReader } from "@rv-nest-batch/core";
import { describe, expect, it } from "vitest";
import { createMySqlCursorReader } from "../src/index.js";
import type { MySqlCursorReaderOptions } from "../src/index.js";

interface ReaderUser {
  readonly id: string;
  readonly email: string;
  readonly active: boolean;
}

interface MySqlCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

class FakeMySqlReaderPool {
  readonly calls: MySqlCall[] = [];

  constructor(private readonly rows: readonly ReaderUser[]) {}

  async execute(sql: string, values: readonly unknown[] = []): Promise<unknown> {
    this.calls.push({ sql, values });

    const limit = Number(values[values.length - 1] ?? 0);
    const cursor = values.find(
      (value): value is string => typeof value === "string" && value.startsWith("user-")
    );
    const source = values.includes(true)
      ? this.rows.filter((row) => row.active)
      : this.rows;
    const startIndex = cursor
      ? source.findIndex((row) => row.id === cursor) + 1
      : 0;
    const rows = source.slice(startIndex, startIndex + limit);

    return [rows, []];
  }
}

const createContext = <TCheckpoint>(checkpoint?: TCheckpoint) => ({
  signal: new AbortController().signal,
  checkpoint
});

describe("mysql cursor reader / mysql cursor reader를 검증한다", () => {
  it("creates cursor SQL and advances checkpoint / cursor SQL을 만들고 checkpoint를 진행한다", async () => {
    const pool = new FakeMySqlReaderPool([
      { id: "user-1", email: "one@example.com", active: true },
      { id: "user-2", email: "two@example.com", active: false },
      { id: "user-3", email: "three@example.com", active: true },
      { id: "user-4", email: "four@example.com", active: true }
    ]);
    const options: MySqlCursorReaderOptions<ReaderUser, string> = {
      pool,
      table: "batch.users",
      cursorColumn: "id",
      columns: ["id", "email", "active"],
      where: "active = ?",
      values: [true],
      pageSize: 2,
      getCursor(user) {
        return user.id;
      }
    };
    const reader = createMySqlCursorReader(options);

    const opened = await openReader(reader, createContext({ cursor: "user-1" }));
    const ids: string[] = [];

    for await (const user of opened) {
      ids.push(user.id);
    }

    expect(ids).toEqual(["user-3", "user-4"]);
    await expect(getReaderCheckpoint(opened)).resolves.toEqual({ cursor: "user-4" });
    expect(pool.calls).toEqual([
      {
        sql: "SELECT `id`, `email`, `active` FROM `batch`.`users` WHERE (active = ?) AND `id` > ? ORDER BY `id` ASC LIMIT ?",
        values: [true, "user-1", 2]
      },
      {
        sql: "SELECT `id`, `email`, `active` FROM `batch`.`users` WHERE (active = ?) AND `id` > ? ORDER BY `id` ASC LIMIT ?",
        values: [true, "user-4", 2]
      }
    ]);
  });

  it("rejects invalid identifiers / 유효하지 않은 identifier를 거부한다", () => {
    const pool = new FakeMySqlReaderPool([]);

    expect(() =>
      createMySqlCursorReader<ReaderUser, string>({
        pool,
        table: "users;drop",
        cursorColumn: "id",
        pageSize: 10,
        getCursor(user) {
          return user.id;
        }
      })
    ).toThrow("MySQL cursor reader table must be a dot-separated SQL identifier.");
  });
});
