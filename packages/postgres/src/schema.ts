import { resolvePostgresPool } from "./driver.js";
import type { PostgresBatchOptions } from "./options.js";
import { createPostgresTables } from "./sql.js";

export const ensurePostgresSchema = async (options: PostgresBatchOptions): Promise<void> => {
  const pool = resolvePostgresPool(options);
  const tables = createPostgresTables(options);

  if (tables.schema) {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${tables.schema}"`);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tables.jobExecutions} (
      id TEXT NOT NULL,
      job_name TEXT NOT NULL,
      status TEXT NOT NULL,
      parameters JSONB NOT NULL,
      created_at TIMESTAMPTZ(3) NOT NULL,
      started_at TIMESTAMPTZ(3) NULL,
      ended_at TIMESTAMPTZ(3) NULL,
      failure_reason TEXT NULL,
      PRIMARY KEY (id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ${tables.jobStatusIndex}
    ON ${tables.jobExecutions} (job_name, status)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tables.stepExecutions} (
      id TEXT NOT NULL,
      job_execution_id TEXT NOT NULL,
      step_name TEXT NOT NULL,
      status TEXT NOT NULL,
      read_count INTEGER NOT NULL,
      write_count INTEGER NOT NULL,
      skip_count INTEGER NOT NULL,
      retry_count INTEGER NOT NULL,
      created_at TIMESTAMPTZ(3) NOT NULL,
      started_at TIMESTAMPTZ(3) NULL,
      ended_at TIMESTAMPTZ(3) NULL,
      failure_reason TEXT NULL,
      PRIMARY KEY (id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ${tables.stepStatusIndex}
    ON ${tables.stepExecutions} (job_execution_id, step_name, status)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tables.checkpoints} (
      execution_id TEXT NOT NULL,
      step_name TEXT NOT NULL,
      checkpoint JSONB NOT NULL,
      updated_at TIMESTAMPTZ(3) NOT NULL,
      PRIMARY KEY (execution_id, step_name)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tables.locks} (
      resource TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      acquired_at TIMESTAMPTZ(3) NOT NULL,
      expires_at TIMESTAMPTZ(3) NULL,
      PRIMARY KEY (resource)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ${tables.locksExpiresAtIndex}
    ON ${tables.locks} (expires_at)
  `);
};
