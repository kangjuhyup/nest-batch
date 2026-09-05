import type { ExecutionContextKey, ExecutionContextStore } from "@rv-nest-batch/core";
import { resolveMariaDbPool } from "./driver.js";
import type { MariaDbBatchOptions, MariaDbPoolLike } from "./options.js";
import {
  createMariaDbTables,
  parseMariaDbJson,
  rowsFromMariaDbResult,
  stringifyMariaDbJson,
  type MariaDbTables
} from "./sql.js";

export class MariaDbExecutionContextStore implements ExecutionContextStore {
  private readonly pool: MariaDbPoolLike;
  private readonly tables: MariaDbTables;

  constructor(readonly options: MariaDbBatchOptions) {
    this.pool = resolveMariaDbPool(options);
    this.tables = createMariaDbTables(options);
  }

  async read<TContext = unknown>(key: ExecutionContextKey): Promise<TContext | undefined> {
    const result = await this.pool.query(
      `
        SELECT context
        FROM ${this.tables.executionContexts}
        WHERE execution_id = ? AND scope = ? AND name = ?
      `,
      [key.executionId, key.scope, key.name]
    );
    const [row] = rowsFromMariaDbResult<{ readonly context: unknown }>(result);

    return row ? parseMariaDbJson<TContext>(row.context) : undefined;
  }

  async write<TContext = unknown>(key: ExecutionContextKey, context: TContext): Promise<void> {
    await this.pool.query(
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
      [key.executionId, key.scope, key.name, stringifyMariaDbJson(context)]
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
    await this.pool.query(
      `
        DELETE FROM ${this.tables.executionContexts}
        WHERE execution_id = ? AND scope = ? AND name = ?
      `,
      [key.executionId, key.scope, key.name]
    );
  }
}
