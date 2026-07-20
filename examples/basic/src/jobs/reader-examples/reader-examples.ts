import { createJsonlFileReader, createLineFileReader } from "@nest-batch/core";
import type {
  CursorReaderDefinition,
  FileReaderDefinition,
  FunctionReaderDefinition,
  HttpReaderDefinition,
  IterableReaderDefinition,
  PageReaderDefinition,
  SqlReaderDefinition
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

export interface ReaderExampleHttpCheckpoint {
  readonly page?: number;
  readonly offset?: number;
}

export interface ReaderExampleFileCheckpoint {
  readonly offset?: number;
}

const users: readonly ReaderExampleUser[] = [
  { id: "user-1", email: "user-1@example.com" },
  { id: "user-2", email: "user-2@example.com" },
  { id: "user-3", email: "user-3@example.com" },
  { id: "user-4", email: "user-4@example.com" }
];

export const iterableReaderExample: IterableReaderDefinition<ReaderExampleUser> = {
  kind: "iterable",
  source: users
};

export const functionReaderExample: FunctionReaderDefinition<ReaderExampleUser> = {
  kind: "function",
  async *read({ signal }) {
    for (const user of users) {
      signal.throwIfAborted();
      yield user;
    }
  }
};

export const cursorReaderExample: CursorReaderDefinition<
  ReaderExampleUser,
  string,
  ReaderExampleCursorCheckpoint
> = {
  kind: "cursor",
  fetch({ cursor, signal }) {
    signal.throwIfAborted();
    const startIndex = cursor ? users.findIndex((user) => user.id === cursor) + 1 : 0;

    return users.slice(startIndex, startIndex + 2);
  },
  getCursor(user) {
    return user.id;
  }
};

export const pageReaderExample: PageReaderDefinition<
  ReaderExampleUser,
  ReaderExamplePageCheckpoint
> = {
  kind: "page",
  pageSize: 2,
  fetch({ page, pageSize, signal }) {
    signal.throwIfAborted();
    const startIndex = page * pageSize;

    return users.slice(startIndex, startIndex + pageSize);
  }
};

export const sqlReaderExample: SqlReaderDefinition<
  ReaderExampleUser,
  ReaderExamplePageCheckpoint
> = {
  kind: "sql",
  pageSize: 2,
  query({ offset, pageSize, signal }) {
    signal.throwIfAborted();

    return users.slice(offset, offset + pageSize);
  }
};

export const httpReaderExample: HttpReaderDefinition<
  ReaderExampleUser,
  number,
  ReaderExampleHttpCheckpoint
> = {
  kind: "http",
  pageSize: 2,
  initialPage: 0,
  request({ page = 0, pageSize, signal }) {
    signal.throwIfAborted();
    const startIndex = page * pageSize;
    const items = users.slice(startIndex, startIndex + pageSize);
    const nextPage = startIndex + pageSize < users.length ? page + 1 : undefined;

    return nextPage === undefined ? { items } : { items, nextPage };
  }
};

export const fileReaderExample: FileReaderDefinition<
  ReaderExampleUser,
  ReaderExampleFileCheckpoint
> = {
  kind: "file",
  async *open({ signal }) {
    for (const user of users) {
      signal.throwIfAborted();
      yield user;
    }
  }
};

export const lineFileReaderExample = createLineFileReader<ReaderExampleUser>({
  lines: users.map((user) => `${user.id},${user.email}`),
  map(line) {
    const [id, email] = line.split(",");

    return {
      id: id ?? "",
      email: email ?? ""
    };
  }
});

export const jsonlFileReaderExample = createJsonlFileReader<ReaderExampleUser>({
  lines: users.map((user) => JSON.stringify(user))
});

export const readerExamples = {
  iterable: iterableReaderExample,
  function: functionReaderExample,
  cursor: cursorReaderExample,
  page: pageReaderExample,
  sql: sqlReaderExample,
  http: httpReaderExample,
  file: fileReaderExample,
  lineFile: lineFileReaderExample,
  jsonlFile: jsonlFileReaderExample
};
