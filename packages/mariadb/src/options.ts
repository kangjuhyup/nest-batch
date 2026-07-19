import type { PoolConfig } from "mariadb";

export interface MariaDbPoolLike {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
  end?(): Promise<void>;
}

export interface MariaDbBatchOptions {
  readonly connectionString?: string;
  readonly database?: string;
  readonly tablePrefix?: string;
  readonly pool?: MariaDbPoolLike;
  readonly poolOptions?: PoolConfig;
}

export type MariaDbPoolOptions = PoolConfig;
