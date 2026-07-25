import type { ChunkStepExecutionContext } from "../types/step.js";
import type { Reader, ReaderSession } from "./reader.js";

export interface PagingReaderCheckpoint {
  readonly page: number;
  readonly offset?: number;
}

export interface PagingReaderFetchContext<TCheckpoint extends PagingReaderCheckpoint>
  extends ChunkStepExecutionContext<TCheckpoint> {
  readonly page: number;
  readonly pageSize: number;
}

export interface PagingReaderOptions<
  Item,
  TCheckpoint extends PagingReaderCheckpoint = PagingReaderCheckpoint
> {
  readonly pageSize: number;
  readonly initialPage?: number;
  readonly fetch: (
    context: PagingReaderFetchContext<TCheckpoint>
  ) => readonly Item[] | Promise<readonly Item[]>;
}

export interface PagingReader<
  Item,
  TCheckpoint extends PagingReaderCheckpoint = PagingReaderCheckpoint
> extends Reader<Item, TCheckpoint> {}

export interface PageReader<
  Item,
  TCheckpoint extends PagingReaderCheckpoint = PagingReaderCheckpoint
> extends PagingReader<Item, TCheckpoint> {}

export interface PagingReaderDefinition<
  Item,
  TCheckpoint extends PagingReaderCheckpoint = PagingReaderCheckpoint
> extends PagingReaderOptions<Item, TCheckpoint> {
  readonly kind: "paging";
}

export interface PageReaderDefinition<
  Item,
  TCheckpoint extends PagingReaderCheckpoint = PagingReaderCheckpoint
> extends PagingReaderOptions<Item, TCheckpoint> {
  readonly kind: "page";
}

export const createPagingReader = <
  Item,
  TCheckpoint extends PagingReaderCheckpoint = PagingReaderCheckpoint
>(
  options: PagingReaderOptions<Item, TCheckpoint>
): PagingReader<Item, TCheckpoint> => {
  validatePositiveInteger(options.pageSize, "pageSize");
  const initialPage = options.initialPage ?? 0;
  validateNonNegativeInteger(initialPage, "initialPage");

  return {
    open(context) {
      let page = context.checkpoint?.page ?? initialPage;
      let offset = context.checkpoint?.offset ?? 0;
      validateNonNegativeInteger(page, "checkpoint.page");
      validateNonNegativeInteger(offset, "checkpoint.offset");
      let currentCheckpoint: TCheckpoint | undefined = context.checkpoint;

      return {
        async *[Symbol.asyncIterator]() {
          while (true) {
            context.signal.throwIfAborted();
            const items = await options.fetch({
              ...context,
              page,
              pageSize: options.pageSize
            });

            if (items.length === 0) {
              return;
            }

            if (offset >= items.length) {
              page += 1;
              offset = 0;
              currentCheckpoint = withCheckpoint(context.checkpoint, { page, offset });

              if (items.length < options.pageSize) {
                return;
              }

              continue;
            }

            for (let index = offset; index < items.length; index += 1) {
              context.signal.throwIfAborted();
              offset = index + 1;

              if (offset >= items.length) {
                page += 1;
                offset = 0;
              }

              currentCheckpoint = withCheckpoint(context.checkpoint, { page, offset });
              yield items[index] as Item;
            }

            if (items.length < options.pageSize) {
              return;
            }
          }
        },
        checkpoint() {
          return currentCheckpoint;
        }
      } satisfies ReaderSession<Item, TCheckpoint>;
    }
  };
};

const validatePositiveInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`Paging reader ${name} must be a positive safe integer.`);
  }
};

const validateNonNegativeInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Paging reader ${name} must be a non-negative safe integer.`);
  }
};

const withCheckpoint = <TCheckpoint extends object>(
  checkpoint: TCheckpoint | undefined,
  next: object
): TCheckpoint => {
  return {
    ...(checkpoint ?? {}),
    ...next
  } as TCheckpoint;
};
