import type { LockAcquireOptions, LockHandle, LockManager } from "@nest-batch/core";
import { resolvePostgresPool } from "../driver.js";
import type { PostgresBatchOptions } from "../options.js";
import type { PostgresPoolLike } from "../options.js";
import {
  createPostgresTables,
  isPostgresUniqueViolation,
  rowCountFromPostgresResult,
  type PostgresTables
} from "../sql.js";
import { createLockHandle, createLockTimes } from "./lock-state.js";

export class PostgresLockManager implements LockManager {
  private readonly pool: PostgresPoolLike;
  private readonly tables: PostgresTables;

  constructor(readonly options: PostgresBatchOptions) {
    this.pool = resolvePostgresPool(options);
    this.tables = createPostgresTables(options);
  }

  async acquire(
    resource: string,
    ownerId: string,
    options?: LockAcquireOptions
  ): Promise<LockHandle | undefined> {
    options?.signal?.throwIfAborted();
    const { acquiredAt, expiresAt } = createLockTimes(options?.ttlMs);
    const handle = createLockHandle(resource, ownerId, expiresAt);

    const renewalResult = await this.pool.query(
      `
        UPDATE ${this.tables.locks}
        SET acquired_at = $1, expires_at = $2
        WHERE resource = $3 AND owner_id = $4
      `,
      [acquiredAt, expiresAt ?? null, resource, ownerId]
    );

    if (rowCountFromPostgresResult(renewalResult) > 0) {
      return handle;
    }

    options?.signal?.throwIfAborted();
    await this.pool.query(
      `
        DELETE FROM ${this.tables.locks}
        WHERE resource = $1 AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP(3)
      `,
      [resource]
    );

    options?.signal?.throwIfAborted();

    try {
      await this.pool.query(
        `
          INSERT INTO ${this.tables.locks} (
            resource,
            owner_id,
            acquired_at,
            expires_at
          )
          VALUES ($1, $2, $3, $4)
        `,
        [resource, ownerId, acquiredAt, expiresAt ?? null]
      );
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        return undefined;
      }

      throw error;
    }

    return handle;
  }

  async release(handle: LockHandle): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM ${this.tables.locks}
        WHERE resource = $1 AND owner_id = $2
      `,
      [handle.resource, handle.ownerId]
    );
  }
}
