import type { LockAcquireOptions, LockHandle, LockManager } from "@rvkang/batch-core";
import { resolveMySqlPool } from "../driver.js";
import type { MySqlBatchOptions } from "../options.js";
import type { MySqlPoolLike } from "../options.js";
import {
  affectedRowsFromMySqlResult,
  createMySqlTables,
  isMySqlDuplicateKeyError,
  type MySqlTables
} from "../sql.js";
import { createLockHandle, createLockTimes } from "./lock-state.js";

export class MySqlLockManager implements LockManager {
  private readonly pool: MySqlPoolLike;
  private readonly tables: MySqlTables;

  constructor(readonly options: MySqlBatchOptions) {
    this.pool = resolveMySqlPool(options);
    this.tables = createMySqlTables(options);
  }

  async acquire(
    resource: string,
    ownerId: string,
    options?: LockAcquireOptions
  ): Promise<LockHandle | undefined> {
    options?.signal?.throwIfAborted();
    const { acquiredAt, expiresAt } = createLockTimes(options?.ttlMs);
    const handle = createLockHandle(resource, ownerId, expiresAt);

    const renewalResult = await this.pool.execute(
      `
        UPDATE ${this.tables.locks}
        SET acquired_at = ?, expires_at = ?
        WHERE resource = ? AND owner_id = ?
      `,
      [acquiredAt, expiresAt ?? null, resource, ownerId]
    );

    if (affectedRowsFromMySqlResult(renewalResult) > 0) {
      return handle;
    }

    options?.signal?.throwIfAborted();
    await this.pool.execute(
      `
        DELETE FROM ${this.tables.locks}
        WHERE resource = ? AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP(3)
      `,
      [resource]
    );

    options?.signal?.throwIfAborted();

    try {
      await this.pool.execute(
        `
          INSERT INTO ${this.tables.locks} (
            resource,
            owner_id,
            acquired_at,
            expires_at
          )
          VALUES (?, ?, ?, ?)
        `,
        [resource, ownerId, acquiredAt, expiresAt ?? null]
      );
    } catch (error) {
      if (isMySqlDuplicateKeyError(error)) {
        return undefined;
      }

      throw error;
    }

    return handle;
  }

  async release(handle: LockHandle): Promise<void> {
    await this.pool.execute(
      `
        DELETE FROM ${this.tables.locks}
        WHERE resource = ? AND owner_id = ?
      `,
      [handle.resource, handle.ownerId]
    );
  }
}
