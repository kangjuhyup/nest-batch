import { createRequire } from "node:module";

interface MariaDbPool {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
  end(): Promise<void>;
}

interface MariaDbModule {
  createPool(options: MariaDbPoolOptions): MariaDbPool;
}

interface MariaDbPoolOptions {
  readonly host?: string;
  readonly port?: number;
  readonly user?: string;
  readonly password?: string;
  readonly database?: string;
  readonly timezone?: string;
}

export interface MariaDbE2eDatabaseOptions {
  readonly label: string;
  readonly urlEnv: string;
  readonly fallbackUrlEnvs?: readonly string[];
  readonly defaultUrl: string;
  readonly databaseEnv: string;
  readonly defaultDatabase: string;
  readonly tablePrefixEnv: string;
  readonly defaultTablePrefix: string;
  readonly tablePrefixPrefix: string;
}

export interface MariaDbE2eDatabase {
  readonly connectionString: string;
  readonly database: string;
  readonly tablePrefix: string;
  readonly available: boolean;
  assertAvailable(): Promise<void>;
  resetTables(): Promise<void>;
  close(): Promise<void>;
}

const mariadbRequire = createRequire(new URL("../../packages/mariadb/package.json", import.meta.url));
const mariadb = mariadbRequire("mariadb") as MariaDbModule;

export const createMariaDbE2eDatabase = (
  options: MariaDbE2eDatabaseOptions
): MariaDbE2eDatabase => {
  const connectionString = readConnectionString(options);
  const database = validateIdentifier(
    process.env[options.databaseEnv] ?? readDatabaseFromConnectionString(connectionString) ?? options.defaultDatabase,
    `${options.label} database`
  );
  const tablePrefix = validatePrefixedIdentifier(
    process.env[options.tablePrefixEnv] ?? options.defaultTablePrefix,
    options.tablePrefixPrefix,
    `${options.label} table prefix`
  );
  const pool = mariadb.createPool(parseConnectionString(connectionString, database));
  let available = false;

  return {
    connectionString,
    database,
    tablePrefix,
    get available() {
      return available;
    },
    async assertAvailable() {
      try {
        await pool.query("SELECT 1");
        available = true;
      } catch (cause) {
        throw new Error(
          `${options.label} is not reachable. Run "docker compose up -d mariadb" or set ${options.urlEnv}. Cause: ${formatCause(cause)}`
        );
      }
    },
    async resetTables() {
      for (const tableName of createTableNames(tablePrefix)) {
        await pool.query(`DROP TABLE IF EXISTS ${quoteIdentifier(database)}.${quoteIdentifier(tableName)}`);
      }
    },
    async close() {
      await pool.end();
    }
  };
};

const readConnectionString = (options: MariaDbE2eDatabaseOptions): string => {
  for (const envName of [options.urlEnv, ...(options.fallbackUrlEnvs ?? [])]) {
    const value = process.env[envName];

    if (value) {
      return value;
    }
  }

  return options.defaultUrl;
};

const readDatabaseFromConnectionString = (connectionString: string): string | undefined => {
  const pathname = new URL(connectionString).pathname.replace(/^\//, "");
  return pathname.length > 0 ? pathname : undefined;
};

const parseConnectionString = (connectionString: string, database: string): MariaDbPoolOptions => {
  const url = new URL(connectionString);

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    user: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    database,
    timezone: "Z"
  };
};

const createTableNames = (tablePrefix: string): readonly string[] => [
  `${tablePrefix}_locks`,
  `${tablePrefix}_checkpoints`,
  `${tablePrefix}_partition_executions`,
  `${tablePrefix}_step_executions`,
  `${tablePrefix}_job_executions`,
  `${tablePrefix}_job_instances`
];

const validatePrefixedIdentifier = (value: string, prefix: string, optionName: string): string => {
  const identifier = validateIdentifier(value, optionName);

  if (!identifier.startsWith(prefix)) {
    throw new Error(`${optionName} must start with ${prefix} so cleanup cannot drop shared tables.`);
  }

  return identifier;
};

const validateIdentifier = (value: string, optionName: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid ${optionName} identifier.`);
  }

  return value;
};

const quoteIdentifier = (value: string): string => `\`${value}\``;

const formatCause = (cause: unknown): string => {
  if (cause instanceof AggregateError) {
    return cause.errors.map(formatCause).join("; ");
  }

  if (cause instanceof Error) {
    const code = "code" in cause ? String(cause.code) : undefined;
    return code ? `${code}: ${cause.message}` : cause.message;
  }

  return String(cause);
};
