import type { JobExecution, JobInstance, PartitionExecution, StepExecution } from "@rv-nest-batch/core";
import {
  parsePostgresJobParameters,
  parsePostgresJobStatus,
  parsePostgresOptionalDate,
  parsePostgresPartitionStatus,
  parsePostgresJson,
  parsePostgresRequiredDate,
  parsePostgresStepStatus,
  type PostgresJobExecutionRow,
  type PostgresJobInstanceRow,
  type PostgresPartitionExecutionRow,
  type PostgresStepExecutionRow
} from "../sql.js";

export const toJobInstance = (row: PostgresJobInstanceRow): JobInstance => ({
  id: row.id,
  jobName: row.job_name,
  parametersHash: row.parameters_hash,
  parameters: parsePostgresJobParameters(row.parameters),
  createdAt: parsePostgresRequiredDate(row.created_at, "created_at")
});

export const toJobExecution = (row: PostgresJobExecutionRow): JobExecution => ({
  id: row.id,
  instanceId: row.instance_id,
  jobName: row.job_name,
  status: parsePostgresJobStatus(row.status),
  parameters: parsePostgresJobParameters(row.parameters),
  createdAt: parsePostgresRequiredDate(row.created_at, "created_at"),
  startedAt: parsePostgresOptionalDate(row.started_at),
  endedAt: parsePostgresOptionalDate(row.ended_at),
  failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined
});

export const toStepExecution = (row: PostgresStepExecutionRow): StepExecution => ({
  id: row.id,
  jobExecutionId: row.job_execution_id,
  stepName: row.step_name,
  status: parsePostgresStepStatus(row.status),
  readCount: parsePostgresCount(row.read_count, "read_count"),
  writeCount: parsePostgresCount(row.write_count, "write_count"),
  skipCount: parsePostgresCount(row.skip_count, "skip_count"),
  retryCount: parsePostgresCount(row.retry_count, "retry_count"),
  createdAt: parsePostgresRequiredDate(row.created_at, "created_at"),
  startedAt: parsePostgresOptionalDate(row.started_at),
  endedAt: parsePostgresOptionalDate(row.ended_at),
  failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined
});

export const toPartitionExecution = (row: PostgresPartitionExecutionRow): PartitionExecution => ({
  id: row.id,
  stepExecutionId: row.step_execution_id,
  stepName: row.step_name,
  status: parsePostgresPartitionStatus(row.status),
  partition: parsePostgresJson(row.partition),
  ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
  heartbeatAt: parsePostgresOptionalDate(row.heartbeat_at),
  claimExpiresAt: parsePostgresOptionalDate(row.claim_expires_at),
  readCount: parsePostgresCount(row.read_count, "read_count"),
  writeCount: parsePostgresCount(row.write_count, "write_count"),
  skipCount: parsePostgresCount(row.skip_count, "skip_count"),
  retryCount: parsePostgresCount(row.retry_count, "retry_count"),
  createdAt: parsePostgresRequiredDate(row.created_at, "created_at"),
  startedAt: parsePostgresOptionalDate(row.started_at),
  endedAt: parsePostgresOptionalDate(row.ended_at),
  failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined
});

const parsePostgresCount = (value: unknown, fieldName: string): number => {
  const count = typeof value === "number" ? value : Number(value);

  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError(`Invalid Postgres ${fieldName} count.`);
  }

  return count;
};
