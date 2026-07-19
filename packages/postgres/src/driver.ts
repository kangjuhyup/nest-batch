import pg from "pg";
import type { PostgresBatchOptions, PostgresPoolLike, PostgresPoolOptions } from "./options.js";

const { Pool } = pg;

export const resolvePostgresPool = (options: PostgresBatchOptions): PostgresPoolLike => {
  if (options.pool) {
    return options.pool;
  }

  if (options.connectionString || options.poolOptions) {
    return new Pool(createPostgresPoolOptions(options)) as PostgresPoolLike;
  }

  throw new Error("Postgres adapter requires a connectionString, poolOptions, or pool.");
};

const createPostgresPoolOptions = (options: PostgresBatchOptions): PostgresPoolOptions => {
  return {
    ...options.poolOptions,
    connectionString: options.connectionString ?? options.poolOptions?.connectionString
  };
};
