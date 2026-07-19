export interface LockHandle {
  readonly resource: string;
  readonly ownerId: string;
  readonly expiresAt?: Date;
}

export interface LockAcquireOptions {
  readonly ttlMs?: number;
  readonly signal?: AbortSignal;
}

export interface LockManager {
  acquire(resource: string, ownerId: string, options?: LockAcquireOptions): Promise<LockHandle | undefined>;
  release(handle: LockHandle): Promise<void>;
}
