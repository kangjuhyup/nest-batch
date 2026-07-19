import type { LockAcquireOptions, LockHandle, LockManager } from "@nest-batch/core";
import { createMariaDbScaffoldError } from "./errors.js";
import type { MariaDbBatchOptions } from "./options.js";

export class MariaDbLockManager implements LockManager {
  constructor(readonly options: MariaDbBatchOptions) {}

  async acquire(
    _resource: string,
    _ownerId: string,
    _options?: LockAcquireOptions
  ): Promise<LockHandle | undefined> {
    throw createMariaDbScaffoldError("lock manager");
  }

  async release(_handle: LockHandle): Promise<void> {
    throw createMariaDbScaffoldError("lock manager");
  }
}
