import {
  createCursorReader,
  createFunctionReader,
  createIterableReader,
  createPagingReader
} from "@nest-batch/core";
import type {
  CursorReader,
  FunctionReader,
  IterableReader,
  PageReader
} from "@nest-batch/core";

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

export const iterableReaderExample: IterableReader<ReaderExampleUser> =
  createIterableReader<ReaderExampleUser>(users);

export const functionReaderExample: FunctionReader<ReaderExampleUser> =
  createFunctionReader<ReaderExampleUser>(async function* ({ signal }) {
    for (const user of users) {
      signal.throwIfAborted();
      yield user;
    }
  });

export const cursorReaderExample: CursorReader<
  ReaderExampleUser,
  string,
  ReaderExampleCursorCheckpoint
> = createCursorReader<ReaderExampleUser, string, ReaderExampleCursorCheckpoint>({
  fetch({ cursor, signal }) {
    signal.throwIfAborted();
    const startIndex = cursor ? users.findIndex((user) => user.id === cursor) + 1 : 0;

    return users.slice(startIndex, startIndex + 2);
  },
  getCursor(user) {
    return user.id;
  }
});

export const pageReaderExample: PageReader<
  ReaderExampleUser,
  ReaderExamplePageCheckpoint
> = createPagingReader<ReaderExampleUser, ReaderExamplePageCheckpoint>({
  pageSize: 2,
  fetch({ page, pageSize, signal }) {
    signal.throwIfAborted();
    const startIndex = page * pageSize;

    return users.slice(startIndex, startIndex + pageSize);
  }
});

export const readerExamples = {
  iterable: iterableReaderExample,
  function: functionReaderExample,
  cursor: cursorReaderExample,
  page: pageReaderExample
};
