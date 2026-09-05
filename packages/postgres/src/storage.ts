import { DatabaseBatchStorage } from "@rvkang/batch-core";
import { PostgresCheckpointStore } from "./checkpoint-store.js";
import { resolvePostgresPool } from "./driver.js";
import { PostgresExecutionContextStore } from "./execution-context-store.js";
import { PostgresLockManager } from "./lock/lock-manager.js";
import type { PostgresBatchOptions, PostgresPoolLike } from "./options.js";
import { PostgresJobRepository } from "./repository/repository.js";
import { ensurePostgresSchema } from "./schema.js";

export class PostgresBatchStorage extends DatabaseBatchStorage {
  readonly repository: PostgresJobRepository;
  readonly checkpointStore: PostgresCheckpointStore;
  override readonly executionContextStore: PostgresExecutionContextStore;
  readonly lockManager: PostgresLockManager;
  private readonly pool: PostgresPoolLike;
  private readonly ownsPool: boolean;

  constructor(readonly options: PostgresBatchOptions) {
    super();
    this.pool = resolvePostgresPool(options);
    this.ownsPool = !options.pool;
    const sharedOptions = { ...options, pool: this.pool };
    this.repository = new PostgresJobRepository(sharedOptions);
    this.checkpointStore = new PostgresCheckpointStore(sharedOptions);
    this.executionContextStore = new PostgresExecutionContextStore(sharedOptions);
    this.lockManager = new PostgresLockManager(sharedOptions);
  }

  override async initialize(): Promise<void> {
    await ensurePostgresSchema({ ...this.options, pool: this.pool });
  }

  override async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end?.();
    }
  }
}
