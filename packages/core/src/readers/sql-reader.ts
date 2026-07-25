import type { ChunkStepExecutionContext } from "../types/step.js";
import {
  createCursorReader,
  type CursorReaderCheckpoint,
  type CursorReaderOptions
} from "./cursor-reader.js";
import {
  createPagingReader,
  type PagingReaderCheckpoint,
  type PagingReaderOptions
} from "./paging-reader.js";
import type { Reader } from "./reader.js";

export interface SqlReaderCheckpoint extends PagingReaderCheckpoint {}

export interface SqlReaderQueryContext<TCheckpoint extends SqlReaderCheckpoint>
  extends ChunkStepExecutionContext<TCheckpoint> {
  readonly page: number;
  readonly pageSize: number;
  readonly offset: number;
}

export interface SqlReaderOptions<
  Item,
  TCheckpoint extends SqlReaderCheckpoint = SqlReaderCheckpoint
> {
  readonly pageSize: number;
  readonly initialPage?: number;
  readonly query: (
    context: SqlReaderQueryContext<TCheckpoint>
  ) => readonly Item[] | Promise<readonly Item[]>;
}

export interface SqlReader<
  Item,
  TCheckpoint extends SqlReaderCheckpoint = SqlReaderCheckpoint
> extends Reader<Item, TCheckpoint> {}

export interface SqlReaderDefinition<
  Item,
  TCheckpoint extends SqlReaderCheckpoint = SqlReaderCheckpoint
> extends SqlReaderOptions<Item, TCheckpoint> {
  readonly kind: "sql";
}

export interface SqlCursorReaderCheckpoint<Cursor> extends CursorReaderCheckpoint<Cursor> {}

export interface SqlCursorReaderQueryContext<
  Cursor,
  TCheckpoint extends SqlCursorReaderCheckpoint<Cursor>
> extends ChunkStepExecutionContext<TCheckpoint> {
  readonly cursor?: Cursor;
  readonly pageSize: number;
}

export interface SqlCursorReaderOptions<
  Item,
  Cursor,
  TCheckpoint extends SqlCursorReaderCheckpoint<Cursor> = SqlCursorReaderCheckpoint<Cursor>
> {
  readonly pageSize: number;
  readonly query: (
    context: SqlCursorReaderQueryContext<Cursor, TCheckpoint>
  ) => readonly Item[] | Promise<readonly Item[]>;
  readonly getCursor: (item: Item) => Cursor;
}

export interface SqlCursorReader<
  Item,
  Cursor,
  TCheckpoint extends SqlCursorReaderCheckpoint<Cursor> = SqlCursorReaderCheckpoint<Cursor>
> extends Reader<Item, TCheckpoint> {}

export const createSqlReader = <
  Item,
  TCheckpoint extends SqlReaderCheckpoint = SqlReaderCheckpoint
>(
  options: SqlReaderOptions<Item, TCheckpoint>
): SqlReader<Item, TCheckpoint> => {
  const pagingOptions: PagingReaderOptions<Item, TCheckpoint> = {
    pageSize: options.pageSize,
    initialPage: options.initialPage,
    fetch(context) {
      return options.query({
        ...context,
        offset: context.page * context.pageSize
      });
    }
  };

  return createPagingReader(pagingOptions);
};

export const createSqlCursorReader = <
  Item,
  Cursor,
  TCheckpoint extends SqlCursorReaderCheckpoint<Cursor> = SqlCursorReaderCheckpoint<Cursor>
>(
  options: SqlCursorReaderOptions<Item, Cursor, TCheckpoint>
): SqlCursorReader<Item, Cursor, TCheckpoint> => {
  validatePositiveInteger(options.pageSize, "pageSize");
  const cursorOptions: CursorReaderOptions<Item, Cursor, TCheckpoint> = {
    fetch(context) {
      return options.query({
        ...context,
        pageSize: options.pageSize
      });
    },
    getCursor: options.getCursor
  };

  return createCursorReader(cursorOptions);
};

const validatePositiveInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`SQL cursor reader ${name} must be a positive safe integer.`);
  }
};
