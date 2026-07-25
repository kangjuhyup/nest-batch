import type { JobParameters } from "../types/common.js";
import type { ChunkStepExecutionContext } from "../types/step.js";
import { createReader, isReaderDefinition, type ReaderDefinition } from "./definition-reader.js";

export interface ReaderSession<Item, TCheckpoint = unknown> extends AsyncIterable<Item> {
  checkpoint?(): TCheckpoint | undefined | Promise<TCheckpoint | undefined>;
  close?(): void | Promise<void>;
}

export interface Reader<
  Item,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> {
  open(
    context: ChunkStepExecutionContext<TCheckpoint, Parameters>
  ): ReaderSession<Item, TCheckpoint> | Promise<ReaderSession<Item, TCheckpoint>>;
}

export interface LegacyReader<
  Item,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> {
  read(context: ChunkStepExecutionContext<TCheckpoint, Parameters>): AsyncIterable<Item> | Iterable<Item>;
}

export type ChunkReader<
  Item,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
> =
  | Reader<Item, TCheckpoint, Parameters>
  | LegacyReader<Item, TCheckpoint, Parameters>
  | ReaderDefinition<Item, TCheckpoint>;

export const openReader = async <
  Item,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
>(
  reader: ChunkReader<Item, TCheckpoint, Parameters>,
  context: ChunkStepExecutionContext<TCheckpoint, Parameters>
): Promise<ReaderSession<Item, TCheckpoint>> => {
  if (isReaderDefinition(reader)) {
    return createReader(reader).open(context);
  }

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

const isSessionReader = <
  Item,
  TCheckpoint,
  Parameters extends JobParameters
>(
  reader: ChunkReader<Item, TCheckpoint, Parameters>
): reader is Reader<Item, TCheckpoint, Parameters> => {
  return "open" in reader && typeof reader.open === "function";
};
