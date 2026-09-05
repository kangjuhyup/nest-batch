import type { BatchExecutionId, CheckpointStore } from "@rv-nest-batch/core";
import { resolvePostgresPool } from "./driver.js";
import type { PostgresBatchOptions } from "./options.js";
import type { PostgresPoolLike } from "./options.js";
import {
  createPostgresTables,
  parsePostgresJson,
  rowsFromPostgresResult,
  stringifyPostgresJson,
  type PostgresTables
} from "./sql.js";

export class PostgresCheckpointStore implements CheckpointStore {
  private readonly pool: PostgresPoolLike;
  private readonly tables: PostgresTables;

  constructor(readonly options: PostgresBatchOptions) {
    this.pool = resolvePostgresPool(options);
    this.tables = createPostgresTables(options);
  }

  async read<TCheckpoint = unknown>(
    executionId: BatchExecutionId,
    stepName: string
  ): Promise<TCheckpoint | undefined> {
    const result = await this.pool.query<{ readonly checkpoint: unknown }>(
      `
        SELECT checkpoint
        FROM ${this.tables.checkpoints}
        WHERE execution_id = $1 AND step_name = $2
      `,
      [executionId, stepName]
    );
    const [row] = rowsFromPostgresResult<{ readonly checkpoint: unknown }>(result);

    return row ? parsePostgresJson<TCheckpoint>(row.checkpoint) : undefined;
  }

  async write<TCheckpoint = unknown>(
    executionId: BatchExecutionId,
    stepName: string,
    checkpoint: TCheckpoint
  ): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO ${this.tables.checkpoints} (
          execution_id,
          step_name,
          checkpoint,
          updated_at
        )
        VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP(3))
        ON CONFLICT (execution_id, step_name) DO UPDATE
        SET
          checkpoint = EXCLUDED.checkpoint,
          updated_at = CURRENT_TIMESTAMP(3)
      `,
      [executionId, stepName, stringifyPostgresJson(checkpoint)]
    );
  }

  async delete(executionId: BatchExecutionId, stepName: string): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM ${this.tables.checkpoints}
        WHERE execution_id = $1 AND step_name = $2
      `,
      [executionId, stepName]
    );
  }
}
