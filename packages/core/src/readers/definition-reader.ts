import {
  createCursorReader,
  type CursorReaderCheckpoint,
  type CursorReaderDefinition,
  type CursorReaderOptions
} from "./cursor-reader.js";
import {
  createFunctionReader,
  type FunctionReaderDefinition
} from "./function-reader.js";
import {
  createFileReader,
  type FileReaderCheckpoint,
  type FileReaderDefinition,
  type FileReaderOptions
} from "./file-reader.js";
import {
  createHttpReader,
  type HttpReaderCheckpoint,
  type HttpReaderDefinition,
  type HttpReaderOptions
} from "./http-reader.js";
import {
  createIterableReader,
  type IterableReaderDefinition
} from "./iterable-reader.js";
import {
  createPagingReader,
  type PageReaderDefinition,
  type PagingReaderCheckpoint,
  type PagingReaderDefinition,
  type PagingReaderOptions
} from "./paging-reader.js";
import type { ChunkReader, Reader } from "./reader.js";
import {
  createSqlReader,
  type SqlReaderCheckpoint,
  type SqlReaderDefinition,
  type SqlReaderOptions
} from "./sql-reader.js";

export type ReaderDefinition<Item, TCheckpoint = unknown> =
  | IterableReaderDefinition<Item, TCheckpoint>
  | FunctionReaderDefinition<Item, TCheckpoint>
  | CursorReaderDefinition<Item, unknown, CursorReaderCheckpoint<unknown>>
  | PagingReaderDefinition<Item, PagingReaderCheckpoint>
  | PageReaderDefinition<Item, PagingReaderCheckpoint>
  | SqlReaderDefinition<Item, SqlReaderCheckpoint>
  | HttpReaderDefinition<Item, unknown, HttpReaderCheckpoint<unknown>>
  | FileReaderDefinition<Item, FileReaderCheckpoint>;

export const normalizeReader = <Item, TCheckpoint = unknown>(
  reader: ChunkReader<Item, TCheckpoint>
): ChunkReader<Item, TCheckpoint> => {
  return isReaderDefinition(reader) ? createReader(reader) : reader;
};

export const createReader = <Item, TCheckpoint = unknown>(
  definition: ReaderDefinition<Item, TCheckpoint>
): Reader<Item, TCheckpoint> => {
  switch (definition.kind) {
    case "iterable":
      return createIterableReader<Item, TCheckpoint>(definition.source);
    case "function":
      return createFunctionReader<Item, TCheckpoint>(definition.read);
    case "cursor":
      return createCursorReader(
        definition as CursorReaderOptions<Item, unknown, CursorReaderCheckpoint<unknown>>
      ) as Reader<Item, TCheckpoint>;
    case "page":
    case "paging":
      return createPagingReader(
        definition as PagingReaderOptions<Item, PagingReaderCheckpoint>
      ) as Reader<Item, TCheckpoint>;
    case "sql":
      return createSqlReader(
        definition as SqlReaderOptions<Item, SqlReaderCheckpoint>
      ) as Reader<Item, TCheckpoint>;
    case "http":
      return createHttpReader(
        definition as HttpReaderOptions<Item, unknown, HttpReaderCheckpoint<unknown>>
      ) as Reader<Item, TCheckpoint>;
    case "file":
      return createFileReader(
        definition as FileReaderOptions<Item, FileReaderCheckpoint>
      ) as Reader<Item, TCheckpoint>;
  }
};

export const isReaderDefinition = <Item, TCheckpoint = unknown>(
  reader: ChunkReader<Item, TCheckpoint>
): reader is ReaderDefinition<Item, TCheckpoint> => {
  return (
    typeof reader === "object" &&
    reader !== null &&
    "kind" in reader &&
    (reader.kind === "iterable" ||
      reader.kind === "function" ||
      reader.kind === "cursor" ||
      reader.kind === "page" ||
      reader.kind === "paging" ||
      reader.kind === "sql" ||
      reader.kind === "http" ||
      reader.kind === "file")
  );
};
