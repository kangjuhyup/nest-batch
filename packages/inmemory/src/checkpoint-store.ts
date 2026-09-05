import type { BatchExecutionId, CheckpointStore } from "@rv-nest-batch/core";

export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly checkpoints = new Map<string, unknown>();

  async read<TCheckpoint = unknown>(
    executionId: BatchExecutionId,
    stepName: string
  ): Promise<TCheckpoint | undefined> {
    return this.checkpoints.get(this.key(executionId, stepName)) as TCheckpoint | undefined;
  }

  async write<TCheckpoint = unknown>(
    executionId: BatchExecutionId,
    stepName: string,
    checkpoint: TCheckpoint
  ): Promise<void> {
    this.checkpoints.set(this.key(executionId, stepName), checkpoint);
  }

  async delete(executionId: BatchExecutionId, stepName: string): Promise<void> {
    this.checkpoints.delete(this.key(executionId, stepName));
  }

  private key(executionId: BatchExecutionId, stepName: string): string {
    return `${executionId}:${stepName}`;
  }
}
