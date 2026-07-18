import type { BatchExecutionId, CheckpointStore } from "@nest-batch/core";
import { createPostgresScaffoldError } from "./errors.js";
import type { PostgresBatchOptions } from "./options.js";

export class PostgresCheckpointStore implements CheckpointStore {
  constructor(readonly options: PostgresBatchOptions) {}

  async read<TCheckpoint = unknown>(
    _executionId: BatchExecutionId,
    _stepName: string
  ): Promise<TCheckpoint | undefined> {
    throw createPostgresScaffoldError("checkpoint store");
  }

  async write<TCheckpoint = unknown>(
    _executionId: BatchExecutionId,
    _stepName: string,
    _checkpoint: TCheckpoint
  ): Promise<void> {
    throw createPostgresScaffoldError("checkpoint store");
  }

  async delete(_executionId: BatchExecutionId, _stepName: string): Promise<void> {
    throw createPostgresScaffoldError("checkpoint store");
  }
}
