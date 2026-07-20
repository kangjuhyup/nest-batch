# Reader 예제

`@nest-batch/core`의 chunk step reader는 실행마다 `ReaderSession`을 엽니다.
Nest provider는 singleton으로 재사용될 수 있으므로 cursor, page, offset 같은
실행 상태는 reader instance field가 아니라 session 안에 둡니다.

일반 사용자는 `createIterableReader()` 같은 factory helper를 직접 호출하지 않고,
`kind` 기반 reader definition을 `defineChunkStep()`이나 `openReader()`에 넘깁니다.
core는 이 definition을 실행 시점에 `Reader`로 변환합니다.

`ReaderSession.checkpoint()` 값은 writer가 성공한 chunk boundary 이후 저장됩니다.
step-level `checkpoint()` callback을 따로 정의하면 그 값이
`ReaderSession.checkpoint()`보다 우선합니다.

## Iterable Reader

작은 고정 목록이나 테스트 fixture처럼 전체 item이 이미 준비된 경우 사용합니다.

```ts
import { defineChunkStep } from "@nest-batch/core";
import type { IterableReaderDefinition, Writer } from "@nest-batch/core";

interface SourceUser {
  readonly id: string;
  readonly active: boolean;
}

const reader: IterableReaderDefinition<SourceUser> = {
  kind: "iterable",
  source: [
    { id: "user-1", active: true },
    { id: "user-2", active: false }
  ]
};

const writer: Writer<SourceUser> = {
  write(users) {
    console.log(users);
  }
};

export const importUsersStep = defineChunkStep({
  name: "import-users",
  chunkSize: 100,
  reader,
  writer
});
```

실행 context를 보고 source를 만들 수도 있습니다.

```ts
import type { IterableReaderDefinition } from "@nest-batch/core";

interface UserCheckpoint {
  readonly start?: number;
}

const reader: IterableReaderDefinition<number, UserCheckpoint> = {
  kind: "iterable",
  source({ checkpoint }) {
    const start = checkpoint?.start ?? 0;
    return [start, start + 1, start + 2];
  }
};
```

## Function Reader

간단한 generator 함수나 외부 source를 reader로 감쌀 때 사용합니다. 직접
`ReaderSession`을 반환하면 `close()`나 `checkpoint()`도 사용할 수 있습니다.

```ts
import type { FunctionReaderDefinition } from "@nest-batch/core";

interface SourceUser {
  readonly id: string;
}

interface UserCheckpoint {
  readonly cursor?: string;
}

const reader: FunctionReaderDefinition<SourceUser, UserCheckpoint> = {
  kind: "function",
  async *read({ checkpoint, signal }) {
    const users = await fetchUsersAfter(checkpoint?.cursor);

    for (const user of users) {
      signal.throwIfAborted();
      yield user;
    }
  }
};
```

resource 정리가 필요하면 session을 반환합니다.

```ts
import type { FunctionReaderDefinition } from "@nest-batch/core";

interface LogRow {
  readonly id: string;
  readonly message: string;
}

const reader: FunctionReaderDefinition<LogRow> = {
  kind: "function",
  async read({ signal }) {
    const connection = await openLogConnection();

    return {
      async *[Symbol.asyncIterator]() {
        for await (const row of connection.streamRows()) {
          signal.throwIfAborted();
          yield row;
        }
      },
      async close() {
        await connection.close();
      }
    };
  }
};
```

## Cursor Reader

id, timestamp, sequence 같은 안정적인 cursor로 다음 batch를 조회할 때 사용합니다.
mutable data나 중간 삽입이 있는 source는 page 기반 reader보다 cursor 기반 reader가
재시작에 유리합니다.

```ts
import type { CursorReaderDefinition } from "@nest-batch/core";

interface SourceUser {
  readonly id: string;
  readonly email: string;
}

interface UserCursorCheckpoint {
  readonly cursor?: string;
}

const reader: CursorReaderDefinition<SourceUser, string, UserCursorCheckpoint> = {
  kind: "cursor",
  async fetch({ cursor, signal }) {
    signal.throwIfAborted();

    return fetchUsers({
      afterId: cursor,
      limit: 100,
      orderBy: "id"
    });
  },
  getCursor(user) {
    return user.id;
  }
};
```

`fetch()`가 빈 배열을 반환하면 reader가 종료됩니다. `checkpoint()`는 마지막으로
yield된 item의 cursor를 `{ cursor }` 형태로 반환합니다.

## Page Reader

page 번호와 page 안의 offset으로 재시작 위치를 저장하는 reader입니다.

```ts
import type { PageReaderDefinition } from "@nest-batch/core";

interface Invoice {
  readonly id: string;
  readonly amount: number;
}

interface InvoicePageCheckpoint {
  readonly page: number;
  readonly offset?: number;
}

const reader: PageReaderDefinition<Invoice, InvoicePageCheckpoint> = {
  kind: "page",
  pageSize: 100,
  async fetch({ page, pageSize, signal }) {
    signal.throwIfAborted();

    return fetchInvoices({
      page,
      pageSize,
      orderBy: "id"
    });
  }
};
```

checkpoint는 zero-based `{ page, offset }`입니다. 예를 들어 page 0에서 첫 item을
성공적으로 쓴 뒤에는 `{ page: 0, offset: 1 }`, page 0의 마지막 item까지 처리한 뒤
다음 page로 넘어갈 수 있으면 `{ page: 1, offset: 0 }`이 됩니다.

page 기반 reader는 source ordering이 실행 중 바뀌면 중복이나 누락 위험이 있습니다.
운영 데이터처럼 삽입/삭제가 계속되는 source에는 안정적인 cursor를 사용하는
`CursorReaderDefinition`을 우선 고려합니다.

## Custom Reader Class

Nest provider나 class 기반 reader가 필요하면 `Reader.open()`에서 session을 새로
만듭니다. 실행 상태는 class field가 아니라 closure 또는 session object 안에 둡니다.
실제 Nest provider 예제는 `examples/nestjs/src/jobs/reader-examples`에 있습니다.

```ts
import type { ChunkStepExecutionContext, Reader, ReaderSession } from "@nest-batch/core";

interface SourceUser {
  readonly id: string;
}

interface UserCheckpoint {
  readonly cursor?: string;
}

export class UserReader implements Reader<SourceUser, UserCheckpoint> {
  open({ checkpoint, signal }: ChunkStepExecutionContext<UserCheckpoint>): ReaderSession<SourceUser, UserCheckpoint> {
    let cursor = checkpoint?.cursor;

    return {
      async *[Symbol.asyncIterator]() {
        for await (const user of streamUsersAfter(cursor)) {
          signal.throwIfAborted();
          cursor = user.id;
          yield user;
        }
      },
      checkpoint() {
        return cursor ? { cursor } : undefined;
      }
    };
  }
}
```

기존 `read(context)` 기반 reader는 migration 동안 계속 동작하지만, restart 가능한
reader와 Nest provider reader는 `open() -> ReaderSession` 구조를 권장합니다.
