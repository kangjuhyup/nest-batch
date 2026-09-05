import { Buffer } from "node:buffer";
import type {
  JobExecutionStatus,
  JobParameters,
  PartitionExecutionStatus,
  StepExecutionStatus
} from "@rvkang/batch-core";
import type { MySqlBatchOptions } from "./options.js";

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_TABLE_PREFIX = "nest_batch";

export interface MySqlTables {
  readonly jobInstances: string;
  readonly jobExecutions: string;
  readonly stepExecutions: string;
  readonly partitionExecutions: string;
  readonly checkpoints: string;
  readonly executionContexts: string;
  readonly locks: string;
  readonly scheduleOccurrences: string;
}

export interface MySqlJobInstanceRow {
  readonly id: string;
  readonly job_name: string;
  readonly parameters_hash: string;
  readonly parameters: unknown;
  readonly created_at: unknown;
}

export interface MySqlJobExecutionRow {
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

export interface MySqlStepExecutionRow {
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

export interface MySqlPartitionExecutionRow {
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

export const createMySqlTables = (options: Pick<MySqlBatchOptions, "database" | "tablePrefix">): MySqlTables => {
  const tablePrefix = validateMySqlIdentifier(options.tablePrefix ?? DEFAULT_TABLE_PREFIX, "tablePrefix");
  const database = options.database ? validateMySqlIdentifier(options.database, "database") : undefined;
  const qualify = (name: string): string => {
    const tableName = quoteMySqlIdentifier(`${tablePrefix}_${name}`);
    return database ? `${quoteMySqlIdentifier(database)}.${tableName}` : tableName;
  };

  return {
    jobInstances: qualify("job_instances"),
    jobExecutions: qualify("job_executions"),
    stepExecutions: qualify("step_executions"),
    partitionExecutions: qualify("partition_executions"),
    checkpoints: qualify("checkpoints"),
    executionContexts: qualify("execution_contexts"),
    locks: qualify("locks"),
    scheduleOccurrences: qualify("schedule_occurrences")
  };
};

export const stringifyMySqlJson = (value: unknown): string => {
  const json = JSON.stringify(value);

  if (json === undefined) {
    throw new TypeError("MySQL adapter only supports JSON-serializable values.");
  }

  return json;
};

export const parseMySqlJson = <T>(value: unknown): T => {
  if (Buffer.isBuffer(value)) {
    return JSON.parse(value.toString("utf8")) as T;
  }

  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }

  return value as T;
};

export const parseMySqlJobParameters = (value: unknown): JobParameters => {
  return (parseMySqlJson<JobParameters | undefined>(value) ?? {}) as JobParameters;
};

export const parseMySqlRequiredDate = (value: unknown, fieldName: string): Date => {
  const date = parseMySqlOptionalDate(value);

  if (!date) {
    throw new TypeError(`Invalid MySQL ${fieldName} timestamp.`);
  }

  return date;
};

export const parseMySqlOptionalDate = (value: unknown): Date | undefined => {
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

export const parseMySqlJobStatus = (value: unknown): JobExecutionStatus => {
  if (
    value === "created" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }

  throw new TypeError("Invalid MySQL job execution status.");
};

export const parseMySqlStepStatus = (value: unknown): StepExecutionStatus => {
  return parseMySqlJobStatus(value);
};

export const parseMySqlPartitionStatus = (value: unknown): PartitionExecutionStatus => {
  return parseMySqlJobStatus(value);
};

export const rowsFromMySqlResult = <TRow>(result: unknown): TRow[] => {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as TRow[];
  }

  if (Array.isArray(result)) {
    return result as TRow[];
  }

  return [];
};

export const affectedRowsFromMySqlResult = (result: unknown): number => {
  const packet = Array.isArray(result) ? result[0] : result;

  if (packet && typeof packet === "object" && "affectedRows" in packet) {
    const affectedRows = (packet as { readonly affectedRows?: unknown }).affectedRows;
    return typeof affectedRows === "number" ? affectedRows : 0;
  }

  return 0;
};

export const isMySqlDuplicateKeyError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { readonly code?: unknown; readonly errno?: unknown; readonly sqlState?: unknown };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062 || candidate.sqlState === "23000";
};

const validateMySqlIdentifier = (identifier: string, optionName: string): string => {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new TypeError(`Invalid MySQL ${optionName} identifier.`);
  }

  return identifier;
};

const quoteMySqlIdentifier = (identifier: string): string => `\`${identifier}\``;
