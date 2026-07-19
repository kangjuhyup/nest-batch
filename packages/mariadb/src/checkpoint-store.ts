import type { BatchExecutionId, CheckpointStore } from "@nest-batch/core";
import { resolveMariaDbPool } from "./driver.js";
import type { MariaDbBatchOptions } from "./options.js";
import type { MariaDbPoolLike } from "./options.js";
import {
  createMariaDbTables,
  parseMariaDbJson,
  rowsFromMariaDbResult,
  stringifyMariaDbJson,
  type MariaDbTables
} from "./sql.js";

export class MariaDbCheckpointStore implements CheckpointStore {
  private readonly pool: MariaDbPoolLike;
  private readonly tables: MariaDbTables;

  constructor(readonly options: MariaDbBatchOptions) {
    this.pool = resolveMariaDbPool(options);
    this.tables = createMariaDbTables(options);
  }

  async read<TCheckpoint = unknown>(
    executionId: BatchExecutionId,
    stepName: string
  ): Promise<TCheckpoint | undefined> {
    const result = await this.pool.query(
      `
        SELECT checkpoint
        FROM ${this.tables.checkpoints}
        WHERE execution_id = ? AND step_name = ?
      `,
      [executionId, stepName]
    );
    const [row] = rowsFromMariaDbResult<{ readonly checkpoint: unknown }>(result);

    return row ? parseMariaDbJson<TCheckpoint>(row.checkpoint) : undefined;
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
        VALUES (?, ?, ?, CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE
          checkpoint = VALUES(checkpoint),
          updated_at = CURRENT_TIMESTAMP(3)
      `,
      [executionId, stepName, stringifyMariaDbJson(checkpoint)]
    );
  }

  async delete(executionId: BatchExecutionId, stepName: string): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM ${this.tables.checkpoints}
        WHERE execution_id = ? AND step_name = ?
      `,
      [executionId, stepName]
    );
  }
}
