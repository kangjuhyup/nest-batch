import { createSqlCursorReader, type SqlCursorReader } from "@rv-nest-batch/core";
import type { PostgresPoolLike } from "./options.js";
import { rowsFromPostgresResult } from "./sql.js";

const IDENTIFIER_PATH_PART_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface PostgresCursorReaderOptions<
  Item,
  Cursor,
  Row = Record<string, unknown>
> {
  readonly pool: PostgresPoolLike;
  readonly table: string;
  readonly cursorColumn: string;
  readonly columns?: readonly string[];
  readonly where?: string;
  readonly values?: readonly unknown[];
  readonly pageSize: number;
  readonly mapRow?: (row: Row) => Item;
  readonly getCursor: (item: Item) => Cursor;
}

export const createPostgresCursorReader = <
  Item,
  Cursor,
  Row = Record<string, unknown>
>(
  options: PostgresCursorReaderOptions<Item, Cursor, Row>
): SqlCursorReader<Item, Cursor> => {
  const table = quotePostgresIdentifierPath(options.table, "table");
  const cursorColumn = quotePostgresIdentifierPath(options.cursorColumn, "cursorColumn");
  const columns = createPostgresColumnList(options.columns);
  const mapRow = options.mapRow ?? ((row: Row): Item => row as unknown as Item);

  return createSqlCursorReader<Item, Cursor>({
    pageSize: options.pageSize,
    async query({ cursor, pageSize, signal }) {
      signal.throwIfAborted();

      const values = [...(options.values ?? [])];
      const conditions = options.where ? [`(${options.where})`] : [];

      if (cursor !== undefined) {
        const cursorPlaceholder = `$${values.length + 1}`;
        values.push(cursor);
        conditions.push(`${cursorColumn} > ${cursorPlaceholder}`);
      }

      const limitPlaceholder = `$${values.length + 1}`;
      values.push(pageSize);
      const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
      const result = await options.pool.query<Row>(
        `SELECT ${columns} FROM ${table}${whereClause} ORDER BY ${cursorColumn} ASC LIMIT ${limitPlaceholder}`,
        values
      );

      signal.throwIfAborted();

      return rowsFromPostgresResult<Row>(result).map(mapRow);
    },
    getCursor: options.getCursor
  });
};

const createPostgresColumnList = (columns?: readonly string[]): string => {
  if (!columns || columns.length === 0) {
    return "*";
  }

  return columns
    .map((column) => {
      if (column === "*") {
        return column;
      }

      return quotePostgresIdentifierPath(column, "columns");
    })
    .join(", ");
};

const quotePostgresIdentifierPath = (identifier: string, optionName: string): string => {
  const parts = identifier.split(".");

  if (parts.some((part) => !IDENTIFIER_PATH_PART_PATTERN.test(part))) {
    throw new TypeError(
      `Postgres cursor reader ${optionName} must be a dot-separated SQL identifier.`
    );
  }

  return parts.map((part) => `"${part}"`).join(".");
};
