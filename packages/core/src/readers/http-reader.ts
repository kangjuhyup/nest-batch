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

export interface JsonHttpReaderResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText?: string;
  json(): unknown | Promise<unknown>;
}

export interface JsonHttpReaderBodyContext<
  Page,
  TCheckpoint extends HttpReaderCheckpoint<Page>
> extends HttpReaderRequestContext<Page, TCheckpoint> {
  readonly response: JsonHttpReaderResponse;
}

export interface JsonHttpReaderOptions<
  Item,
  Page = unknown,
  Body = unknown,
  TCheckpoint extends HttpReaderCheckpoint<Page> = HttpReaderCheckpoint<Page>
> {
  readonly pageSize: number;
  readonly initialPage?: Page;
  readonly request: (
    context: HttpReaderRequestContext<Page, TCheckpoint>
  ) => JsonHttpReaderResponse | Promise<JsonHttpReaderResponse>;
  readonly selectItems: (
    body: Body,
    context: JsonHttpReaderBodyContext<Page, TCheckpoint>
  ) => readonly Item[] | Promise<readonly Item[]>;
  readonly selectNextPage?: (
    body: Body,
    context: JsonHttpReaderBodyContext<Page, TCheckpoint>
  ) => Page | undefined | Promise<Page | undefined>;
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
              ...context,
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

export const createJsonHttpReader = <
  Item,
  Page = unknown,
  Body = unknown,
  TCheckpoint extends HttpReaderCheckpoint<Page> = HttpReaderCheckpoint<Page>
>(
  options: JsonHttpReaderOptions<Item, Page, Body, TCheckpoint>
): HttpReader<Item, Page, TCheckpoint> =>
  createHttpReader<Item, Page, TCheckpoint>({
    pageSize: options.pageSize,
    initialPage: options.initialPage,
    async request(context) {
      const response = await options.request(context);

      if (!response.ok) {
        throw new Error(formatHttpStatusFailure(response));
      }

      const body = await response.json() as Body;
      const bodyContext = { ...context, response };
      const items = await options.selectItems(body, bodyContext);
      const nextPage = await options.selectNextPage?.(body, bodyContext);

      return nextPage === undefined ? { items } : { items, nextPage };
    }
  });

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

const formatHttpStatusFailure = (response: JsonHttpReaderResponse): string => {
  const statusText = response.statusText ? ` ${response.statusText}` : "";

  return `HTTP reader request failed with status ${response.status}${statusText}.`;
};
