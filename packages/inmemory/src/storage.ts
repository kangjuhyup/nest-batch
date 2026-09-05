import { DatabaseBatchStorage } from "@rv-nest-batch/core";
import { InMemoryCheckpointStore } from "./checkpoint-store.js";
import { InMemoryExecutionContextStore } from "./execution-context-store.js";
import { InMemoryLockManager } from "./lock/lock-manager.js";
import { InMemoryJobRepository } from "./repository/repository.js";

export class InMemoryBatchStorage extends DatabaseBatchStorage {
  readonly repository = new InMemoryJobRepository();
  readonly checkpointStore = new InMemoryCheckpointStore();
  override readonly executionContextStore = new InMemoryExecutionContextStore();
  readonly lockManager = new InMemoryLockManager();
}
