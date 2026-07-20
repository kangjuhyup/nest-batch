import type { ChunkStepExecutionContext } from "../types/step.js";
import type { Reader, ReaderSession } from "./reader.js";

export interface FileReaderCheckpoint {
  readonly offset?: number;
}

export interface FileReaderOpenContext<TCheckpoint extends FileReaderCheckpoint>
  extends ChunkStepExecutionContext<TCheckpoint> {
  readonly offset: number;
}

export type FileReaderSource<Item, TCheckpoint extends FileReaderCheckpoint> =
  | AsyncIterable<Item>
  | Iterable<Item>
  | ReaderSession<Item, TCheckpoint>;

export interface FileReaderOptions<
  Item,
  TCheckpoint extends FileReaderCheckpoint = FileReaderCheckpoint
> {
  readonly startsAtOffset?: boolean;
  readonly open: (
    context: FileReaderOpenContext<TCheckpoint>
  ) => FileReaderSource<Item, TCheckpoint> | Promise<FileReaderSource<Item, TCheckpoint>>;
}

export interface FileReader<
  Item,
  TCheckpoint extends FileReaderCheckpoint = FileReaderCheckpoint
> extends Reader<Item, TCheckpoint> {}

export interface FileReaderDefinition<
  Item,
  TCheckpoint extends FileReaderCheckpoint = FileReaderCheckpoint
> extends FileReaderOptions<Item, TCheckpoint> {
  readonly kind: "file";
}

export const createFileReader = <
  Item,
  TCheckpoint extends FileReaderCheckpoint = FileReaderCheckpoint
>(
  options: FileReaderOptions<Item, TCheckpoint>
): FileReader<Item, TCheckpoint> => ({
  async open(context) {
    const startOffset = context.checkpoint?.offset ?? 0;
    validateNonNegativeInteger(startOffset, "checkpoint.offset");
    const source = await options.open({
      signal: context.signal,
      checkpoint: context.checkpoint,
      offset: startOffset
    });
    let currentCheckpoint: TCheckpoint | undefined = context.checkpoint;

    return {
      async *[Symbol.asyncIterator]() {
        let index = options.startsAtOffset === true ? startOffset : 0;

        for await (const item of toAsyncIterable(source)) {
          context.signal.throwIfAborted();

          if (options.startsAtOffset !== true && index < startOffset) {
            index += 1;
            continue;
          }

          index += 1;
          currentCheckpoint = withCheckpoint(context.checkpoint, { offset: index });
          yield item;
        }
      },
      checkpoint() {
        return currentCheckpoint;
      },
      async close() {
        if (hasClose(source)) {
          await source.close();
        }
      }
    } satisfies ReaderSession<Item, TCheckpoint>;
  }
});

const toAsyncIterable = async function* <Item, TCheckpoint extends FileReaderCheckpoint>(
  source: FileReaderSource<Item, TCheckpoint>
): AsyncIterable<Item> {
  if (typeof (source as AsyncIterable<Item>)[Symbol.asyncIterator] === "function") {
    for await (const item of source as AsyncIterable<Item>) {
      yield item;
    }
    return;
  }

  for (const item of source as Iterable<Item>) {
    yield item;
  }
};

const validateNonNegativeInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`File reader ${name} must be a non-negative safe integer.`);
  }
};

const hasClose = <Item, TCheckpoint extends FileReaderCheckpoint>(
  source: FileReaderSource<Item, TCheckpoint>
): source is ReaderSession<Item, TCheckpoint> & { close(): void | Promise<void> } => {
  return typeof source === "object" && source !== null && "close" in source && typeof source.close === "function";
};

const withCheckpoint = <TCheckpoint extends FileReaderCheckpoint>(
  checkpoint: TCheckpoint | undefined,
  next: { readonly offset: number }
): TCheckpoint => {
  return {
    ...(checkpoint ?? {}),
    ...next
  } as TCheckpoint;
};
