import { DatabaseBatchStorage } from "@nest-batch/core";
import { MariaDbCheckpointStore } from "./checkpoint-store.js";
import { resolveMariaDbPool } from "./driver.js";
import { MariaDbExecutionContextStore } from "./execution-context-store.js";
import { MariaDbLockManager } from "./lock/lock-manager.js";
import type { MariaDbBatchOptions, MariaDbPoolLike } from "./options.js";
import { MariaDbJobRepository } from "./repository/repository.js";
import { ensureMariaDbSchema } from "./schema.js";

export class MariaDbBatchStorage extends DatabaseBatchStorage {
  readonly repository: MariaDbJobRepository;
  readonly checkpointStore: MariaDbCheckpointStore;
  override readonly executionContextStore: MariaDbExecutionContextStore;
  readonly lockManager: MariaDbLockManager;
  private readonly pool: MariaDbPoolLike;
  private readonly ownsPool: boolean;

  constructor(readonly options: MariaDbBatchOptions) {
    super();
    this.pool = resolveMariaDbPool(options);
    this.ownsPool = !options.pool;
    const sharedOptions = { ...options, pool: this.pool };
    this.repository = new MariaDbJobRepository(sharedOptions);
    this.checkpointStore = new MariaDbCheckpointStore(sharedOptions);
    this.executionContextStore = new MariaDbExecutionContextStore(sharedOptions);
    this.lockManager = new MariaDbLockManager(sharedOptions);
  }

  override async initialize(): Promise<void> {
    await ensureMariaDbSchema({ ...this.options, pool: this.pool });
  }

  override async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end?.();
    }
  }
}
