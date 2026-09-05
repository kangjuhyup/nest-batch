import { DatabaseBatchStorage } from "@rv-nest-batch/core";
import { MySqlCheckpointStore } from "./checkpoint-store.js";
import { resolveMySqlPool } from "./driver.js";
import { MySqlExecutionContextStore } from "./execution-context-store.js";
import { MySqlLockManager } from "./lock/lock-manager.js";
import type { MySqlBatchOptions, MySqlPoolLike } from "./options.js";
import { MySqlJobRepository } from "./repository/repository.js";
import { ensureMySqlSchema } from "./schema.js";

export class MySqlBatchStorage extends DatabaseBatchStorage {
  readonly repository: MySqlJobRepository;
  readonly checkpointStore: MySqlCheckpointStore;
  override readonly executionContextStore: MySqlExecutionContextStore;
  readonly lockManager: MySqlLockManager;
  private readonly pool: MySqlPoolLike;
  private readonly ownsPool: boolean;

  constructor(readonly options: MySqlBatchOptions) {
    super();
    this.pool = resolveMySqlPool(options);
    this.ownsPool = !options.pool;
    const sharedOptions = { ...options, pool: this.pool };
    this.repository = new MySqlJobRepository(sharedOptions);
    this.checkpointStore = new MySqlCheckpointStore(sharedOptions);
    this.executionContextStore = new MySqlExecutionContextStore(sharedOptions);
    this.lockManager = new MySqlLockManager(sharedOptions);
  }

  override async initialize(): Promise<void> {
    await ensureMySqlSchema({ ...this.options, pool: this.pool });
  }

  override async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end?.();
    }
  }
}
