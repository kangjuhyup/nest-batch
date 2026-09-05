import type { LockHandle } from "@rv-nest-batch/core";

interface LockTimes {
  readonly acquiredAt: Date;
  readonly expiresAt?: Date;
}

export const createLockTimes = (ttlMs?: number): LockTimes => {
  if (ttlMs !== undefined && (!Number.isSafeInteger(ttlMs) || ttlMs <= 0)) {
    throw new TypeError("Postgres lock ttlMs must be a positive safe integer.");
  }

  const acquiredAt = new Date();
  return {
    acquiredAt,
    expiresAt: ttlMs ? new Date(acquiredAt.getTime() + ttlMs) : undefined
  };
};

export const createLockHandle = (resource: string, ownerId: string, expiresAt?: Date): LockHandle => {
  return expiresAt ? { resource, ownerId, expiresAt } : { resource, ownerId };
};
