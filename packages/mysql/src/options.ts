import type { ExecuteValues, PoolOptions } from "mysql2/promise";

export interface MySqlPoolLike {
  execute(sql: string, values?: ExecuteValues): Promise<unknown>;
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
