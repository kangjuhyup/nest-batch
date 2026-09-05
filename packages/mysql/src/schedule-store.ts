import type {
  ScheduleClaimOptions,
  ScheduleFindLatestOccurrenceOptions,
  ScheduleListOccurrencesOptions,
  ScheduleMarkDispatchedOptions,
  ScheduleMarkFailedOptions,
  ScheduleOccurrence,
  ScheduleOccurrenceCandidate,
  ScheduleStore
} from "@rv-nest-batch/core/scheduler";
import { resolveMySqlPool } from "./driver.js";
import type { MySqlBatchOptions, MySqlPoolLike } from "./options.js";
import { ensureMySqlScheduleSchema } from "./schedule-schema.js";
import {
  affectedRowsFromMySqlResult,
  createMySqlTables,
  parseMySqlOptionalDate,
  parseMySqlRequiredDate,
  rowsFromMySqlResult,
  type MySqlTables
} from "./sql.js";

interface MySqlScheduleOccurrenceRow {
  readonly schedule_name: string;
  readonly occurrence_id: string;
  readonly scheduled_at: unknown;
  readonly status: string;
  readonly owner_id: unknown;
  readonly claimed_at: unknown;
  readonly claim_expires_at: unknown;
  readonly dispatched_at: unknown;
  readonly failed_at: unknown;
  readonly failure_reason: unknown;
}

export class MySqlScheduleStore implements ScheduleStore {
  private readonly pool: MySqlPoolLike;
  private readonly tables: MySqlTables;

  constructor(private readonly options: MySqlBatchOptions) {
    this.pool = resolveMySqlPool(options);
    this.tables = createMySqlTables(options);
  }

  async initialize(): Promise<void> {
    await ensureMySqlScheduleSchema(this.options);
  }

  async findLatestOccurrence(
    scheduleName: string,
    options: ScheduleFindLatestOccurrenceOptions = {}
  ): Promise<ScheduleOccurrence | undefined> {
    const values: string[] = [scheduleName];
    const statusFilter = createMySqlStatusFilter(options.statuses, values);
    const result = await this.pool.execute(
      `
        SELECT *
        FROM ${this.tables.scheduleOccurrences}
        WHERE schedule_name = ?${statusFilter}
        ORDER BY scheduled_at DESC, occurrence_id DESC
        LIMIT 1
      `,
      values
    );
    const [row] = rowsFromMySqlResult<MySqlScheduleOccurrenceRow>(result);

    return row ? mapMySqlScheduleOccurrence(row) : undefined;
  }

  async listOccurrences(
    options: ScheduleListOccurrencesOptions = {}
  ): Promise<readonly ScheduleOccurrence[]> {
    const values: string[] = [];
    const filters: string[] = [];

    if (options.scheduleName !== undefined) {
      values.push(options.scheduleName);
      filters.push("schedule_name = ?");
    }

    if (options.status !== undefined) {
      assertScheduleStatus(options.status, "MySQL schedule occurrence status filter");
      values.push(options.status);
      filters.push("status = ?");
    }

    const limit = normalizeLimit(options.limit);
    const whereClause = filters.length === 0 ? "" : `WHERE ${filters.join(" AND ")}`;
    const limitClause = limit === undefined ? "" : `LIMIT ${limit}`;

    const result = await this.pool.execute(
      `
        SELECT *
        FROM ${this.tables.scheduleOccurrences}
        ${whereClause}
        ORDER BY scheduled_at DESC, occurrence_id DESC
        ${limitClause}
      `,
      values
    );

    return rowsFromMySqlResult<MySqlScheduleOccurrenceRow>(result).map(mapMySqlScheduleOccurrence);
  }

  async claimOccurrence(
    candidate: ScheduleOccurrenceCandidate,
    options: ScheduleClaimOptions
  ): Promise<ScheduleOccurrence | undefined> {
    const claimExpiresAt =
      options.claimTtlMs === undefined
        ? undefined
        : new Date(options.claimedAt.getTime() + options.claimTtlMs);

    await this.pool.execute(
      `
        INSERT INTO ${this.tables.scheduleOccurrences} (
          schedule_name,
          occurrence_id,
          scheduled_at,
          status,
          owner_id,
          claimed_at,
          claim_expires_at
        )
        VALUES (?, ?, ?, 'claimed', ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          owner_id = IF(
            status = 'claimed'
              AND claim_expires_at IS NOT NULL
              AND claim_expires_at <= VALUES(claimed_at),
            VALUES(owner_id),
            owner_id
          ),
          claimed_at = IF(
            status = 'claimed'
              AND claim_expires_at IS NOT NULL
              AND claim_expires_at <= VALUES(claimed_at),
            VALUES(claimed_at),
            claimed_at
          ),
          claim_expires_at = IF(
            status = 'claimed'
              AND claim_expires_at IS NOT NULL
              AND claim_expires_at <= VALUES(claimed_at),
            VALUES(claim_expires_at),
            claim_expires_at
          )
      `,
      [
        candidate.scheduleName,
        candidate.occurrenceId,
        candidate.scheduledAt,
        options.ownerId,
        options.claimedAt,
        claimExpiresAt ?? null
      ]
    );

    const result = await this.pool.execute(
      `
        SELECT *
        FROM ${this.tables.scheduleOccurrences}
        WHERE schedule_name = ?
          AND occurrence_id = ?
          AND status = 'claimed'
          AND owner_id = ?
          AND claimed_at = ?
        LIMIT 1
      `,
      [candidate.scheduleName, candidate.occurrenceId, options.ownerId, options.claimedAt]
    );
    const [row] = rowsFromMySqlResult<MySqlScheduleOccurrenceRow>(result);

    return row ? mapMySqlScheduleOccurrence(row) : undefined;
  }

  async markDispatched(
    occurrence: ScheduleOccurrence,
    options: ScheduleMarkDispatchedOptions
  ): Promise<boolean> {
    const result = await this.pool.execute(
      `
        UPDATE ${this.tables.scheduleOccurrences}
        SET status = 'dispatched', dispatched_at = ?
        WHERE schedule_name = ?
          AND occurrence_id = ?
          AND owner_id = ?
          AND status = 'claimed'
      `,
      [options.dispatchedAt, occurrence.scheduleName, occurrence.occurrenceId, options.ownerId]
    );

    return affectedRowsFromMySqlResult(result) > 0;
  }

  async markFailed(
    occurrence: ScheduleOccurrence,
    options: ScheduleMarkFailedOptions
  ): Promise<boolean> {
    const result = await this.pool.execute(
      `
        UPDATE ${this.tables.scheduleOccurrences}
        SET status = 'failed', failed_at = ?, failure_reason = ?
        WHERE schedule_name = ?
          AND occurrence_id = ?
          AND owner_id = ?
          AND status = 'claimed'
      `,
      [
        options.failedAt,
        options.failureReason,
        occurrence.scheduleName,
        occurrence.occurrenceId,
        options.ownerId
      ]
    );

    return affectedRowsFromMySqlResult(result) > 0;
  }
}

const mapMySqlScheduleOccurrence = (row: MySqlScheduleOccurrenceRow): ScheduleOccurrence => ({
  scheduleName: row.schedule_name,
  occurrenceId: row.occurrence_id,
  scheduledAt: parseMySqlRequiredDate(row.scheduled_at, "scheduled_at"),
  status: parseScheduleStatus(row.status),
  ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
  claimedAt: parseMySqlOptionalDate(row.claimed_at),
  claimExpiresAt: parseMySqlOptionalDate(row.claim_expires_at),
  dispatchedAt: parseMySqlOptionalDate(row.dispatched_at),
  failedAt: parseMySqlOptionalDate(row.failed_at),
  failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined
});

const parseScheduleStatus = (status: string): ScheduleOccurrence["status"] => {
  if (status === "claimed" || status === "dispatched" || status === "failed") {
    return status;
  }

  throw new TypeError("Invalid MySQL schedule occurrence status.");
};

const createMySqlStatusFilter = (
  statuses: readonly ScheduleOccurrence["status"][] | undefined,
  values: string[]
): string => {
  if (statuses === undefined || statuses.length === 0) {
    return "";
  }

  for (const status of statuses) {
    assertScheduleStatus(status, "MySQL schedule occurrence status filter");
    values.push(status);
  }

  return ` AND status IN (${statuses.map(() => "?").join(", ")})`;
};

const assertScheduleStatus = (status: string, context: string): void => {
  if (status !== "claimed" && status !== "dispatched" && status !== "failed") {
    throw new TypeError(`Invalid ${context}.`);
  }
};

const normalizeLimit = (limit: number | undefined): number | undefined => {
  if (limit === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new TypeError("MySQL schedule occurrence list limit must be a non-negative safe integer.");
  }
  return limit;
};
