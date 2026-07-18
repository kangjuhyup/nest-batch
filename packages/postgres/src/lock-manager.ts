import type { LockAcquireOptions, LockHandle, LockManager } from "@nest-batch/core";
import { createPostgresScaffoldError } from "./errors.js";
import type { PostgresBatchOptions } from "./options.js";

export class PostgresLockManager implements LockManager {
  constructor(readonly options: PostgresBatchOptions) {}

  async acquire(
    _resource: string,
    _ownerId: string,
    _options?: LockAcquireOptions
  ): Promise<LockHandle | undefined> {
    throw createPostgresScaffoldError("lock manager");
  }

  async release(_handle: LockHandle): Promise<void> {
    throw createPostgresScaffoldError("lock manager");
  }
}
