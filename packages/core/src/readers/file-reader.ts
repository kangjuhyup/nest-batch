import { createReadStream } from "node:fs";
import type { PathLike } from "node:fs";
import { createInterface } from "node:readline/promises";
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

export interface LineFileReaderMapContext<TCheckpoint extends FileReaderCheckpoint>
  extends FileReaderOpenContext<TCheckpoint> {
  readonly lineNumber: number;
}

export type LineFileReaderSource =
  | AsyncIterable<string>
  | Iterable<string>;

export interface LineFileReaderOptions<
  Item = string,
  TCheckpoint extends FileReaderCheckpoint = FileReaderCheckpoint
> {
  readonly path?: PathLike;
  readonly lines?: LineFileReaderSource;
  readonly encoding?: BufferEncoding;
  readonly map?: (
    line: string,
    context: LineFileReaderMapContext<TCheckpoint>
  ) => Item | Promise<Item>;
}

export interface JsonlFileReaderParseContext<TCheckpoint extends FileReaderCheckpoint>
  extends LineFileReaderMapContext<TCheckpoint> {
  readonly line: string;
}

export interface JsonlFileReaderOptions<
  Item,
  TCheckpoint extends FileReaderCheckpoint = FileReaderCheckpoint
> extends Omit<LineFileReaderOptions<Item, TCheckpoint>, "map"> {
  readonly parse?: (
    value: unknown,
    context: JsonlFileReaderParseContext<TCheckpoint>
  ) => Item | Promise<Item>;
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
        if (hasFileSourceClose(source)) {
          await source.close();
        }
      }
    } satisfies ReaderSession<Item, TCheckpoint>;
  }
});

export const createLineFileReader = <
  Item = string,
  TCheckpoint extends FileReaderCheckpoint = FileReaderCheckpoint
>(
  options: LineFileReaderOptions<Item, TCheckpoint>
): FileReader<Item, TCheckpoint> =>
  createFileReader<Item, TCheckpoint>({
    startsAtOffset: true,
    open(context) {
      const source = openLineSource(options);

      return {
        async *[Symbol.asyncIterator]() {
          let index = 0;

          for await (const line of toAsyncIterable(source.lines)) {
            context.signal.throwIfAborted();

            if (index < context.offset) {
              index += 1;
              continue;
            }

            const lineNumber = index + 1;
            index += 1;
            yield options.map
              ? await options.map(line, { ...context, lineNumber })
              : (line as Item);
          }
        },
        close() {
          return source.close();
        }
      };
    }
  });

export const createJsonlFileReader = <
  Item,
  TCheckpoint extends FileReaderCheckpoint = FileReaderCheckpoint
>(
  options: JsonlFileReaderOptions<Item, TCheckpoint>
): FileReader<Item, TCheckpoint> =>
  createLineFileReader<Item, TCheckpoint>({
    ...options,
    map(line, context) {
      const value = JSON.parse(line) as unknown;

      return options.parse
        ? options.parse(value, { ...context, line })
        : (value as Item);
    }
  });

const openLineSource = <Item, TCheckpoint extends FileReaderCheckpoint>(
  options: LineFileReaderOptions<Item, TCheckpoint>
): { readonly lines: LineFileReaderSource; readonly close: () => void | Promise<void> } => {
  if (options.path !== undefined && options.lines !== undefined) {
    throw new TypeError("Line file reader options must not include both path and lines.");
  }

  if (options.path !== undefined) {
    const stream = createReadStream(options.path, {
      encoding: options.encoding ?? "utf8"
    });
    const lines = createInterface({
      input: stream,
      crlfDelay: Infinity
    });

    return {
      lines,
      close() {
        lines.close();
        stream.destroy();
      }
    };
  }

  if (options.lines !== undefined) {
    const lines = options.lines;

    return {
      lines,
      close() {
        if (hasLineSourceClose(lines)) {
          return lines.close();
        }
      }
    };
  }

  throw new TypeError("Line file reader options must include path or lines.");
};

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

const hasFileSourceClose = <Item, TCheckpoint extends FileReaderCheckpoint>(
  source: FileReaderSource<Item, TCheckpoint>
): source is ReaderSession<Item, TCheckpoint> & { close(): void | Promise<void> } => {
  return typeof source === "object" && source !== null && "close" in source && typeof source.close === "function";
};

const hasLineSourceClose = (
  source: LineFileReaderSource
): source is LineFileReaderSource & { close(): void | Promise<void> } => {
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
