import type {
  ScheduleClaimOptions,
  ScheduleMarkDispatchedOptions,
  ScheduleMarkFailedOptions,
  ScheduleOccurrence,
  ScheduleOccurrenceCandidate,
  ScheduleStore
} from "@nest-batch/scheduler-core";
import { resolvePostgresPool } from "./driver.js";
import type { PostgresBatchOptions, PostgresPoolLike } from "./options.js";
import { ensurePostgresScheduleSchema } from "./schedule-schema.js";
import {
  createPostgresTables,
  parsePostgresOptionalDate,
  parsePostgresRequiredDate,
  rowCountFromPostgresResult,
  rowsFromPostgresResult
} from "./sql.js";

interface PostgresScheduleOccurrenceRow {
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

export class PostgresScheduleStore implements ScheduleStore {
  private readonly pool: PostgresPoolLike;
  private readonly tables: ReturnType<typeof createPostgresTables>;

  constructor(private readonly options: PostgresBatchOptions) {
    this.pool = resolvePostgresPool(options);
    this.tables = createPostgresTables(options);
  }

  async initialize(): Promise<void> {
    await ensurePostgresScheduleSchema(this.options);
  }

  async findLatestOccurrence(scheduleName: string): Promise<ScheduleOccurrence | undefined> {
    const result = await this.pool.query<PostgresScheduleOccurrenceRow>(
      `SELECT * FROM ${this.tables.scheduleOccurrences}
       WHERE schedule_name = $1
       ORDER BY scheduled_at DESC, occurrence_id DESC
       LIMIT 1`,
      [scheduleName]
    );
    const [row] = rowsFromPostgresResult<PostgresScheduleOccurrenceRow>(result);
    return row ? mapPostgresScheduleOccurrence(row) : undefined;
  }

  async claimOccurrence(
    candidate: ScheduleOccurrenceCandidate,
    options: ScheduleClaimOptions
  ): Promise<ScheduleOccurrence | undefined> {
    const claimExpiresAt =
      options.claimTtlMs === undefined
        ? undefined
        : new Date(options.claimedAt.getTime() + options.claimTtlMs);
    const result = await this.pool.query<PostgresScheduleOccurrenceRow>(
      `INSERT INTO ${this.tables.scheduleOccurrences} (
         schedule_name, occurrence_id, scheduled_at, status, owner_id, claimed_at, claim_expires_at
       ) VALUES ($1, $2, $3, 'claimed', $4, $5, $6)
       ON CONFLICT (schedule_name, occurrence_id) DO UPDATE
       SET status = 'claimed',
           owner_id = EXCLUDED.owner_id,
           claimed_at = EXCLUDED.claimed_at,
           claim_expires_at = EXCLUDED.claim_expires_at,
           dispatched_at = NULL,
           failed_at = NULL,
           failure_reason = NULL
       WHERE ${this.tables.scheduleOccurrences}.status = 'claimed'
         AND ${this.tables.scheduleOccurrences}.claim_expires_at IS NOT NULL
         AND ${this.tables.scheduleOccurrences}.claim_expires_at <= EXCLUDED.claimed_at
       RETURNING *`,
      [
        candidate.scheduleName,
        candidate.occurrenceId,
        candidate.scheduledAt,
        options.ownerId,
        options.claimedAt,
        claimExpiresAt
      ]
    );
    const [row] = rowsFromPostgresResult<PostgresScheduleOccurrenceRow>(result);
    return row ? mapPostgresScheduleOccurrence(row) : undefined;
  }

  async markDispatched(
    occurrence: ScheduleOccurrence,
    options: ScheduleMarkDispatchedOptions
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ${this.tables.scheduleOccurrences}
       SET status = 'dispatched', dispatched_at = $4
       WHERE schedule_name = $1 AND occurrence_id = $2 AND owner_id = $3 AND status = 'claimed'`,
      [occurrence.scheduleName, occurrence.occurrenceId, options.ownerId, options.dispatchedAt]
    );
    return rowCountFromPostgresResult(result) > 0;
  }

  async markFailed(
    occurrence: ScheduleOccurrence,
    options: ScheduleMarkFailedOptions
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ${this.tables.scheduleOccurrences}
       SET status = 'failed', failed_at = $4, failure_reason = $5
       WHERE schedule_name = $1 AND occurrence_id = $2 AND owner_id = $3 AND status = 'claimed'`,
      [
        occurrence.scheduleName,
        occurrence.occurrenceId,
        options.ownerId,
        options.failedAt,
        options.failureReason
      ]
    );
    return rowCountFromPostgresResult(result) > 0;
  }
}

const mapPostgresScheduleOccurrence = (row: PostgresScheduleOccurrenceRow): ScheduleOccurrence => ({
  scheduleName: row.schedule_name,
  occurrenceId: row.occurrence_id,
  scheduledAt: parsePostgresRequiredDate(row.scheduled_at, "scheduled_at"),
  status: parseScheduleStatus(row.status),
  ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
  claimedAt: parsePostgresOptionalDate(row.claimed_at),
  claimExpiresAt: parsePostgresOptionalDate(row.claim_expires_at),
  dispatchedAt: parsePostgresOptionalDate(row.dispatched_at),
  failedAt: parsePostgresOptionalDate(row.failed_at),
  failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined
});

const parseScheduleStatus = (status: string): ScheduleOccurrence["status"] => {
  if (status === "claimed" || status === "dispatched" || status === "failed") {
    return status;
  }

  throw new TypeError("Invalid Postgres schedule occurrence status.");
};
