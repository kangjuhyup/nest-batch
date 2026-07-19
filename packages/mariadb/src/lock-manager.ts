import type { LockAcquireOptions, LockHandle, LockManager } from "@nest-batch/core";
import { resolveMariaDbPool } from "./driver.js";
import type { MariaDbBatchOptions } from "./options.js";
import type { MariaDbPoolLike } from "./options.js";
import {
  affectedRowsFromMariaDbResult,
  createMariaDbTables,
  isMariaDbDuplicateKeyError,
  type MariaDbTables
} from "./sql.js";

export class MariaDbLockManager implements LockManager {
  private readonly pool: MariaDbPoolLike;
  private readonly tables: MariaDbTables;

  constructor(readonly options: MariaDbBatchOptions) {
    this.pool = resolveMariaDbPool(options);
    this.tables = createMariaDbTables(options);
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
        SET acquired_at = ?, expires_at = ?
        WHERE resource = ? AND owner_id = ?
      `,
      [acquiredAt, expiresAt ?? null, resource, ownerId]
    );

    if (affectedRowsFromMariaDbResult(renewalResult) > 0) {
      return handle;
    }

    options?.signal?.throwIfAborted();
    await this.pool.query(
      `
        DELETE FROM ${this.tables.locks}
        WHERE resource = ? AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP(3)
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
          VALUES (?, ?, ?, ?)
        `,
        [resource, ownerId, acquiredAt, expiresAt ?? null]
      );
    } catch (error) {
      if (isMariaDbDuplicateKeyError(error)) {
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
        WHERE resource = ? AND owner_id = ?
      `,
      [handle.resource, handle.ownerId]
    );
  }
}

const createLockTimes = (ttlMs?: number): { readonly acquiredAt: Date; readonly expiresAt?: Date } => {
  if (ttlMs !== undefined && (!Number.isSafeInteger(ttlMs) || ttlMs <= 0)) {
    throw new TypeError("MariaDB lock ttlMs must be a positive safe integer.");
  }

  const acquiredAt = new Date();
  return {
    acquiredAt,
    expiresAt: ttlMs ? new Date(acquiredAt.getTime() + ttlMs) : undefined
  };
};

const createLockHandle = (resource: string, ownerId: string, expiresAt?: Date): LockHandle => {
  return expiresAt ? { resource, ownerId, expiresAt } : { resource, ownerId };
};
