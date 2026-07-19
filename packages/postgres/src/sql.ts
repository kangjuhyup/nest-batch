import type { JobExecutionStatus, JobParameters, StepExecutionStatus } from "@nest-batch/core";
import type { PostgresBatchOptions } from "./options.js";

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_TABLE_PREFIX = "nest_batch";

export interface PostgresTables {
  readonly schema?: string;
  readonly jobExecutions: string;
  readonly stepExecutions: string;
  readonly checkpoints: string;
  readonly locks: string;
  readonly jobStatusIndex: string;
  readonly stepStatusIndex: string;
  readonly locksExpiresAtIndex: string;
}

export interface PostgresJobExecutionRow {
  readonly id: string;
  readonly job_name: string;
  readonly status: string;
  readonly parameters: unknown;
  readonly created_at: unknown;
  readonly started_at: unknown;
  readonly ended_at: unknown;
  readonly failure_reason: unknown;
}

export interface PostgresStepExecutionRow {
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

export const createPostgresTables = (
  options: Pick<PostgresBatchOptions, "schema" | "tablePrefix">
): PostgresTables => {
  const tablePrefix = validatePostgresIdentifier(options.tablePrefix ?? DEFAULT_TABLE_PREFIX, "tablePrefix");
  const schema = options.schema ? validatePostgresIdentifier(options.schema, "schema") : undefined;
  const qualify = (name: string): string => {
    const tableName = quotePostgresIdentifier(`${tablePrefix}_${name}`);
    return schema ? `${quotePostgresIdentifier(schema)}.${tableName}` : tableName;
  };

  return {
    schema,
    jobExecutions: qualify("job_executions"),
    stepExecutions: qualify("step_executions"),
    checkpoints: qualify("checkpoints"),
    locks: qualify("locks"),
    jobStatusIndex: quotePostgresIdentifier(`idx_${tablePrefix}_job_executions_job_status`),
    stepStatusIndex: quotePostgresIdentifier(`idx_${tablePrefix}_step_executions_job_step_status`),
    locksExpiresAtIndex: quotePostgresIdentifier(`idx_${tablePrefix}_locks_expires_at`)
  };
};

export const stringifyPostgresJson = (value: unknown): string => {
  const json = JSON.stringify(value);

  if (json === undefined) {
    throw new TypeError("Postgres adapter only supports JSON-serializable values.");
  }

  return json;
};

export const parsePostgresJson = <T>(value: unknown): T => {
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }

  return value as T;
};

export const parsePostgresJobParameters = (value: unknown): JobParameters => {
  return (parsePostgresJson<JobParameters | undefined>(value) ?? {}) as JobParameters;
};

export const parsePostgresRequiredDate = (value: unknown, fieldName: string): Date => {
  const date = parsePostgresOptionalDate(value);

  if (!date) {
    throw new TypeError(`Invalid Postgres ${fieldName} timestamp.`);
  }

  return date;
};

export const parsePostgresOptionalDate = (value: unknown): Date | undefined => {
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

export const parsePostgresJobStatus = (value: unknown): JobExecutionStatus => {
  if (
    value === "created" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }

  throw new TypeError("Invalid Postgres job execution status.");
};

export const parsePostgresStepStatus = (value: unknown): StepExecutionStatus => {
  return parsePostgresJobStatus(value);
};

export const rowsFromPostgresResult = <TRow>(result: unknown): readonly TRow[] => {
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { readonly rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as TRow[]) : [];
  }

  return [];
};

export const rowCountFromPostgresResult = (result: unknown): number => {
  if (result && typeof result === "object" && "rowCount" in result) {
    const rowCount = (result as { readonly rowCount?: unknown }).rowCount;
    return typeof rowCount === "number" ? rowCount : 0;
  }

  return 0;
};

export const isPostgresUniqueViolation = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  return (error as { readonly code?: unknown }).code === "23505";
};

export const postgresPlaceholders = (count: number): string => {
  return Array.from({ length: count }, (_, index) => `$${index + 1}`).join(", ");
};

const validatePostgresIdentifier = (identifier: string, optionName: string): string => {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new TypeError(`Invalid Postgres ${optionName} identifier.`);
  }

  return identifier;
};

const quotePostgresIdentifier = (identifier: string): string => `"${identifier}"`;
