import { createSqlCursorReader, type SqlCursorReader } from "@rvkang/batch-core";
import type { MySqlPoolLike } from "./options.js";
import { rowsFromMySqlResult } from "./sql.js";

const IDENTIFIER_PATH_PART_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface MySqlCursorReaderOptions<
  Item,
  Cursor,
  Row = Record<string, unknown>
> {
  readonly pool: MySqlPoolLike;
  readonly table: string;
  readonly cursorColumn: string;
  readonly columns?: readonly string[];
  readonly where?: string;
  readonly values?: readonly unknown[];
  readonly pageSize: number;
  readonly mapRow?: (row: Row) => Item;
  readonly getCursor: (item: Item) => Cursor;
}

export const createMySqlCursorReader = <
  Item,
  Cursor,
  Row = Record<string, unknown>
>(
  options: MySqlCursorReaderOptions<Item, Cursor, Row>
): SqlCursorReader<Item, Cursor> => {
  const table = quoteMySqlIdentifierPath(options.table, "table");
  const cursorColumn = quoteMySqlIdentifierPath(options.cursorColumn, "cursorColumn");
  const columns = createMySqlColumnList(options.columns);
  const mapRow = options.mapRow ?? ((row: Row): Item => row as unknown as Item);

  return createSqlCursorReader<Item, Cursor>({
    pageSize: options.pageSize,
    async query({ cursor, pageSize, signal }) {
      signal.throwIfAborted();

      const values = [...(options.values ?? [])];
      const conditions = options.where ? [`(${options.where})`] : [];

      if (cursor !== undefined) {
        values.push(cursor);
        conditions.push(`${cursorColumn} > ?`);
      }

      values.push(pageSize);
      const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
      const result = await options.pool.execute(
        `SELECT ${columns} FROM ${table}${whereClause} ORDER BY ${cursorColumn} ASC LIMIT ?`,
        values as Parameters<MySqlPoolLike["execute"]>[1]
      );

      signal.throwIfAborted();

      return rowsFromMySqlResult<Row>(result).map(mapRow);
    },
    getCursor: options.getCursor
  });
};

const createMySqlColumnList = (columns?: readonly string[]): string => {
  if (!columns || columns.length === 0) {
    return "*";
  }

  return columns
    .map((column) => {
      if (column === "*") {
        return column;
      }

      return quoteMySqlIdentifierPath(column, "columns");
    })
    .join(", ");
};

const quoteMySqlIdentifierPath = (identifier: string, optionName: string): string => {
  const parts = identifier.split(".");

  if (parts.some((part) => !IDENTIFIER_PATH_PART_PATTERN.test(part))) {
    throw new TypeError(
      `MySQL cursor reader ${optionName} must be a dot-separated SQL identifier.`
    );
  }

  return parts.map((part) => `\`${part}\``).join(".");
};
