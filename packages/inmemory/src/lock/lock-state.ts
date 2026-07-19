import type { LockHandle } from "@nest-batch/core";

export const createExpiresAt = (ttlMs?: number): Date | undefined => {
  if (ttlMs !== undefined && (!Number.isSafeInteger(ttlMs) || ttlMs <= 0)) {
    throw new TypeError("InMemory lock ttlMs must be a positive safe integer.");
  }

  return ttlMs === undefined ? undefined : new Date(Date.now() + ttlMs);
};

export const createLockHandle = (resource: string, ownerId: string, expiresAt?: Date): LockHandle => {
  return expiresAt ? { resource, ownerId, expiresAt } : { resource, ownerId };
};

export const isLockActive = (handle: LockHandle): boolean => {
  return !handle.expiresAt || handle.expiresAt.getTime() > Date.now();
};
