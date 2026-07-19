import { DatabaseBatchStorage } from "@nest-batch/core";
import { InMemoryCheckpointStore } from "./checkpoint-store.js";
import { InMemoryLockManager } from "./lock-manager.js";
import { InMemoryJobRepository } from "./repository.js";

export class InMemoryBatchStorage extends DatabaseBatchStorage {
  readonly repository = new InMemoryJobRepository();
  readonly checkpointStore = new InMemoryCheckpointStore();
  readonly lockManager = new InMemoryLockManager();
}
