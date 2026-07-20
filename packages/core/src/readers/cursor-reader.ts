import type { ChunkStepExecutionContext } from "../types/step.js";
import type { Reader, ReaderSession } from "./reader.js";

export interface CursorReaderCheckpoint<Cursor> {
  readonly cursor?: Cursor;
}

export interface CursorReaderFetchContext<Cursor, TCheckpoint extends CursorReaderCheckpoint<Cursor>>
  extends ChunkStepExecutionContext<TCheckpoint> {
  readonly cursor?: Cursor;
}

export interface CursorReaderOptions<
  Item,
  Cursor,
  TCheckpoint extends CursorReaderCheckpoint<Cursor> = CursorReaderCheckpoint<Cursor>
> {
  readonly fetch: (
    context: CursorReaderFetchContext<Cursor, TCheckpoint>
  ) => readonly Item[] | Promise<readonly Item[]>;
  readonly getCursor: (item: Item) => Cursor;
}

export interface CursorReader<
  Item,
  Cursor,
  TCheckpoint extends CursorReaderCheckpoint<Cursor> = CursorReaderCheckpoint<Cursor>
> extends Reader<Item, TCheckpoint> {}

export interface CursorReaderDefinition<
  Item,
  Cursor,
  TCheckpoint extends CursorReaderCheckpoint<Cursor> = CursorReaderCheckpoint<Cursor>
> extends CursorReaderOptions<Item, Cursor, TCheckpoint> {
  readonly kind: "cursor";
}

export const createCursorReader = <
  Item,
  Cursor,
  TCheckpoint extends CursorReaderCheckpoint<Cursor> = CursorReaderCheckpoint<Cursor>
>(
  options: CursorReaderOptions<Item, Cursor, TCheckpoint>
): CursorReader<Item, Cursor, TCheckpoint> => ({
  open(context) {
    let currentCursor = context.checkpoint?.cursor;
    let currentCheckpoint: TCheckpoint | undefined = context.checkpoint;

    return {
      async *[Symbol.asyncIterator]() {
        while (true) {
          context.signal.throwIfAborted();
          const items = await options.fetch({
            signal: context.signal,
            checkpoint: context.checkpoint,
            cursor: currentCursor
          });

          if (items.length === 0) {
            return;
          }

          for (const item of items) {
            context.signal.throwIfAborted();
            currentCursor = options.getCursor(item);
            currentCheckpoint = withCheckpoint(context.checkpoint, { cursor: currentCursor });
            yield item;
          }
        }
      },
      checkpoint() {
        return currentCheckpoint;
      }
    } satisfies ReaderSession<Item, TCheckpoint>;
  }
});

const withCheckpoint = <TCheckpoint extends object>(
  checkpoint: TCheckpoint | undefined,
  next: object
): TCheckpoint => {
  return {
    ...(checkpoint ?? {}),
    ...next
  } as TCheckpoint;
};
