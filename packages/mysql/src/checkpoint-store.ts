import type { BatchExecutionId, CheckpointStore } from "@rv-nest-batch/core";
import { resolveMySqlPool } from "./driver.js";
import type { MySqlBatchOptions } from "./options.js";
import type { MySqlPoolLike } from "./options.js";
import { createMySqlTables, parseMySqlJson, rowsFromMySqlResult, stringifyMySqlJson, type MySqlTables } from "./sql.js";

export class MySqlCheckpointStore implements CheckpointStore {
  private readonly pool: MySqlPoolLike;
  private readonly tables: MySqlTables;

  constructor(readonly options: MySqlBatchOptions) {
    this.pool = resolveMySqlPool(options);
    this.tables = createMySqlTables(options);
  }

  async read<TCheckpoint = unknown>(
    executionId: BatchExecutionId,
    stepName: string
  ): Promise<TCheckpoint | undefined> {
    const result = await this.pool.execute(
      `
        SELECT checkpoint
        FROM ${this.tables.checkpoints}
        WHERE execution_id = ? AND step_name = ?
      `,
      [executionId, stepName]
    );
    const [row] = rowsFromMySqlResult<{ readonly checkpoint: unknown }>(result);

    return row ? parseMySqlJson<TCheckpoint>(row.checkpoint) : undefined;
  }

  async write<TCheckpoint = unknown>(
    executionId: BatchExecutionId,
    stepName: string,
    checkpoint: TCheckpoint
  ): Promise<void> {
    await this.pool.execute(
      `
        INSERT INTO ${this.tables.checkpoints} (
          execution_id,
          step_name,
          checkpoint,
          updated_at
        )
        VALUES (?, ?, ?, CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE
          checkpoint = VALUES(checkpoint),
          updated_at = CURRENT_TIMESTAMP(3)
      `,
      [executionId, stepName, stringifyMySqlJson(checkpoint)]
    );
  }

  async delete(executionId: BatchExecutionId, stepName: string): Promise<void> {
    await this.pool.execute(
      `
        DELETE FROM ${this.tables.checkpoints}
        WHERE execution_id = ? AND step_name = ?
      `,
      [executionId, stepName]
    );
  }
}
