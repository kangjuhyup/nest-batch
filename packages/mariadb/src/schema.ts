import { resolveMariaDbPool } from "./driver.js";
import type { MariaDbBatchOptions } from "./options.js";
import { createMariaDbTables } from "./sql.js";

export const ensureMariaDbSchema = async (options: MariaDbBatchOptions): Promise<void> => {
  const pool = resolveMariaDbPool(options);
  const tables = createMariaDbTables(options);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tables.jobExecutions} (
      id VARCHAR(191) NOT NULL,
      job_name VARCHAR(255) NOT NULL,
      status VARCHAR(32) NOT NULL,
      parameters JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      started_at DATETIME(3) NULL,
      ended_at DATETIME(3) NULL,
      failure_reason TEXT NULL,
      PRIMARY KEY (id),
      KEY idx_job_executions_job_status (job_name, status)
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tables.stepExecutions} (
      id VARCHAR(191) NOT NULL,
      job_execution_id VARCHAR(191) NOT NULL,
      step_name VARCHAR(255) NOT NULL,
      status VARCHAR(32) NOT NULL,
      read_count INT NOT NULL,
      write_count INT NOT NULL,
      skip_count INT NOT NULL,
      retry_count INT NOT NULL,
      created_at DATETIME(3) NOT NULL,
      started_at DATETIME(3) NULL,
      ended_at DATETIME(3) NULL,
      failure_reason TEXT NULL,
      PRIMARY KEY (id),
      KEY idx_step_executions_job_step_status (job_execution_id, step_name, status)
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tables.checkpoints} (
      execution_id VARCHAR(191) NOT NULL,
      step_name VARCHAR(255) NOT NULL,
      checkpoint JSON NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      PRIMARY KEY (execution_id, step_name)
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tables.locks} (
      resource VARCHAR(255) NOT NULL,
      owner_id VARCHAR(255) NOT NULL,
      acquired_at DATETIME(3) NOT NULL,
      expires_at DATETIME(3) NULL,
      PRIMARY KEY (resource),
      KEY idx_locks_expires_at (expires_at)
    ) ENGINE=InnoDB
  `);
};
