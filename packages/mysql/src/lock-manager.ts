import type { LockAcquireOptions, LockHandle, LockManager } from "@nest-batch/core";
import { createMySqlScaffoldError } from "./errors.js";
import type { MySqlBatchOptions } from "./options.js";

export class MySqlLockManager implements LockManager {
  constructor(readonly options: MySqlBatchOptions) {}

  async acquire(
    _resource: string,
    _ownerId: string,
    _options?: LockAcquireOptions
  ): Promise<LockHandle | undefined> {
    throw createMySqlScaffoldError("lock manager");
  }

  async release(_handle: LockHandle): Promise<void> {
    throw createMySqlScaffoldError("lock manager");
  }
}
