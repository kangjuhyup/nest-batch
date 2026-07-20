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

export type ReaderDefinition<Item, TCheckpoint = unknown> =
  | IterableReaderDefinition<Item, TCheckpoint>
  | FunctionReaderDefinition<Item, TCheckpoint>
  | CursorReaderDefinition<Item, unknown, CursorReaderCheckpoint<unknown>>
  | PagingReaderDefinition<Item, PagingReaderCheckpoint>
  | PageReaderDefinition<Item, PagingReaderCheckpoint>;

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
      reader.kind === "paging")
  );
};
