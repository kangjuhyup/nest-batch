import type { LockAcquireOptions, LockHandle, LockManager } from "@nest-batch/core";

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

    if (existing && isActive(existing)) {
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

const createExpiresAt = (ttlMs?: number): Date | undefined => {
  if (ttlMs !== undefined && (!Number.isSafeInteger(ttlMs) || ttlMs <= 0)) {
    throw new TypeError("InMemory lock ttlMs must be a positive safe integer.");
  }

  return ttlMs === undefined ? undefined : new Date(Date.now() + ttlMs);
};

const createLockHandle = (resource: string, ownerId: string, expiresAt?: Date): LockHandle => {
  return expiresAt ? { resource, ownerId, expiresAt } : { resource, ownerId };
};

const isActive = (handle: LockHandle): boolean => {
  return !handle.expiresAt || handle.expiresAt.getTime() > Date.now();
};
