import type { ExecutionContextStore } from "./execution-context.js";
import type { LockManager } from "./lock.js";
import type { CheckpointStore, JobRepository } from "./repository.js";

export abstract class DatabaseBatchStorage {
  abstract readonly repository: JobRepository;
  abstract readonly checkpointStore: CheckpointStore;
  readonly executionContextStore?: ExecutionContextStore;
  abstract readonly lockManager: LockManager;

  async initialize(): Promise<void> {}

  async close(): Promise<void> {}
}
