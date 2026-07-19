import type { ExecuteValues, PoolOptions } from "mysql2/promise";

export interface MySqlConnectionLike {
  execute(sql: string, values?: ExecuteValues): Promise<unknown>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

export interface MySqlPoolLike {
  execute(sql: string, values?: ExecuteValues): Promise<unknown>;
  getConnection?(): Promise<MySqlConnectionLike>;
  end?(): Promise<void>;
}

export interface MySqlBatchOptions {
  readonly connectionString?: string;
  readonly database?: string;
  readonly tablePrefix?: string;
  readonly pool?: MySqlPoolLike;
  readonly poolOptions?: PoolOptions;
}

export type MySqlPoolOptions = PoolOptions;
