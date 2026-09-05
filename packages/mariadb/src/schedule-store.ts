import type {
  ScheduleClaimOptions,
  ScheduleFindLatestOccurrenceOptions,
  ScheduleListOccurrencesOptions,
  ScheduleMarkDispatchedOptions,
  ScheduleMarkFailedOptions,
  ScheduleOccurrence,
  ScheduleOccurrenceCandidate,
  ScheduleStore
} from "@rvkang/batch-core/scheduler";
import { resolveMariaDbPool } from "./driver.js";
import type { MariaDbBatchOptions, MariaDbPoolLike } from "./options.js";
import { ensureMariaDbScheduleSchema } from "./schedule-schema.js";
import {
  affectedRowsFromMariaDbResult,
  createMariaDbTables,
  parseMariaDbOptionalDate,
  parseMariaDbRequiredDate,
  rowsFromMariaDbResult,
  type MariaDbTables
} from "./sql.js";

interface MariaDbScheduleOccurrenceRow {
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

export class MariaDbScheduleStore implements ScheduleStore {
  private readonly pool: MariaDbPoolLike;
  private readonly tables: MariaDbTables;

  constructor(private readonly options: MariaDbBatchOptions) {
    this.pool = resolveMariaDbPool(options);
    this.tables = createMariaDbTables(options);
  }

  async initialize(): Promise<void> {
    await ensureMariaDbScheduleSchema(this.options);
  }

  async findLatestOccurrence(
    scheduleName: string,
    options: ScheduleFindLatestOccurrenceOptions = {}
  ): Promise<ScheduleOccurrence | undefined> {
    const values: unknown[] = [scheduleName];
    const statusFilter = createMariaDbStatusFilter(options.statuses, values);
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${this.tables.scheduleOccurrences}
        WHERE schedule_name = ?${statusFilter}
        ORDER BY scheduled_at DESC, occurrence_id DESC
        LIMIT 1
      `,
      values
    );
    const [row] = rowsFromMariaDbResult<MariaDbScheduleOccurrenceRow>(result);

    return row ? mapMariaDbScheduleOccurrence(row) : undefined;
  }

  async listOccurrences(
    options: ScheduleListOccurrencesOptions = {}
  ): Promise<readonly ScheduleOccurrence[]> {
    const values: unknown[] = [];
    const filters: string[] = [];

    if (options.scheduleName !== undefined) {
      values.push(options.scheduleName);
      filters.push("schedule_name = ?");
    }

    if (options.status !== undefined) {
      assertScheduleStatus(options.status, "MariaDB schedule occurrence status filter");
      values.push(options.status);
      filters.push("status = ?");
    }

    const limit = normalizeLimit(options.limit);
    const whereClause = filters.length === 0 ? "" : `WHERE ${filters.join(" AND ")}`;
    const limitClause = limit === undefined ? "" : `LIMIT ${limit}`;

    const result = await this.pool.query(
      `
        SELECT *
        FROM ${this.tables.scheduleOccurrences}
        ${whereClause}
        ORDER BY scheduled_at DESC, occurrence_id DESC
        ${limitClause}
      `,
      values
    );

    return rowsFromMariaDbResult<MariaDbScheduleOccurrenceRow>(result).map(
      mapMariaDbScheduleOccurrence
    );
  }

  async claimOccurrence(
    candidate: ScheduleOccurrenceCandidate,
    options: ScheduleClaimOptions
  ): Promise<ScheduleOccurrence | undefined> {
    const claimExpiresAt =
      options.claimTtlMs === undefined
        ? undefined
        : new Date(options.claimedAt.getTime() + options.claimTtlMs);

    await this.pool.query(
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

    const result = await this.pool.query(
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
    const [row] = rowsFromMariaDbResult<MariaDbScheduleOccurrenceRow>(result);

    return row ? mapMariaDbScheduleOccurrence(row) : undefined;
  }

  async markDispatched(
    occurrence: ScheduleOccurrence,
    options: ScheduleMarkDispatchedOptions
  ): Promise<boolean> {
    const result = await this.pool.query(
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

    return affectedRowsFromMariaDbResult(result) > 0;
  }

  async markFailed(
    occurrence: ScheduleOccurrence,
    options: ScheduleMarkFailedOptions
  ): Promise<boolean> {
    const result = await this.pool.query(
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

    return affectedRowsFromMariaDbResult(result) > 0;
  }
}

const mapMariaDbScheduleOccurrence = (
  row: MariaDbScheduleOccurrenceRow
): ScheduleOccurrence => ({
  scheduleName: row.schedule_name,
  occurrenceId: row.occurrence_id,
  scheduledAt: parseMariaDbRequiredDate(row.scheduled_at, "scheduled_at"),
  status: parseScheduleStatus(row.status),
  ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
  claimedAt: parseMariaDbOptionalDate(row.claimed_at),
  claimExpiresAt: parseMariaDbOptionalDate(row.claim_expires_at),
  dispatchedAt: parseMariaDbOptionalDate(row.dispatched_at),
  failedAt: parseMariaDbOptionalDate(row.failed_at),
  failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined
});

const parseScheduleStatus = (status: string): ScheduleOccurrence["status"] => {
  if (status === "claimed" || status === "dispatched" || status === "failed") {
    return status;
  }

  throw new TypeError("Invalid MariaDB schedule occurrence status.");
};

const createMariaDbStatusFilter = (
  statuses: readonly ScheduleOccurrence["status"][] | undefined,
  values: unknown[]
): string => {
  if (statuses === undefined || statuses.length === 0) {
    return "";
  }

  for (const status of statuses) {
    assertScheduleStatus(status, "MariaDB schedule occurrence status filter");
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
    throw new TypeError("MariaDB schedule occurrence list limit must be a non-negative safe integer.");
  }
  return limit;
};
