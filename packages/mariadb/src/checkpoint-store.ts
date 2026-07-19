import type { BatchExecutionId, CheckpointStore } from "@nest-batch/core";
import { createMariaDbScaffoldError } from "./errors.js";
import type { MariaDbBatchOptions } from "./options.js";

export class MariaDbCheckpointStore implements CheckpointStore {
  constructor(readonly options: MariaDbBatchOptions) {}

  async read<TCheckpoint = unknown>(
    _executionId: BatchExecutionId,
    _stepName: string
  ): Promise<TCheckpoint | undefined> {
    throw createMariaDbScaffoldError("checkpoint store");
  }

  async write<TCheckpoint = unknown>(
    _executionId: BatchExecutionId,
    _stepName: string,
    _checkpoint: TCheckpoint
  ): Promise<void> {
    throw createMariaDbScaffoldError("checkpoint store");
  }

  async delete(_executionId: BatchExecutionId, _stepName: string): Promise<void> {
    throw createMariaDbScaffoldError("checkpoint store");
  }
}
