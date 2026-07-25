import { Buffer } from "node:buffer";
import type {
  JobExecutionStatus,
  JobParameters,
  PartitionExecutionStatus,
  StepExecutionStatus
} from "@nest-batch/core";
import type { MariaDbBatchOptions } from "./options.js";

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_TABLE_PREFIX = "nest_batch";

export interface MariaDbTables {
  readonly jobInstances: string;
  readonly jobExecutions: string;
  readonly stepExecutions: string;
  readonly partitionExecutions: string;
  readonly checkpoints: string;
  readonly executionContexts: string;
  readonly locks: string;
}

export interface MariaDbJobInstanceRow {
  readonly id: string;
  readonly job_name: string;
  readonly parameters_hash: string;
  readonly parameters: unknown;
  readonly created_at: unknown;
}

export interface MariaDbJobExecutionRow {
  readonly id: string;
  readonly instance_id: string;
  readonly job_name: string;
  readonly status: string;
  readonly parameters: unknown;
  readonly created_at: unknown;
  readonly started_at: unknown;
  readonly ended_at: unknown;
  readonly failure_reason: unknown;
}

export interface MariaDbStepExecutionRow {
  readonly id: string;
  readonly job_execution_id: string;
  readonly step_name: string;
  readonly status: string;
  readonly read_count: unknown;
  readonly write_count: unknown;
  readonly skip_count: unknown;
  readonly retry_count: unknown;
  readonly created_at: unknown;
  readonly started_at: unknown;
  readonly ended_at: unknown;
  readonly failure_reason: unknown;
}

export interface MariaDbPartitionExecutionRow {
  readonly id: string;
  readonly step_execution_id: string;
  readonly step_name: string;
  readonly status: string;
  readonly partition: unknown;
  readonly owner_id: unknown;
  readonly heartbeat_at: unknown;
  readonly claim_expires_at: unknown;
  readonly read_count: unknown;
  readonly write_count: unknown;
  readonly skip_count: unknown;
  readonly retry_count: unknown;
  readonly created_at: unknown;
  readonly started_at: unknown;
  readonly ended_at: unknown;
  readonly failure_reason: unknown;
}

export const createMariaDbTables = (
  options: Pick<MariaDbBatchOptions, "database" | "tablePrefix">
): MariaDbTables => {
  const tablePrefix = validateMariaDbIdentifier(options.tablePrefix ?? DEFAULT_TABLE_PREFIX, "tablePrefix");
  const database = options.database ? validateMariaDbIdentifier(options.database, "database") : undefined;
  const qualify = (name: string): string => {
    const tableName = quoteMariaDbIdentifier(`${tablePrefix}_${name}`);
    return database ? `${quoteMariaDbIdentifier(database)}.${tableName}` : tableName;
  };

  return {
    jobInstances: qualify("job_instances"),
    jobExecutions: qualify("job_executions"),
    stepExecutions: qualify("step_executions"),
    partitionExecutions: qualify("partition_executions"),
    checkpoints: qualify("checkpoints"),
    executionContexts: qualify("execution_contexts"),
    locks: qualify("locks")
  };
};

export const stringifyMariaDbJson = (value: unknown): string => {
  const json = JSON.stringify(value);

  if (json === undefined) {
    throw new TypeError("MariaDB adapter only supports JSON-serializable values.");
  }

  return json;
};

export const parseMariaDbJson = <T>(value: unknown): T => {
  if (Buffer.isBuffer(value)) {
    return JSON.parse(value.toString("utf8")) as T;
  }

  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }

  return value as T;
};

export const parseMariaDbJobParameters = (value: unknown): JobParameters => {
  return (parseMariaDbJson<JobParameters | undefined>(value) ?? {}) as JobParameters;
};

export const parseMariaDbRequiredDate = (value: unknown, fieldName: string): Date => {
  const date = parseMariaDbOptionalDate(value);

  if (!date) {
    throw new TypeError(`Invalid MariaDB ${fieldName} timestamp.`);
  }

  return date;
};

export const parseMariaDbOptionalDate = (value: unknown): Date | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return undefined;
};

export const parseMariaDbJobStatus = (value: unknown): JobExecutionStatus => {
  if (
    value === "created" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }

  throw new TypeError("Invalid MariaDB job execution status.");
};

export const parseMariaDbStepStatus = (value: unknown): StepExecutionStatus => {
  return parseMariaDbJobStatus(value);
};

export const parseMariaDbPartitionStatus = (value: unknown): PartitionExecutionStatus => {
  return parseMariaDbJobStatus(value);
};

export const rowsFromMariaDbResult = <TRow>(result: unknown): TRow[] => {
  return Array.isArray(result) ? (result as TRow[]) : [];
};

export const affectedRowsFromMariaDbResult = (result: unknown): number => {
  if (result && typeof result === "object" && "affectedRows" in result) {
    const affectedRows = (result as { readonly affectedRows?: unknown }).affectedRows;
    return typeof affectedRows === "number" ? affectedRows : 0;
  }

  return 0;
};

export const isMariaDbDuplicateKeyError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { readonly code?: unknown; readonly errno?: unknown; readonly sqlState?: unknown };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062 || candidate.sqlState === "23000";
};

const validateMariaDbIdentifier = (identifier: string, optionName: string): string => {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new TypeError(`Invalid MariaDB ${optionName} identifier.`);
  }

  return identifier;
};

const quoteMariaDbIdentifier = (identifier: string): string => `\`${identifier}\``;
