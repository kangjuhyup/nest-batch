import { resolvePostgresPool } from "./driver.js";
import type { PostgresBatchOptions } from "./options.js";
import { createPostgresTables } from "./sql.js";

export const ensurePostgresScheduleSchema = async (
  options: PostgresBatchOptions
): Promise<void> => {
  const pool = resolvePostgresPool(options);
  const tables = createPostgresTables(options);

  if (tables.schema) {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${tables.schema}"`);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tables.scheduleOccurrences} (
      schedule_name TEXT NOT NULL,
      occurrence_id TEXT NOT NULL,
      scheduled_at TIMESTAMPTZ(3) NOT NULL,
      status TEXT NOT NULL,
      owner_id TEXT NULL,
      claimed_at TIMESTAMPTZ(3) NULL,
      claim_expires_at TIMESTAMPTZ(3) NULL,
      dispatched_at TIMESTAMPTZ(3) NULL,
      failed_at TIMESTAMPTZ(3) NULL,
      failure_reason TEXT NULL,
      PRIMARY KEY (schedule_name, occurrence_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ${tables.scheduleOccurrencesLatestIndex}
    ON ${tables.scheduleOccurrences} (schedule_name, scheduled_at DESC, occurrence_id DESC)
  `);
};
