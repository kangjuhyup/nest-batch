import { createRequire } from "node:module";

interface PgPool {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
  end(): Promise<void>;
}

interface PgModule {
  Pool: new (options: { readonly connectionString: string }) => PgPool;
}

export interface PostgresE2eDatabaseOptions {
  readonly label: string;
  readonly urlEnv: string;
  readonly fallbackUrlEnvs?: readonly string[];
  readonly defaultUrl: string;
  readonly schemaEnv: string;
  readonly defaultSchema: string;
  readonly schemaPrefix: string;
  readonly tablePrefixEnv: string;
  readonly defaultTablePrefix: string;
}

export interface PostgresE2eDatabase {
  readonly connectionString: string;
  readonly schema: string;
  readonly tablePrefix: string;
  readonly available: boolean;
  assertAvailable(): Promise<void>;
  resetSchema(): Promise<void>;
  close(): Promise<void>;
}

const postgresRequire = createRequire(new URL("../../packages/postgres/package.json", import.meta.url));
const { Pool } = postgresRequire("pg") as PgModule;

export const createPostgresE2eDatabase = (options: PostgresE2eDatabaseOptions): PostgresE2eDatabase => {
  const connectionString = readConnectionString(options);
  const schema = validatePrefixedIdentifier(
    process.env[options.schemaEnv] ?? options.defaultSchema,
    options.schemaPrefix,
    `${options.label} schema`
  );
  const tablePrefix = validateIdentifier(
    process.env[options.tablePrefixEnv] ?? options.defaultTablePrefix,
    `${options.label} table prefix`
  );
  const quotedSchema = quoteIdentifier(schema);
  const pool = new Pool({ connectionString });
  let available = false;

  return {
    connectionString,
    schema,
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
          `${options.label} is not reachable. Run "docker compose up -d postgres" or set ${options.urlEnv}. Cause: ${formatCause(cause)}`
        );
      }
    },
    async resetSchema() {
      await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    },
    async close() {
      await pool.end();
    }
  };
};

const readConnectionString = (options: PostgresE2eDatabaseOptions): string => {
  for (const envName of [options.urlEnv, ...(options.fallbackUrlEnvs ?? [])]) {
    const value = process.env[envName];

    if (value) {
      return value;
    }
  }

  return options.defaultUrl;
};

const validatePrefixedIdentifier = (value: string, prefix: string, optionName: string): string => {
  const identifier = validateIdentifier(value, optionName);

  if (!identifier.startsWith(prefix)) {
    throw new Error(`${optionName} must start with ${prefix} so cleanup cannot drop shared schemas.`);
  }

  return identifier;
};

const validateIdentifier = (value: string, optionName: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid ${optionName} identifier.`);
  }

  return value;
};

const quoteIdentifier = (value: string): string => `"${value}"`;

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
