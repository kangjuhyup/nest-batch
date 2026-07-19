import { DatabaseBatchStorage } from "@nest-batch/core";
import { PostgresCheckpointStore } from "./checkpoint-store.js";
import { PostgresLockManager } from "./lock-manager.js";
import type { PostgresBatchOptions } from "./options.js";
import { PostgresJobRepository } from "./repository.js";

export class PostgresBatchStorage extends DatabaseBatchStorage {
  readonly repository: PostgresJobRepository;
  readonly checkpointStore: PostgresCheckpointStore;
  readonly lockManager: PostgresLockManager;

  constructor(readonly options: PostgresBatchOptions) {
    super();
    this.repository = new PostgresJobRepository(options);
    this.checkpointStore = new PostgresCheckpointStore(options);
    this.lockManager = new PostgresLockManager(options);
  }
}
