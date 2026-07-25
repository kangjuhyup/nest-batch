import type { BatchStepExecutionId } from "./common.js";

export type PartitionExecutionStatus = "created" | "running" | "completed" | "failed" | "cancelled";

export type PartitionExecutionId = string;

export interface PartitionExecution<TPartition = unknown> {
  readonly id: PartitionExecutionId;
  readonly stepExecutionId: BatchStepExecutionId;
  readonly stepName: string;
  readonly status: PartitionExecutionStatus;
  readonly partition: TPartition;
  readonly ownerId?: string;
  readonly heartbeatAt?: Date;
  readonly claimExpiresAt?: Date;
  readonly readCount: number;
  readonly writeCount: number;
  readonly skipCount: number;
  readonly retryCount: number;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly endedAt?: Date;
  readonly failureReason?: string;
}

export interface PartitionClaimOptions {
  readonly stepExecutionId: BatchStepExecutionId;
  readonly ownerId: string;
  readonly now: Date;
  readonly staleAfterMs?: number;
}
