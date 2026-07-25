import { resolveMySqlPool } from "./driver.js";
import type { MySqlBatchOptions } from "./options.js";
import { createMySqlTables } from "./sql.js";

export const ensureMySqlSchema = async (options: MySqlBatchOptions): Promise<void> => {
  const pool = resolveMySqlPool(options);
  const tables = createMySqlTables(options);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ${tables.jobInstances} (
      id VARCHAR(191) NOT NULL,
      job_name VARCHAR(255) NOT NULL,
      parameters_hash VARCHAR(191) NOT NULL,
      parameters JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY idx_job_instances_job_parameters (job_name, parameters_hash)
    ) ENGINE=InnoDB
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ${tables.jobExecutions} (
      id VARCHAR(191) NOT NULL,
      instance_id VARCHAR(191) NOT NULL,
      job_name VARCHAR(255) NOT NULL,
      status VARCHAR(32) NOT NULL,
      parameters JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      started_at DATETIME(3) NULL,
      ended_at DATETIME(3) NULL,
      failure_reason TEXT NULL,
      PRIMARY KEY (id),
      KEY idx_job_executions_job_status (job_name, status),
      KEY idx_job_executions_instance_status (instance_id, status, created_at)
    ) ENGINE=InnoDB
  `);

  await pool.execute(`
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

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ${tables.partitionExecutions} (
      id VARCHAR(191) NOT NULL,
      step_execution_id VARCHAR(191) NOT NULL,
      step_name VARCHAR(255) NOT NULL,
      status VARCHAR(32) NOT NULL,
      partition JSON NOT NULL,
      owner_id VARCHAR(255) NULL,
      read_count INT NOT NULL,
      write_count INT NOT NULL,
      skip_count INT NOT NULL,
      retry_count INT NOT NULL,
      created_at DATETIME(3) NOT NULL,
      started_at DATETIME(3) NULL,
      ended_at DATETIME(3) NULL,
      failure_reason TEXT NULL,
      PRIMARY KEY (id),
      KEY idx_partition_executions_step_status (step_execution_id, status, created_at)
    ) ENGINE=InnoDB
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ${tables.checkpoints} (
      execution_id VARCHAR(191) NOT NULL,
      step_name VARCHAR(255) NOT NULL,
      checkpoint JSON NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      PRIMARY KEY (execution_id, step_name)
    ) ENGINE=InnoDB
  `);

  await pool.execute(`
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
