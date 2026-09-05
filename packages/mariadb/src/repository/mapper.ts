import type { JobExecution, JobInstance, PartitionExecution, StepExecution } from "@rvkang/batch-core";
import {
  parseMariaDbJson,
  parseMariaDbJobParameters,
  parseMariaDbJobStatus,
  parseMariaDbOptionalDate,
  parseMariaDbPartitionStatus,
  parseMariaDbRequiredDate,
  parseMariaDbStepStatus,
  type MariaDbJobExecutionRow,
  type MariaDbJobInstanceRow,
  type MariaDbPartitionExecutionRow,
  type MariaDbStepExecutionRow
} from "../sql.js";

export const toJobInstance = (row: MariaDbJobInstanceRow): JobInstance => ({
  id: row.id,
  jobName: row.job_name,
  parametersHash: row.parameters_hash,
  parameters: parseMariaDbJobParameters(row.parameters),
  createdAt: parseMariaDbRequiredDate(row.created_at, "created_at")
});

export const toJobExecution = (row: MariaDbJobExecutionRow): JobExecution => ({
  id: row.id,
  instanceId: row.instance_id,
  jobName: row.job_name,
  status: parseMariaDbJobStatus(row.status),
  parameters: parseMariaDbJobParameters(row.parameters),
  createdAt: parseMariaDbRequiredDate(row.created_at, "created_at"),
  startedAt: parseMariaDbOptionalDate(row.started_at),
  endedAt: parseMariaDbOptionalDate(row.ended_at),
  failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined
});

export const toStepExecution = (row: MariaDbStepExecutionRow): StepExecution => ({
  id: row.id,
  jobExecutionId: row.job_execution_id,
  stepName: row.step_name,
  status: parseMariaDbStepStatus(row.status),
  readCount: parseMariaDbCount(row.read_count, "read_count"),
  writeCount: parseMariaDbCount(row.write_count, "write_count"),
  skipCount: parseMariaDbCount(row.skip_count, "skip_count"),
  retryCount: parseMariaDbCount(row.retry_count, "retry_count"),
  createdAt: parseMariaDbRequiredDate(row.created_at, "created_at"),
  startedAt: parseMariaDbOptionalDate(row.started_at),
  endedAt: parseMariaDbOptionalDate(row.ended_at),
  failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined
});

export const toPartitionExecution = (row: MariaDbPartitionExecutionRow): PartitionExecution => ({
  id: row.id,
  stepExecutionId: row.step_execution_id,
  stepName: row.step_name,
  status: parseMariaDbPartitionStatus(row.status),
  partition: parseMariaDbJson(row.partition),
  ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
  heartbeatAt: parseMariaDbOptionalDate(row.heartbeat_at),
  claimExpiresAt: parseMariaDbOptionalDate(row.claim_expires_at),
  readCount: parseMariaDbCount(row.read_count, "read_count"),
  writeCount: parseMariaDbCount(row.write_count, "write_count"),
  skipCount: parseMariaDbCount(row.skip_count, "skip_count"),
  retryCount: parseMariaDbCount(row.retry_count, "retry_count"),
  createdAt: parseMariaDbRequiredDate(row.created_at, "created_at"),
  startedAt: parseMariaDbOptionalDate(row.started_at),
  endedAt: parseMariaDbOptionalDate(row.ended_at),
  failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined
});

const parseMariaDbCount = (value: unknown, fieldName: string): number => {
  const count = typeof value === "number" ? value : Number(value);

  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError(`Invalid MariaDB ${fieldName} count.`);
  }

  return count;
};
