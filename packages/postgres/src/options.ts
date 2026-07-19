export interface PostgresQueryResultLike<TRow = Record<string, unknown>> {
  readonly rows: readonly TRow[];
  readonly rowCount?: number | null;
}

export interface PostgresPoolLike {
  query<TRow = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[]
  ): Promise<PostgresQueryResultLike<TRow> | unknown>;
  end?(): Promise<void>;
}

export interface PostgresPoolOptions {
  readonly connectionString?: string;
  readonly host?: string;
  readonly port?: number;
  readonly user?: string;
  readonly password?: string;
  readonly database?: string;
  readonly max?: number;
  readonly idleTimeoutMillis?: number;
  readonly connectionTimeoutMillis?: number;
  readonly ssl?: boolean | Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface PostgresBatchOptions {
  readonly connectionString?: string;
  readonly schema?: string;
  readonly tablePrefix?: string;
  readonly pool?: PostgresPoolLike;
  readonly poolOptions?: PostgresPoolOptions;
}
