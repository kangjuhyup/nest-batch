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
    CREATE TABLE IF NOT EXISTS ${tables.jobInstances} (
      id TEXT NOT NULL,
      job_name TEXT NOT NULL,
      parameters_hash TEXT NOT NULL,
      parameters JSONB NOT NULL,
      created_at TIMESTAMPTZ(3) NOT NULL,
      PRIMARY KEY (id)
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${tables.jobInstanceParametersIndex}
    ON ${tables.jobInstances} (job_name, parameters_hash)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tables.jobExecutions} (
      id TEXT NOT NULL,
      instance_id TEXT NOT NULL,
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
    CREATE INDEX IF NOT EXISTS ${tables.jobExecutionInstanceStatusIndex}
    ON ${tables.jobExecutions} (instance_id, status, created_at)
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
    CREATE TABLE IF NOT EXISTS ${tables.partitionExecutions} (
      id TEXT NOT NULL,
      step_execution_id TEXT NOT NULL,
      step_name TEXT NOT NULL,
      status TEXT NOT NULL,
      partition JSONB NOT NULL,
      owner_id TEXT NULL,
      heartbeat_at TIMESTAMPTZ(3) NULL,
      claim_expires_at TIMESTAMPTZ(3) NULL,
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
    CREATE INDEX IF NOT EXISTS ${tables.partitionStatusIndex}
    ON ${tables.partitionExecutions} (step_execution_id, status, created_at)
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
    CREATE TABLE IF NOT EXISTS ${tables.executionContexts} (
      execution_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      name TEXT NOT NULL,
      context JSONB NOT NULL,
      updated_at TIMESTAMPTZ(3) NOT NULL,
      PRIMARY KEY (execution_id, scope, name)
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
