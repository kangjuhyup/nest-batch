import { resolveMySqlPool } from "./driver.js";
import type { MySqlBatchOptions } from "./options.js";
import { createMySqlTables } from "./sql.js";

export const ensureMySqlScheduleSchema = async (
  options: MySqlBatchOptions
): Promise<void> => {
  const pool = resolveMySqlPool(options);
  const tables = createMySqlTables(options);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ${tables.scheduleOccurrences} (
      schedule_name VARCHAR(255) NOT NULL,
      occurrence_id VARCHAR(191) NOT NULL,
      scheduled_at DATETIME(3) NOT NULL,
      status VARCHAR(32) NOT NULL,
      owner_id VARCHAR(255) NULL,
      claimed_at DATETIME(3) NULL,
      claim_expires_at DATETIME(3) NULL,
      dispatched_at DATETIME(3) NULL,
      failed_at DATETIME(3) NULL,
      failure_reason TEXT NULL,
      PRIMARY KEY (schedule_name, occurrence_id),
      KEY idx_schedule_occurrences_latest (schedule_name, scheduled_at, occurrence_id)
    ) ENGINE=InnoDB
  `);
};
