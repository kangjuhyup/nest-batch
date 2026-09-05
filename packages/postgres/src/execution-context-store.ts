import type { ExecutionContextKey, ExecutionContextStore } from "@rvkang/batch-core";
import { resolvePostgresPool } from "./driver.js";
import type { PostgresBatchOptions, PostgresPoolLike } from "./options.js";
import {
  createPostgresTables,
  parsePostgresJson,
  rowsFromPostgresResult,
  stringifyPostgresJson,
  type PostgresTables
} from "./sql.js";

export class PostgresExecutionContextStore implements ExecutionContextStore {
  private readonly pool: PostgresPoolLike;
  private readonly tables: PostgresTables;

  constructor(readonly options: PostgresBatchOptions) {
    this.pool = resolvePostgresPool(options);
    this.tables = createPostgresTables(options);
  }

  async read<TContext = unknown>(key: ExecutionContextKey): Promise<TContext | undefined> {
    const result = await this.pool.query<{ readonly context: unknown }>(
      `
        SELECT context
        FROM ${this.tables.executionContexts}
        WHERE execution_id = $1 AND scope = $2 AND name = $3
      `,
      [key.executionId, key.scope, key.name]
    );
    const [row] = rowsFromPostgresResult<{ readonly context: unknown }>(result);

    return row ? parsePostgresJson<TContext>(row.context) : undefined;
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
        VALUES ($1, $2, $3, $4::jsonb, CURRENT_TIMESTAMP(3))
        ON CONFLICT (execution_id, scope, name) DO UPDATE
        SET
          context = EXCLUDED.context,
          updated_at = CURRENT_TIMESTAMP(3)
      `,
      [key.executionId, key.scope, key.name, stringifyPostgresJson(context)]
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
        WHERE execution_id = $1 AND scope = $2 AND name = $3
      `,
      [key.executionId, key.scope, key.name]
    );
  }
}
