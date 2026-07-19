import type { BatchExecutionId, CheckpointStore } from "@nest-batch/core";
import { createMySqlScaffoldError } from "./errors.js";
import type { MySqlBatchOptions } from "./options.js";

export class MySqlCheckpointStore implements CheckpointStore {
  constructor(readonly options: MySqlBatchOptions) {}

  async read<TCheckpoint = unknown>(
    _executionId: BatchExecutionId,
    _stepName: string
  ): Promise<TCheckpoint | undefined> {
    throw createMySqlScaffoldError("checkpoint store");
  }

  async write<TCheckpoint = unknown>(
    _executionId: BatchExecutionId,
    _stepName: string,
    _checkpoint: TCheckpoint
  ): Promise<void> {
    throw createMySqlScaffoldError("checkpoint store");
  }

  async delete(_executionId: BatchExecutionId, _stepName: string): Promise<void> {
    throw createMySqlScaffoldError("checkpoint store");
  }
}
