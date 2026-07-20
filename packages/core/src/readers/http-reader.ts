import type { ChunkStepExecutionContext } from "../types/step.js";
import type { Reader, ReaderSession } from "./reader.js";

export interface HttpReaderCheckpoint<Page = unknown> {
  readonly page?: Page;
  readonly offset?: number;
}

export interface HttpReaderRequestContext<
  Page,
  TCheckpoint extends HttpReaderCheckpoint<Page>
> extends ChunkStepExecutionContext<TCheckpoint> {
  readonly page?: Page;
  readonly pageSize: number;
}

export interface HttpReaderResponse<Item, Page = unknown> {
  readonly items: readonly Item[];
  readonly nextPage?: Page;
}

export interface HttpReaderOptions<
  Item,
  Page = unknown,
  TCheckpoint extends HttpReaderCheckpoint<Page> = HttpReaderCheckpoint<Page>
> {
  readonly pageSize: number;
  readonly initialPage?: Page;
  readonly request: (
    context: HttpReaderRequestContext<Page, TCheckpoint>
  ) => HttpReaderResponse<Item, Page> | Promise<HttpReaderResponse<Item, Page>>;
}

export interface HttpReader<
  Item,
  Page = unknown,
  TCheckpoint extends HttpReaderCheckpoint<Page> = HttpReaderCheckpoint<Page>
> extends Reader<Item, TCheckpoint> {}

export interface HttpReaderDefinition<
  Item,
  Page = unknown,
  TCheckpoint extends HttpReaderCheckpoint<Page> = HttpReaderCheckpoint<Page>
> extends HttpReaderOptions<Item, Page, TCheckpoint> {
  readonly kind: "http";
}

export const createHttpReader = <
  Item,
  Page = unknown,
  TCheckpoint extends HttpReaderCheckpoint<Page> = HttpReaderCheckpoint<Page>
>(
  options: HttpReaderOptions<Item, Page, TCheckpoint>
): HttpReader<Item, Page, TCheckpoint> => {
  validatePositiveInteger(options.pageSize, "pageSize");

  return {
    open(context) {
      let page = context.checkpoint?.page ?? options.initialPage;
      let offset = context.checkpoint?.offset ?? 0;
      validateNonNegativeInteger(offset, "checkpoint.offset");
      let currentCheckpoint: TCheckpoint | undefined = context.checkpoint;

      return {
        async *[Symbol.asyncIterator]() {
          while (true) {
            context.signal.throwIfAborted();
            const response = await options.request({
              signal: context.signal,
              checkpoint: context.checkpoint,
              page,
              pageSize: options.pageSize
            });

            if (response.items.length === 0) {
              return;
            }

            if (offset >= response.items.length) {
              if (response.nextPage === undefined) {
                return;
              }

              page = response.nextPage;
              offset = 0;
              currentCheckpoint = withCheckpoint(context.checkpoint, { page, offset });
              continue;
            }

            for (let index = offset; index < response.items.length; index += 1) {
              context.signal.throwIfAborted();
              offset = index + 1;

              if (offset >= response.items.length && response.nextPage !== undefined) {
                page = response.nextPage;
                offset = 0;
              }

              currentCheckpoint = withCheckpoint(context.checkpoint, { page, offset });
              yield response.items[index] as Item;
            }

            if (response.nextPage === undefined) {
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
    throw new TypeError(`HTTP reader ${name} must be a positive safe integer.`);
  }
};

const validateNonNegativeInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`HTTP reader ${name} must be a non-negative safe integer.`);
  }
};

const withCheckpoint = <Page, TCheckpoint extends HttpReaderCheckpoint<Page>>(
  checkpoint: TCheckpoint | undefined,
  next: { readonly page?: Page; readonly offset: number }
): TCheckpoint => {
  const merged: { page?: Page; offset?: number } = {
    ...(checkpoint ?? {}),
    offset: next.offset
  };

  if (next.page !== undefined) {
    merged.page = next.page;
  } else {
    delete merged.page;
  }

  return merged as TCheckpoint;
};
