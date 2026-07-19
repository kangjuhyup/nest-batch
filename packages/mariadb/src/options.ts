import type { PoolConfig } from "mariadb";

export interface MariaDbConnectionLike {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

export interface MariaDbPoolLike {
  query(sql: string, values?: readonly unknown[]): Promise<unknown>;
  getConnection?(): Promise<MariaDbConnectionLike>;
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
