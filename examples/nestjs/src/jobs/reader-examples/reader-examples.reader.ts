import {
  createCursorReader,
  createFunctionReader,
  createIterableReader,
  createPagingReader
} from "@nest-batch/core";
import type {
  ChunkStepExecutionContext,
  Reader,
  ReaderSession
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
export class IterableReaderExample implements Reader<ReaderExampleUser> {
  private readonly reader = createIterableReader<ReaderExampleUser>(users);

  open(context: ChunkStepExecutionContext): ReaderSession<ReaderExampleUser> | Promise<ReaderSession<ReaderExampleUser>> {
    return this.reader.open(context);
  }
}

@BatchReader("function-reader-example")
export class FunctionReaderExample implements Reader<ReaderExampleUser> {
  private readonly reader = createFunctionReader<ReaderExampleUser>(async function* ({
    signal
  }) {
    for (const user of users) {
      signal.throwIfAborted();
      yield user;
    }
  });

  open(context: ChunkStepExecutionContext): ReaderSession<ReaderExampleUser> | Promise<ReaderSession<ReaderExampleUser>> {
    return this.reader.open(context);
  }
}

@BatchReader("cursor-reader-example")
export class CursorReaderExample implements Reader<ReaderExampleUser, ReaderExampleCursorCheckpoint> {
  private readonly reader = createCursorReader<
    ReaderExampleUser,
    string,
    ReaderExampleCursorCheckpoint
  >({
    fetch({ cursor, signal }) {
      signal.throwIfAborted();
      const startIndex = cursor ? users.findIndex((user) => user.id === cursor) + 1 : 0;

      return users.slice(startIndex, startIndex + 2);
    },
    getCursor(user) {
      return user.id;
    }
  });

  open(
    context: ChunkStepExecutionContext<ReaderExampleCursorCheckpoint>
  ): ReaderSession<ReaderExampleUser, ReaderExampleCursorCheckpoint> | Promise<ReaderSession<ReaderExampleUser, ReaderExampleCursorCheckpoint>> {
    return this.reader.open(context);
  }
}

@BatchReader("page-reader-example")
export class PageReaderExample implements Reader<ReaderExampleUser, ReaderExamplePageCheckpoint> {
  private readonly reader = createPagingReader<
    ReaderExampleUser,
    ReaderExamplePageCheckpoint
  >({
    pageSize: 2,
    fetch({ page, pageSize, signal }) {
      signal.throwIfAborted();
      const startIndex = page * pageSize;

      return users.slice(startIndex, startIndex + pageSize);
    }
  });

  open(
    context: ChunkStepExecutionContext<ReaderExamplePageCheckpoint>
  ): ReaderSession<ReaderExampleUser, ReaderExamplePageCheckpoint> | Promise<ReaderSession<ReaderExampleUser, ReaderExamplePageCheckpoint>> {
    return this.reader.open(context);
  }
}
