import type { LockAcquireOptions, LockHandle, LockManager } from "@rv-nest-batch/core";
import { createExpiresAt, createLockHandle, isLockActive } from "./lock-state.js";

export class InMemoryLockManager implements LockManager {
  private readonly locks = new Map<string, LockHandle>();

  async acquire(
    resource: string,
    ownerId: string,
    options: LockAcquireOptions = {}
  ): Promise<LockHandle | undefined> {
    options.signal?.throwIfAborted();
    const expiresAt = createExpiresAt(options.ttlMs);
    const existing = this.locks.get(resource);

    if (existing && isLockActive(existing)) {
      if (existing.ownerId !== ownerId) {
        return undefined;
      }

      const renewed = createLockHandle(resource, ownerId, expiresAt);
      this.locks.set(resource, renewed);
      return renewed;
    }

    const handle = createLockHandle(resource, ownerId, expiresAt);
    this.locks.set(resource, handle);

    return handle;
  }

  async release(handle: LockHandle): Promise<void> {
    const current = this.locks.get(handle.resource);
    if (current?.ownerId === handle.ownerId) {
      this.locks.delete(handle.resource);
    }
  }
}
