import mariadb from "mariadb";
import type { MariaDbBatchOptions, MariaDbPoolLike, MariaDbPoolOptions } from "./options.js";

export const resolveMariaDbPool = (options: MariaDbBatchOptions): MariaDbPoolLike => {
  if (options.pool) {
    return options.pool;
  }

  if (options.connectionString) {
    return mariadb.createPool(parseMariaDbConnectionString(options));
  }

  if (options.poolOptions) {
    return mariadb.createPool(options.poolOptions);
  }

  throw new Error("MariaDB adapter requires a connectionString, poolOptions, or pool.");
};

const parseMariaDbConnectionString = (options: MariaDbBatchOptions): MariaDbPoolOptions => {
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
