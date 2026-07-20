import type { ChunkStepExecutionContext } from "../types/step.js";
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
