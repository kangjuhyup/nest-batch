import type { ChunkStepExecutionContext } from "../types/step.js";

export interface ReaderSession<Item, TCheckpoint = unknown> extends AsyncIterable<Item> {
  checkpoint?(): TCheckpoint | undefined | Promise<TCheckpoint | undefined>;
  close?(): void | Promise<void>;
}

export interface Reader<Item, TCheckpoint = unknown> {
  open(
    context: ChunkStepExecutionContext<TCheckpoint>
  ): ReaderSession<Item, TCheckpoint> | Promise<ReaderSession<Item, TCheckpoint>>;
}

export interface LegacyReader<Item, TCheckpoint = unknown> {
  read(context: ChunkStepExecutionContext<TCheckpoint>): AsyncIterable<Item> | Iterable<Item>;
}

export type ChunkReader<Item, TCheckpoint = unknown> =
  | Reader<Item, TCheckpoint>
  | LegacyReader<Item, TCheckpoint>;

export const openReader = async <Item, TCheckpoint = unknown>(
  reader: ChunkReader<Item, TCheckpoint>,
  context: ChunkStepExecutionContext<TCheckpoint>
): Promise<ReaderSession<Item, TCheckpoint>> => {
  if (isSessionReader(reader)) {
    return reader.open(context);
  }

  return createIterableSession(reader.read(context));
};

export const closeReader = async <Item, TCheckpoint = unknown>(
  session: ReaderSession<Item, TCheckpoint>
): Promise<void> => {
  await session.close?.();
};

export const getReaderCheckpoint = async <Item, TCheckpoint = unknown>(
  session: ReaderSession<Item, TCheckpoint>
): Promise<TCheckpoint | undefined> => {
  return session.checkpoint?.();
};

export const createIterableSession = <Item, TCheckpoint = unknown>(
  items: AsyncIterable<Item> | Iterable<Item>
): ReaderSession<Item, TCheckpoint> => ({
  async *[Symbol.asyncIterator]() {
    const asyncItems = items as AsyncIterable<Item>;

    if (typeof asyncItems[Symbol.asyncIterator] === "function") {
      for await (const item of asyncItems) {
        yield item;
      }
      return;
    }

    for (const item of items as Iterable<Item>) {
      yield item;
    }
  }
});

const isSessionReader = <Item, TCheckpoint>(
  reader: ChunkReader<Item, TCheckpoint>
): reader is Reader<Item, TCheckpoint> => {
  return "open" in reader && typeof reader.open === "function";
};
