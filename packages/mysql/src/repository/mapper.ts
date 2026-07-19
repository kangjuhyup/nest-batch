import type { JobExecution, JobInstance, StepExecution } from "@nest-batch/core";
import {
  parseMySqlJobParameters,
  parseMySqlJobStatus,
  parseMySqlOptionalDate,
  parseMySqlRequiredDate,
  parseMySqlStepStatus,
  type MySqlJobExecutionRow,
  type MySqlJobInstanceRow,
  type MySqlStepExecutionRow
} from "../sql.js";

export const toJobInstance = (row: MySqlJobInstanceRow): JobInstance => ({
  id: row.id,
  jobName: row.job_name,
  parametersHash: row.parameters_hash,
  parameters: parseMySqlJobParameters(row.parameters),
  createdAt: parseMySqlRequiredDate(row.created_at, "created_at")
});

export const toJobExecution = (row: MySqlJobExecutionRow): JobExecution => ({
  id: row.id,
  instanceId: row.instance_id,
  jobName: row.job_name,
  status: parseMySqlJobStatus(row.status),
  parameters: parseMySqlJobParameters(row.parameters),
  createdAt: parseMySqlRequiredDate(row.created_at, "created_at"),
  startedAt: parseMySqlOptionalDate(row.started_at),
  endedAt: parseMySqlOptionalDate(row.ended_at),
  failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined
});

export const toStepExecution = (row: MySqlStepExecutionRow): StepExecution => ({
  id: row.id,
  jobExecutionId: row.job_execution_id,
  stepName: row.step_name,
  status: parseMySqlStepStatus(row.status),
  readCount: parseMySqlCount(row.read_count, "read_count"),
  writeCount: parseMySqlCount(row.write_count, "write_count"),
  skipCount: parseMySqlCount(row.skip_count, "skip_count"),
  retryCount: parseMySqlCount(row.retry_count, "retry_count"),
  createdAt: parseMySqlRequiredDate(row.created_at, "created_at"),
  startedAt: parseMySqlOptionalDate(row.started_at),
  endedAt: parseMySqlOptionalDate(row.ended_at),
  failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined
});

const parseMySqlCount = (value: unknown, fieldName: string): number => {
  const count = typeof value === "number" ? value : Number(value);

  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError(`Invalid MySQL ${fieldName} count.`);
  }

  return count;
};
