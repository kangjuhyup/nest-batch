import type { ChunkStepExecutionContext } from "../types/step.js";
import { createIterableSession, type Reader } from "./reader.js";

export type IterableReaderSource<Item, TCheckpoint = unknown> =
  | AsyncIterable<Item>
  | Iterable<Item>
  | ((
      context: ChunkStepExecutionContext<TCheckpoint>
    ) => AsyncIterable<Item> | Iterable<Item> | Promise<AsyncIterable<Item> | Iterable<Item>>);

export const createIterableReader = <Item, TCheckpoint = unknown>(
  source: IterableReaderSource<Item, TCheckpoint>
): Reader<Item, TCheckpoint> => ({
  async open(context) {
    const items = typeof source === "function" ? await source(context) : source;
    return createIterableSession<Item, TCheckpoint>(items);
  }
});
