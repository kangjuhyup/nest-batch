import type { ExecutionContextKey, ExecutionContextStore } from "@rv-nest-batch/core";
import { resolveMySqlPool } from "./driver.js";
import type { MySqlBatchOptions, MySqlPoolLike } from "./options.js";
import {
  createMySqlTables,
  parseMySqlJson,
  rowsFromMySqlResult,
  stringifyMySqlJson,
  type MySqlTables
} from "./sql.js";

export class MySqlExecutionContextStore implements ExecutionContextStore {
  private readonly pool: MySqlPoolLike;
  private readonly tables: MySqlTables;

  constructor(readonly options: MySqlBatchOptions) {
    this.pool = resolveMySqlPool(options);
    this.tables = createMySqlTables(options);
  }

  async read<TContext = unknown>(key: ExecutionContextKey): Promise<TContext | undefined> {
    const result = await this.pool.execute(
      `
        SELECT context
        FROM ${this.tables.executionContexts}
        WHERE execution_id = ? AND scope = ? AND name = ?
      `,
      [key.executionId, key.scope, key.name]
    );
    const [row] = rowsFromMySqlResult<{ readonly context: unknown }>(result);

    return row ? parseMySqlJson<TContext>(row.context) : undefined;
  }

  async write<TContext = unknown>(key: ExecutionContextKey, context: TContext): Promise<void> {
    await this.pool.execute(
      `
        INSERT INTO ${this.tables.executionContexts} (
          execution_id,
          scope,
          name,
          context,
          updated_at
        )
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE
          context = VALUES(context),
          updated_at = CURRENT_TIMESTAMP(3)
      `,
      [key.executionId, key.scope, key.name, stringifyMySqlJson(context)]
    );
  }

  async merge<TContext extends Record<string, unknown>>(
    key: ExecutionContextKey,
    patch: Readonly<Partial<TContext>>
  ): Promise<TContext> {
    const current = await this.read<Record<string, unknown>>(key);
    const merged = {
      ...(current ?? {}),
      ...patch
    } as TContext;

    await this.write(key, merged);

    return merged;
  }

  async delete(key: ExecutionContextKey): Promise<void> {
    await this.pool.execute(
      `
        DELETE FROM ${this.tables.executionContexts}
        WHERE execution_id = ? AND scope = ? AND name = ?
      `,
      [key.executionId, key.scope, key.name]
    );
  }
}
