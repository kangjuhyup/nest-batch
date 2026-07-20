import type {
  CursorReaderDefinition,
  CursorReaderFetchContext,
  FunctionReaderDefinition,
  IterableReaderDefinition,
  PageReaderDefinition,
  PagingReaderFetchContext
} from "@nest-batch/core";
import { BatchReader } from "@nest-batch/nest";

export interface ReaderExampleUser {
  readonly id: string;
  readonly email: string;
}

export interface ReaderExampleCursorCheckpoint {
  readonly cursor?: string;
}

export interface ReaderExamplePageCheckpoint {
  readonly page: number;
  readonly offset?: number;
}

const users: readonly ReaderExampleUser[] = [
  { id: "user-1", email: "user-1@example.com" },
  { id: "user-2", email: "user-2@example.com" },
  { id: "user-3", email: "user-3@example.com" },
  { id: "user-4", email: "user-4@example.com" }
];

@BatchReader("iterable-reader-example")
export class IterableReaderExample implements IterableReaderDefinition<ReaderExampleUser> {
  readonly kind = "iterable";
  readonly source = users;
}

@BatchReader("function-reader-example")
export class FunctionReaderExample implements FunctionReaderDefinition<ReaderExampleUser> {
  readonly kind = "function";

  async *read({ signal }: Parameters<FunctionReaderDefinition<ReaderExampleUser>["read"]>[0]) {
    for (const user of users) {
      signal.throwIfAborted();
      yield user;
    }
  }
}

@BatchReader("cursor-reader-example")
export class CursorReaderExample implements CursorReaderDefinition<
  ReaderExampleUser,
  string,
  ReaderExampleCursorCheckpoint
> {
  readonly kind = "cursor";

  fetch({ cursor, signal }: CursorReaderFetchContext<string, ReaderExampleCursorCheckpoint>) {
    signal.throwIfAborted();
    const startIndex = cursor ? users.findIndex((user) => user.id === cursor) + 1 : 0;

    return users.slice(startIndex, startIndex + 2);
  }

  getCursor(user: ReaderExampleUser) {
    return user.id;
  }
}

@BatchReader("page-reader-example")
export class PageReaderExample implements PageReaderDefinition<
  ReaderExampleUser,
  ReaderExamplePageCheckpoint
> {
  readonly kind = "page";
  readonly pageSize = 2;

  fetch({ page, pageSize, signal }: PagingReaderFetchContext<ReaderExamplePageCheckpoint>) {
    signal.throwIfAborted();
    const startIndex = page * pageSize;

    return users.slice(startIndex, startIndex + pageSize);
  }
}
