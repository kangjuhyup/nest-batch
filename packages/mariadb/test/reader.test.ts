import { getReaderCheckpoint, openReader } from "@nest-batch/core";
import { describe, expect, it } from "vitest";
import { createMariaDbCursorReader } from "../src/index.js";
import type { MariaDbCursorReaderOptions } from "../src/index.js";

interface ReaderProduct {
  readonly id: number;
  readonly name: string;
}

interface MariaDbCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

class FakeMariaDbReaderPool {
  readonly calls: MariaDbCall[] = [];

  constructor(private readonly rows: readonly ReaderProduct[]) {}

  async query(sql: string, values: readonly unknown[] = []): Promise<unknown> {
    this.calls.push({ sql, values });

    const limit = Number(values[values.length - 1] ?? 0);
    const cursor = values.find((value): value is number => typeof value === "number");
    const startIndex = cursor
      ? this.rows.findIndex((row) => row.id === cursor) + 1
      : 0;

    return this.rows.slice(startIndex, startIndex + limit);
  }
}

const createContext = <TCheckpoint>(checkpoint?: TCheckpoint) => ({
  signal: new AbortController().signal,
  checkpoint
});

describe("mariadb cursor reader / mariadb cursor reader를 검증한다", () => {
  it("creates cursor SQL and advances checkpoint / cursor SQL을 만들고 checkpoint를 진행한다", async () => {
    const pool = new FakeMariaDbReaderPool([
      { id: 1, name: "one" },
      { id: 2, name: "two" },
      { id: 3, name: "three" }
    ]);
    const options: MariaDbCursorReaderOptions<ReaderProduct, number> = {
      pool,
      table: "inventory.products",
      cursorColumn: "id",
      columns: ["id", "name"],
      pageSize: 2,
      getCursor(product) {
        return product.id;
      }
    };
    const reader = createMariaDbCursorReader(options);

    const opened = await openReader(reader, createContext({ cursor: 1 }));
    const names: string[] = [];

    for await (const product of opened) {
      names.push(product.name);
    }

    expect(names).toEqual(["two", "three"]);
    await expect(getReaderCheckpoint(opened)).resolves.toEqual({ cursor: 3 });
    expect(pool.calls).toEqual([
      {
        sql: "SELECT `id`, `name` FROM `inventory`.`products` WHERE `id` > ? ORDER BY `id` ASC LIMIT ?",
        values: [1, 2]
      },
      {
        sql: "SELECT `id`, `name` FROM `inventory`.`products` WHERE `id` > ? ORDER BY `id` ASC LIMIT ?",
        values: [3, 2]
      }
    ]);
  });

  it("rejects invalid identifiers / 유효하지 않은 identifier를 거부한다", () => {
    const pool = new FakeMariaDbReaderPool([]);

    expect(() =>
      createMariaDbCursorReader<ReaderProduct, number>({
        pool,
        table: "products;drop",
        cursorColumn: "id",
        pageSize: 10,
        getCursor(product) {
          return product.id;
        }
      })
    ).toThrow("MariaDB cursor reader table must be a dot-separated SQL identifier.");
  });
});
