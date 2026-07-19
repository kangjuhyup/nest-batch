import mysql from "mysql2/promise";
import type { MySqlBatchOptions, MySqlPoolLike, MySqlPoolOptions } from "./options.js";

export const resolveMySqlPool = (options: MySqlBatchOptions): MySqlPoolLike => {
  if (options.pool) {
    return options.pool;
  }

  if (options.connectionString) {
    return mysql.createPool(parseMySqlConnectionString(options));
  }

  if (options.poolOptions) {
    return mysql.createPool(options.poolOptions);
  }

  throw new Error("MySQL adapter requires a connectionString, poolOptions, or pool.");
};

const parseMySqlConnectionString = (options: MySqlBatchOptions): MySqlPoolOptions => {
  const url = new URL(options.connectionString ?? "");
  const databaseFromPath = url.pathname.replace(/^\//, "") || undefined;

  return {
    ...options.poolOptions,
    host: url.hostname || options.poolOptions?.host,
    port: url.port ? Number(url.port) : options.poolOptions?.port,
    user: url.username ? decodeURIComponent(url.username) : options.poolOptions?.user,
    password: url.password ? decodeURIComponent(url.password) : options.poolOptions?.password,
    database: options.poolOptions?.database ?? databaseFromPath ?? options.database
  };
};
