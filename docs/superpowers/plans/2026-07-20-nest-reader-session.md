# Nest Reader Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nest singleton provider에서도 안전하게 동작하는 execution-scoped `ReaderSession` contract와 기본 reader helper를 추가한다.

**Architecture:** `@nest-batch/core`는 Nest나 ORM을 모르는 reader contract와 generic helper만 제공한다. `@nest-batch/nest`는 기존 `@BatchReader` decorator/provider discovery 흐름을 유지하고, example에서 `open() -> ReaderSession` 패턴을 보여준다. ORM reader, database driver reader, Kafka/file adapter reader는 이번 범위에서 제외한다.

**Tech Stack:** TypeScript `NodeNext`, `AsyncIterable`, Vitest, existing `@nest-batch/core` chunk runner, existing `@nest-batch/nest` decorators.

## Global Constraints

- `@nest-batch/core`는 NestJS, ORM, database driver, queue client에 의존하지 않는다.
- ORM reader는 이번 계획 범위에서 제외한다.
- 기존 `Reader.read(context)` 구현체는 1차 migration 동안 호환한다.
- 새 canonical reader contract는 `open(context) -> ReaderSession`이다.
- mutable cursor/checkpoint state는 Nest provider singleton이 아니라 execution-scoped `ReaderSession`에 둔다.
- reader와 reader session은 `AbortSignal`을 받아 취소 가능해야 한다.
- checkpoint는 writer 성공 이후 chunk boundary에서만 저장한다.
- 테스트 설명은 `English / 한국어` 형식을 사용한다.
- 문서와 설계 설명은 한국어로 작성하고, public API 이름과 타입 이름은 영어를 유지한다.

---

## File Structure

새 파일:

- `packages/core/src/readers/reader.ts`: `ReaderSession`, canonical `Reader`, legacy `read()` reader, `openReader`, `closeReader`, `getReaderCheckpoint` contract/helper.
- `packages/core/src/readers/iterable-reader.ts`: `IterableReader`와 `createIterableReader`.
- `packages/core/src/readers/function-reader.ts`: function/generator 기반 `FunctionReader`와 `createFunctionReader`.
- `packages/core/src/readers/cursor-reader.ts`: cursor checkpoint 기반 generic `CursorReader`.
- `packages/core/src/readers/paging-reader.ts`: page checkpoint 기반 generic `PagingReader`.
- `packages/core/src/readers/index.ts`: reader public exports.
- `packages/core/test/readers.test.ts`: reader helper contract unit tests.

수정 파일:

- `packages/core/src/types/step.ts`: `ChunkStepDefinition.reader`가 새 `ChunkReader` type을 사용하도록 조정.
- `packages/core/src/types/index.ts`: reader type re-export 필요 여부 확인 후 반영.
- `packages/core/src/index.ts`: reader contract/helper public exports 추가.
- `packages/core/src/runner/chunk-step-runner.ts`: `openReader`로 session을 열고, `ReaderSession.checkpoint()`와 `close()`를 처리.
- `packages/core/test/step-runners.test.ts`: session checkpoint, session close, legacy reader compatibility regression test 추가.
- `examples/basic/src/jobs/import-users/import-users.step.ts`: `open()` 기반 reader 예제로 변경.
- `examples/nestjs/src/jobs/billing/billing.step.ts`: Nest provider singleton이 session을 반환하는 예제로 변경.
- `README.md`, `README-kr.md`, `docs/architecture.md`, `examples/basic/README.md`, `examples/nestjs/README.md`: reader session과 Nest singleton 주의점 문서화.

---

### Task 1: Core Reader Contract

**Files:**
- Create: `packages/core/src/readers/reader.ts`
- Create: `packages/core/src/readers/index.ts`
- Modify: `packages/core/src/types/step.ts`
- Modify: `packages/core/src/types/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/readers.test.ts`

**Interfaces:**
- Consumes: `ChunkStepExecutionContext<TCheckpoint>` from `packages/core/src/types/step.ts`.
- Produces:
  - `ReaderSession<Item, TCheckpoint>`
  - `Reader<Item, TCheckpoint>`
  - `LegacyReader<Item, TCheckpoint>`
  - `ChunkReader<Item, TCheckpoint>`
  - `openReader(reader, context): Promise<ReaderSession<Item, TCheckpoint>>`
  - `closeReader(session): Promise<void>`
  - `getReaderCheckpoint(session): Promise<TCheckpoint | undefined>`

- [ ] **Step 1: Write failing reader contract tests**

Create `packages/core/test/readers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  closeReader,
  getReaderCheckpoint,
  openReader,
  type ChunkStepExecutionContext,
  type LegacyReader,
  type Reader,
  type ReaderSession
} from "../src/index.js";

const createContext = <TCheckpoint>(
  checkpoint?: TCheckpoint
): ChunkStepExecutionContext<TCheckpoint> => ({
  signal: new AbortController().signal,
  checkpoint
});

describe("reader contract / reader contract를 검증한다", () => {
  it("opens execution scoped reader sessions / 실행 단위 reader session을 연다", async () => {
    const session: ReaderSession<string, { cursor?: string }> = {
      async *[Symbol.asyncIterator]() {
        yield "a";
        yield "b";
      },
      checkpoint() {
        return { cursor: "b" };
      }
    };
    const reader: Reader<string, { cursor?: string }> = {
      open(context) {
        expect(context.checkpoint).toEqual({ cursor: "a" });
        return session;
      }
    };

    const opened = await openReader(reader, createContext({ cursor: "a" }));

    const items: string[] = [];
    for await (const item of opened) {
      items.push(item);
    }
    await expect(getReaderCheckpoint(opened)).resolves.toEqual({ cursor: "b" });
    expect(items).toEqual(["a", "b"]);
  });

  it("supports legacy read based readers / 기존 read 기반 reader를 지원한다", async () => {
    const reader: LegacyReader<number> = {
      read() {
        return [1, 2, 3];
      }
    };

    const opened = await openReader(reader, createContext());

    const items: number[] = [];
    for await (const item of opened) {
      items.push(item);
    }
    await expect(getReaderCheckpoint(opened)).resolves.toBeUndefined();
    expect(items).toEqual([1, 2, 3]);
  });

  it("closes sessions when close is present / close가 있으면 reader session을 닫는다", async () => {
    let closed = false;
    const session: ReaderSession<string> = {
      async *[Symbol.asyncIterator]() {
        yield "a";
      },
      close() {
        closed = true;
      }
    };

    await closeReader(session);

    expect(closed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/core/test/readers.test.ts
```

Expected: FAIL because `openReader`, `ReaderSession`, `LegacyReader`, and related exports do not exist.

- [ ] **Step 3: Add reader contract implementation**

Create `packages/core/src/readers/reader.ts`:

```ts
import type { ChunkStepExecutionContext } from "../types/step.js";

export interface ReaderSession<Item, TCheckpoint = unknown> extends AsyncIterable<Item> {
  checkpoint?(): TCheckpoint | undefined | Promise<TCheckpoint | undefined>;
  close?(): void | Promise<void>;
}

export interface Reader<Item, TCheckpoint = unknown> {
  open(
    context: ChunkStepExecutionContext<TCheckpoint>
  ): ReaderSession<Item, TCheckpoint> | Promise<ReaderSession<Item, TCheckpoint>>;
}

export interface LegacyReader<Item, TCheckpoint = unknown> {
  read(context: ChunkStepExecutionContext<TCheckpoint>): AsyncIterable<Item> | Iterable<Item>;
}

export type ChunkReader<Item, TCheckpoint = unknown> =
  | Reader<Item, TCheckpoint>
  | LegacyReader<Item, TCheckpoint>;

export const openReader = async <Item, TCheckpoint = unknown>(
  reader: ChunkReader<Item, TCheckpoint>,
  context: ChunkStepExecutionContext<TCheckpoint>
): Promise<ReaderSession<Item, TCheckpoint>> => {
  if (isSessionReader(reader)) {
    return reader.open(context);
  }

  return createIterableSession(reader.read(context));
};

export const closeReader = async <Item, TCheckpoint = unknown>(
  session: ReaderSession<Item, TCheckpoint>
): Promise<void> => {
  await session.close?.();
};

export const getReaderCheckpoint = async <Item, TCheckpoint = unknown>(
  session: ReaderSession<Item, TCheckpoint>
): Promise<TCheckpoint | undefined> => {
  return session.checkpoint?.();
};

const isSessionReader = <Item, TCheckpoint>(
  reader: ChunkReader<Item, TCheckpoint>
): reader is Reader<Item, TCheckpoint> => {
  return "open" in reader && typeof reader.open === "function";
};

export const createIterableSession = <Item, TCheckpoint = unknown>(
  items: AsyncIterable<Item> | Iterable<Item>
): ReaderSession<Item, TCheckpoint> => ({
  async *[Symbol.asyncIterator]() {
    if (Symbol.asyncIterator in items) {
      for await (const item of items) {
        yield item;
      }
      return;
    }

    for (const item of items) {
      yield item;
    }
  }
});
```

Create `packages/core/src/readers/index.ts`:

```ts
export {
  closeReader,
  createIterableSession,
  getReaderCheckpoint,
  openReader,
  type ChunkReader,
  type LegacyReader,
  type Reader,
  type ReaderSession
} from "./reader.js";
```

Modify `packages/core/src/types/step.ts`:

```ts
import type { SkipItem } from "../skip-item.js";
import type { BatchExecutionId } from "./common.js";
import type { ChunkReader } from "../readers/reader.js";
```

Remove the old `Reader` interface and old `ChunkReader` alias from `packages/core/src/types/step.ts`. Keep `Processor`, `Writer`, and context types in `step.ts`.

Modify `packages/core/src/types/index.ts`:

```ts
export { DatabaseBatchStorage } from "./storage.js";
export type * from "./common.js";
export type * from "./execution.js";
export type * from "./job.js";
export type * from "./lock.js";
export type * from "./repository.js";
export type * from "./runner.js";
export type * from "./step.js";
```

Modify `packages/core/src/index.ts` to export reader contracts:

```ts
export {
  closeReader,
  createIterableSession,
  getReaderCheckpoint,
  openReader
} from "./readers/index.js";
export type { ChunkReader, LegacyReader, Reader, ReaderSession } from "./readers/index.js";
```

- [ ] **Step 4: Run reader contract test**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/core/test/readers.test.ts
```

Expected: PASS with 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/readers packages/core/src/types/step.ts packages/core/src/types/index.ts packages/core/src/index.ts packages/core/test/readers.test.ts
git commit -m "feat : reader session contract 추가" \
  -m "- 실행 단위 ReaderSession contract를 추가" \
  -m "- 기존 read 기반 reader 호환 helper를 추가"
```

---

### Task 2: Iterable And Function Reader Helpers

**Files:**
- Create: `packages/core/src/readers/iterable-reader.ts`
- Create: `packages/core/src/readers/function-reader.ts`
- Modify: `packages/core/src/readers/index.ts`
- Test: `packages/core/test/readers.test.ts`

**Interfaces:**
- Consumes: `Reader`, `ReaderSession`, `ChunkStepExecutionContext`, `createIterableSession`.
- Produces:
  - `IterableReader<Item, TCheckpoint>`
  - `createIterableReader(items)`
  - `FunctionReader<Item, TCheckpoint>`
  - `createFunctionReader(read)`

- [ ] **Step 1: Add failing helper tests**

Append to `packages/core/test/readers.test.ts`:

```ts
import { createFunctionReader, createIterableReader } from "../src/index.js";

describe("reader helpers / reader helper를 검증한다", () => {
  it("wraps iterable values as reader sessions / iterable 값을 reader session으로 감싼다", async () => {
    const reader = createIterableReader(["a", "b"]);
    const session = await reader.open(createContext());

    const items: string[] = [];
    for await (const item of session) {
      items.push(item);
    }

    expect(items).toEqual(["a", "b"]);
  });

  it("wraps function readers with execution context / function reader에 실행 context를 전달한다", async () => {
    const reader = createFunctionReader<string, { cursor?: string }>(function* ({ checkpoint }) {
      yield checkpoint?.cursor ?? "initial";
    });

    const session = await reader.open(createContext({ cursor: "restored" }));

    const items: string[] = [];
    for await (const item of session) {
      items.push(item);
    }

    expect(items).toEqual(["restored"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/core/test/readers.test.ts
```

Expected: FAIL because `createIterableReader` and `createFunctionReader` are not exported.

- [ ] **Step 3: Implement iterable reader**

Create `packages/core/src/readers/iterable-reader.ts`:

```ts
import type { Reader, ReaderSession } from "./reader.js";
import { createIterableSession } from "./reader.js";

export class IterableReader<Item, TCheckpoint = unknown> implements Reader<Item, TCheckpoint> {
  constructor(private readonly items: AsyncIterable<Item> | Iterable<Item>) {}

  open(): ReaderSession<Item, TCheckpoint> {
    return createIterableSession<Item, TCheckpoint>(this.items);
  }
}

export const createIterableReader = <Item, TCheckpoint = unknown>(
  items: AsyncIterable<Item> | Iterable<Item>
): IterableReader<Item, TCheckpoint> => new IterableReader(items);
```

- [ ] **Step 4: Implement function reader**

Create `packages/core/src/readers/function-reader.ts`:

```ts
import type { ChunkStepExecutionContext } from "../types/step.js";
import type { Reader, ReaderSession } from "./reader.js";
import { createIterableSession } from "./reader.js";

type ReadFunction<Item, TCheckpoint> = (
  context: ChunkStepExecutionContext<TCheckpoint>
) => AsyncIterable<Item> | Iterable<Item> | ReaderSession<Item, TCheckpoint>;

export class FunctionReader<Item, TCheckpoint = unknown> implements Reader<Item, TCheckpoint> {
  constructor(private readonly read: ReadFunction<Item, TCheckpoint>) {}

  open(context: ChunkStepExecutionContext<TCheckpoint>): ReaderSession<Item, TCheckpoint> {
    const result = this.read(context);
    return isReaderSession<Item, TCheckpoint>(result) ? result : createIterableSession(result);
  }
}

export const createFunctionReader = <Item, TCheckpoint = unknown>(
  read: ReadFunction<Item, TCheckpoint>
): FunctionReader<Item, TCheckpoint> => new FunctionReader(read);

const isReaderSession = <Item, TCheckpoint>(
  value: AsyncIterable<Item> | Iterable<Item> | ReaderSession<Item, TCheckpoint>
): value is ReaderSession<Item, TCheckpoint> => {
  return typeof value === "object" && value !== null && "checkpoint" in value;
};
```

- [ ] **Step 5: Export helpers**

Modify `packages/core/src/readers/index.ts`:

```ts
export { FunctionReader, createFunctionReader } from "./function-reader.js";
export { IterableReader, createIterableReader } from "./iterable-reader.js";
export {
  closeReader,
  createIterableSession,
  getReaderCheckpoint,
  openReader,
  type ChunkReader,
  type LegacyReader,
  type Reader,
  type ReaderSession
} from "./reader.js";
```

Modify `packages/core/src/index.ts`:

```ts
export {
  FunctionReader,
  IterableReader,
  closeReader,
  createFunctionReader,
  createIterableReader,
  createIterableSession,
  getReaderCheckpoint,
  openReader
} from "./readers/index.js";
export type { ChunkReader, LegacyReader, Reader, ReaderSession } from "./readers/index.js";
```

- [ ] **Step 6: Run helper tests**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/core/test/readers.test.ts
```

Expected: PASS with 5 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/readers packages/core/src/index.ts packages/core/test/readers.test.ts
git commit -m "feat : 기본 reader helper 추가" \
  -m "- IterableReader와 FunctionReader를 추가" \
  -m "- 배열과 generator 기반 reader 생성을 지원"
```

---

### Task 3: Cursor And Paging Reader Helpers

**Files:**
- Create: `packages/core/src/readers/cursor-reader.ts`
- Create: `packages/core/src/readers/paging-reader.ts`
- Modify: `packages/core/src/readers/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/readers.test.ts`

**Interfaces:**
- Consumes: `Reader`, `ReaderSession`, `ChunkStepExecutionContext`.
- Produces:
  - `CursorReader<Item, Cursor>`
  - `createCursorReader(options)`
  - `PagingReader<Item>`
  - `createPagingReader(options)`
  - `CursorCheckpoint<Cursor>`
  - `PagingCheckpoint`

- [ ] **Step 1: Add failing cursor and paging tests**

Append to `packages/core/test/readers.test.ts`:

```ts
import { createCursorReader, createPagingReader } from "../src/index.js";

describe("cursor and paging readers / cursor와 paging reader를 검증한다", () => {
  it("updates cursor checkpoints after yielded items / item을 반환한 뒤 cursor checkpoint를 갱신한다", async () => {
    const reader = createCursorReader({
      async fetch({ cursor }) {
        return cursor === "2" ? [] : [{ id: "1" }, { id: "2" }];
      },
      getCursor(item) {
        return item.id;
      }
    });

    const session = await reader.open(createContext<{ cursor?: string }>());
    const items: Array<{ id: string }> = [];
    for await (const item of session) {
      items.push(item);
    }

    expect(items).toEqual([{ id: "1" }, { id: "2" }]);
    await expect(getReaderCheckpoint(session)).resolves.toEqual({ cursor: "2" });
  });

  it("restores cursor checkpoints / cursor checkpoint부터 재시작한다", async () => {
    const reader = createCursorReader({
      async fetch({ cursor }) {
        return cursor === "1" ? [{ id: "2" }] : [];
      },
      getCursor(item: { id: string }) {
        return item.id;
      }
    });

    const session = await reader.open(createContext({ cursor: "1" }));
    const items: Array<{ id: string }> = [];
    for await (const item of session) {
      items.push(item);
    }

    expect(items).toEqual([{ id: "2" }]);
    await expect(getReaderCheckpoint(session)).resolves.toEqual({ cursor: "2" });
  });

  it("reads pages until an empty page / 빈 page가 나올 때까지 page를 읽는다", async () => {
    const reader = createPagingReader({
      pageSize: 2,
      async fetch({ page }) {
        return page === 0 ? ["a", "b"] : [];
      }
    });

    const session = await reader.open(createContext());
    const items: string[] = [];
    for await (const item of session) {
      items.push(item);
    }

    expect(items).toEqual(["a", "b"]);
    await expect(getReaderCheckpoint(session)).resolves.toEqual({ page: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/core/test/readers.test.ts
```

Expected: FAIL because `createCursorReader` and `createPagingReader` are not exported.

- [ ] **Step 3: Implement cursor reader**

Create `packages/core/src/readers/cursor-reader.ts`:

```ts
import type { ChunkStepExecutionContext } from "../types/step.js";
import type { Reader, ReaderSession } from "./reader.js";

export interface CursorCheckpoint<Cursor> {
  readonly cursor?: Cursor;
}

export interface CursorReaderFetchContext<Cursor> {
  readonly cursor?: Cursor;
  readonly signal: AbortSignal;
}

export interface CursorReaderOptions<Item, Cursor> {
  readonly fetch: (context: CursorReaderFetchContext<Cursor>) => Promise<readonly Item[]> | readonly Item[];
  readonly getCursor: (item: Item) => Cursor;
}

export class CursorReader<Item, Cursor>
  implements Reader<Item, CursorCheckpoint<Cursor>> {
  constructor(private readonly options: CursorReaderOptions<Item, Cursor>) {}

  open(
    context: ChunkStepExecutionContext<CursorCheckpoint<Cursor>>
  ): ReaderSession<Item, CursorCheckpoint<Cursor>> {
    let cursor = context.checkpoint?.cursor;
    const { fetch, getCursor } = this.options;

    return {
      async *[Symbol.asyncIterator]() {
        while (!context.signal.aborted) {
          const items = await fetch({ cursor, signal: context.signal });
          if (items.length === 0) {
            return;
          }

          for (const item of items) {
            context.signal.throwIfAborted();
            cursor = getCursor(item);
            yield item;
          }
        }

        context.signal.throwIfAborted();
      },
      checkpoint() {
        return cursor === undefined ? undefined : { cursor };
      }
    };
  }
}

export const createCursorReader = <Item, Cursor>(
  options: CursorReaderOptions<Item, Cursor>
): CursorReader<Item, Cursor> => new CursorReader(options);
```

- [ ] **Step 4: Implement paging reader**

Create `packages/core/src/readers/paging-reader.ts`:

```ts
import type { ChunkStepExecutionContext } from "../types/step.js";
import type { Reader, ReaderSession } from "./reader.js";

export interface PagingCheckpoint {
  readonly page: number;
}

export interface PagingReaderFetchContext {
  readonly page: number;
  readonly pageSize: number;
  readonly signal: AbortSignal;
}

export interface PagingReaderOptions<Item> {
  readonly pageSize: number;
  readonly fetch: (context: PagingReaderFetchContext) => Promise<readonly Item[]> | readonly Item[];
}

export class PagingReader<Item> implements Reader<Item, PagingCheckpoint> {
  constructor(private readonly options: PagingReaderOptions<Item>) {
    if (!Number.isSafeInteger(options.pageSize) || options.pageSize <= 0) {
      throw new TypeError("Paging reader pageSize must be a positive safe integer.");
    }
  }

  open(context: ChunkStepExecutionContext<PagingCheckpoint>): ReaderSession<Item, PagingCheckpoint> {
    let page = context.checkpoint?.page ?? 0;
    const { fetch, pageSize } = this.options;

    return {
      async *[Symbol.asyncIterator]() {
        while (!context.signal.aborted) {
          const items = await fetch({ page, pageSize, signal: context.signal });
          if (items.length === 0) {
            return;
          }

          for (const item of items) {
            context.signal.throwIfAborted();
            yield item;
          }

          page += 1;
        }

        context.signal.throwIfAborted();
      },
      checkpoint() {
        return { page };
      }
    };
  }
}

export const createPagingReader = <Item>(
  options: PagingReaderOptions<Item>
): PagingReader<Item> => new PagingReader(options);
```

- [ ] **Step 5: Export cursor and paging helpers**

Modify `packages/core/src/readers/index.ts`:

```ts
export {
  CursorReader,
  createCursorReader,
  type CursorCheckpoint,
  type CursorReaderFetchContext,
  type CursorReaderOptions
} from "./cursor-reader.js";
export { FunctionReader, createFunctionReader } from "./function-reader.js";
export { IterableReader, createIterableReader } from "./iterable-reader.js";
export {
  PagingReader,
  createPagingReader,
  type PagingCheckpoint,
  type PagingReaderFetchContext,
  type PagingReaderOptions
} from "./paging-reader.js";
export {
  closeReader,
  createIterableSession,
  getReaderCheckpoint,
  openReader,
  type ChunkReader,
  type LegacyReader,
  type Reader,
  type ReaderSession
} from "./reader.js";
```

Modify `packages/core/src/index.ts` with the same runtime exports and type exports from `./readers/index.js`.

- [ ] **Step 6: Run reader tests**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/core/test/readers.test.ts
```

Expected: PASS with 8 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/readers packages/core/src/index.ts packages/core/test/readers.test.ts
git commit -m "feat : cursor paging reader helper 추가" \
  -m "- checkpoint 기반 cursor reader를 추가" \
  -m "- page 기반 generic reader helper를 추가"
```

---

### Task 4: Chunk Runner ReaderSession Integration

**Files:**
- Modify: `packages/core/src/runner/chunk-step-runner.ts`
- Test: `packages/core/test/step-runners.test.ts`

**Interfaces:**
- Consumes:
  - `openReader(reader, context)`
  - `closeReader(session)`
  - `getReaderCheckpoint(session)`
- Produces:
  - chunk runner opens one `ReaderSession` per step execution.
  - chunk runner closes reader sessions on completion and failure.
  - chunk runner uses session checkpoint when step-level checkpoint callback is absent.
  - existing step-level `checkpoint` callback takes precedence over session checkpoint.

- [ ] **Step 1: Add failing runtime tests**

Append tests to `packages/core/test/step-runners.test.ts` inside the existing chunk runner `describe` block:

```ts
it("uses reader session checkpoints after successful chunks / chunk 성공 후 reader session checkpoint를 저장한다", async () => {
  const checkpoints: unknown[] = [];
  const step = defineChunkStep<string, string, { cursor?: string }>({
    name: "session-checkpoint-step",
    chunkSize: 2,
    reader: {
      open() {
        let cursor: string | undefined;
        return {
          async *[Symbol.asyncIterator]() {
            cursor = "a";
            yield "a";
            cursor = "b";
            yield "b";
          },
          checkpoint() {
            return { cursor };
          }
        };
      }
    },
    writer: {
      write() {}
    }
  });

  await runChunkStep(
    step,
    {
      executionId: "execution-1",
      stepName: "session-checkpoint-step",
      signal: new AbortController().signal
    },
    {
      async read() {
        return undefined;
      },
      async write(_executionId, _stepName, checkpoint) {
        checkpoints.push(checkpoint);
      },
      async delete() {}
    }
  );

  expect(checkpoints).toEqual([{ cursor: "b" }]);
});

it("closes reader sessions on writer failure / writer 실패 시 reader session을 닫는다", async () => {
  let closed = false;
  const step = defineChunkStep<string>({
    name: "close-on-failure-step",
    chunkSize: 1,
    reader: {
      open() {
        return {
          async *[Symbol.asyncIterator]() {
            yield "a";
          },
          close() {
            closed = true;
          }
        };
      }
    },
    writer: {
      write() {
        throw new Error("writer unavailable");
      }
    }
  });

  await expect(
    runChunkStep(
      step,
      {
        executionId: "execution-1",
        stepName: "close-on-failure-step",
        signal: new AbortController().signal
      },
      {
        async read() {
          return undefined;
        },
        async write() {},
        async delete() {}
      }
    )
  ).rejects.toThrow("writer unavailable");

  expect(closed).toBe(true);
});
```

- [ ] **Step 2: Run step runner test to verify it fails**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/core/test/step-runners.test.ts
```

Expected: FAIL because `runChunkStep` still calls `step.reader.read(...)` directly and does not close sessions.

- [ ] **Step 3: Update chunk runner to open and close sessions**

Modify `packages/core/src/runner/chunk-step-runner.ts`:

```ts
import {
  closeReader,
  getReaderCheckpoint,
  openReader
} from "../readers/index.js";
```

Change the reader setup and loop in `runChunkStep`:

```ts
const readerContext = { signal, checkpoint };
const readerSession = await openReader(step.reader, readerContext);

try {
  for await (const item of readerSession) {
    signal.throwIfAborted();
    // keep the existing chunk processing logic unchanged inside this loop
  }
} finally {
  await closeReader(readerSession);
}
```

Change the existing checkpoint resolution after writer success to:

```ts
const nextCheckpoint =
  (await step.checkpoint?.({
    signal,
    checkpoint,
    executionId,
    stepName,
    chunkIndex,
    readCount,
    writeCount,
    skipCount
  })) ?? (await getReaderCheckpoint(readerSession));

if (nextCheckpoint !== undefined) {
  await checkpointStore.write(executionId, stepName, nextCheckpoint);
}
```

Keep existing retry/skip behavior unchanged.

- [ ] **Step 4: Run step runner tests**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/core/test/step-runners.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run core tests**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/core/test
```

Expected: PASS. If existing dirty event tests fail, fix the event implementation before committing this task because reader session integration touches the same runner path.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/runner/chunk-step-runner.ts packages/core/test/step-runners.test.ts
git commit -m "feat : chunk runner reader session 연동" \
  -m "- chunk step 실행마다 reader session을 열고 닫도록 변경" \
  -m "- writer 성공 후 reader session checkpoint를 저장"
```

---

### Task 5: Nest And Example Reader Migration

**Files:**
- Modify: `examples/basic/src/jobs/import-users/import-users.step.ts`
- Modify: `examples/nestjs/src/jobs/billing/billing.step.ts`
- Modify: `examples/basic/README.md`
- Modify: `examples/nestjs/README.md`
- Test: `examples/basic/test/basic-example.e2e.test.ts`
- Test: `examples/nestjs/test/nestjs-example.e2e.test.ts`

**Interfaces:**
- Consumes: `Reader.open(context): ReaderSession`.
- Produces: examples that demonstrate Nest-safe singleton provider readers.

- [ ] **Step 1: Update basic example reader**

Modify `examples/basic/src/jobs/import-users/import-users.step.ts` reader class:

```ts
export class ImportUsersReader implements Reader<SourceUser> {
  open({ signal }: ChunkStepExecutionContext) {
    const users = sourceUsers;

    return {
      async *[Symbol.asyncIterator]() {
        for (const user of users) {
          signal.throwIfAborted();
          yield user;
        }
      }
    };
  }
}
```

- [ ] **Step 2: Update Nest example reader**

Modify `examples/nestjs/src/jobs/billing/billing.step.ts` reader class:

```ts
@BatchReader("charge-accounts-reader")
export class ChargeAccountsReader implements Reader<BillingAccount> {
  open({ signal }: ChunkStepExecutionContext) {
    return {
      async *[Symbol.asyncIterator]() {
        for (const account of billingAccounts) {
          signal.throwIfAborted();
          yield account;
        }
      }
    };
  }
}
```

Keep the class stateless. Do not store cursor, index, or mutable execution state on the provider instance.

- [ ] **Step 3: Update example docs**

Add to `examples/nestjs/README.md`:

```md
`@BatchReader` class는 Nest provider로 등록되므로 execution state를 instance field에 저장하지 않습니다.
Reader는 `open(context)`에서 실행마다 새 `ReaderSession`을 반환하고, cursor나 checkpoint state는 session 안에 둡니다.
```

Add to `examples/basic/README.md`:

```md
Reader는 `open(context)`에서 `ReaderSession`을 반환합니다. 이 구조는 Nest singleton provider에서도 cursor state가 실행 간에 섞이지 않게 합니다.
```

- [ ] **Step 4: Run example e2e tests**

Run:

```bash
npm run test:e2e:examples
```

Expected: PASS with `examples/basic/test/basic-example.e2e.test.ts` and `examples/nestjs/test/nestjs-example.e2e.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add examples/basic/src/jobs/import-users/import-users.step.ts examples/nestjs/src/jobs/billing/billing.step.ts examples/basic/README.md examples/nestjs/README.md
git commit -m "docs : Nest reader session 예제 반영" \
  -m "- basic과 nestjs example reader를 open 기반으로 변경" \
  -m "- singleton provider에서 execution state를 분리하는 규칙을 문서화"
```

---

### Task 6: Public Docs And Architecture Notes

**Files:**
- Modify: `README-kr.md`
- Modify: `README.md`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: public exports from Tasks 1-4.
- Produces: Korean and English reader session documentation.

- [ ] **Step 1: Update README-kr chunk section**

Replace the reader snippet in `README-kr.md` chunk example with:

```ts
class UserReader implements Reader<SourceUser, { cursor?: string }> {
  open({ checkpoint, signal }: ChunkStepExecutionContext<{ cursor?: string }>) {
    let cursor = checkpoint?.cursor;

    return {
      async *[Symbol.asyncIterator]() {
        for (const user of sourceUsers) {
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

Add this paragraph near the example:

```md
Nest provider는 singleton으로 재사용될 수 있으므로 reader instance field에 cursor나 offset을 저장하지 않습니다.
`open()`은 실행마다 새 `ReaderSession`을 만들고, checkpoint state는 session 안에서 관리합니다.
기존 `read(context)` reader는 1차 migration 동안 계속 사용할 수 있지만, restart 가능한 reader는 `open()` 방식을 권장합니다.
```

- [ ] **Step 2: Update README English chunk section**

Add the English equivalent:

```md
Nest providers can be reused as singletons, so readers should not store cursor or offset state on provider instance fields.
`open()` creates a new `ReaderSession` for each execution, and checkpoint state lives inside that session.
Existing `read(context)` readers remain compatible during the first migration, but restartable readers should prefer `open()`.
```

- [ ] **Step 3: Update architecture document**

Add to `docs/architecture.md` runtime constraints:

```md
- reader provider instances must stay stateless; execution-specific cursor state belongs to `ReaderSession`
- `ReaderSession.checkpoint()` is read only after writer success and chunk boundary checkpointing
- ORM-specific readers are integration package responsibilities, not `@nest-batch/core`
```

- [ ] **Step 4: Verify docs references**

Run:

```bash
rg -n "ReaderSession|open\\(|read\\(context\\)|ORM-specific readers|reader provider" README.md README-kr.md docs/architecture.md examples/basic/README.md examples/nestjs/README.md
```

Expected: output includes `ReaderSession`, `open()`, and Nest provider state guidance in README and example docs.

- [ ] **Step 5: Commit**

```bash
git add README-kr.md README.md docs/architecture.md
git commit -m "docs : reader session public 문서 추가" \
  -m "- README에 open 기반 reader 예제를 추가" \
  -m "- architecture 문서에 ReaderSession 책임을 정리"
```

---

### Task 7: Final Verification

**Files:**
- Verify all files changed by Tasks 1-6.

**Interfaces:**
- Consumes: all public exports and runtime changes from prior tasks.
- Produces: final verified branch state.

- [ ] **Step 1: Run typecheck**

Run:

```bash
./node_modules/.bin/tsc -b
```

Expected: exit code 0.

- [ ] **Step 2: Run unit tests**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts
```

Expected: exit code 0. If unrelated dirty worktree tests fail, record exact failing test names and run the reader-specific tests below before reporting.

- [ ] **Step 3: Run reader-specific tests**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/core/test/readers.test.ts packages/core/test/step-runners.test.ts
```

Expected: exit code 0.

- [ ] **Step 4: Run examples e2e**

Run:

```bash
npm run test:e2e:examples
```

Expected: exit code 0.

- [ ] **Step 5: Run full e2e**

Run:

```bash
npm run test:e2e
```

Expected: exit code 0.

- [ ] **Step 6: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output, exit code 0.

- [ ] **Step 7: Final commit if prior commits were deferred**

If tasks were implemented without intermediate commits, commit the complete change:

```bash
git add packages/core README-kr.md README.md docs/architecture.md examples/basic examples/nestjs
git commit -m "feat : Nest reader session 구조 추가" \
  -m "- ReaderSession contract와 기본 reader helper를 추가" \
  -m "- chunk runner가 session checkpoint와 close를 처리하도록 변경" \
  -m "- Nest example과 문서에 open 기반 reader 사용법을 반영"
```

---

## Self-Review

- Spec coverage: ORM reader 제외, core contract, helper reader, runner integration, Nest examples, docs, verification이 각각 Task 1-7에 포함되어 있다.
- Incomplete-marker scan: 미완성 표시 문구와 복붙 지시 문구가 작업 단계에 없다.
- Type consistency: `ReaderSession`, `Reader`, `LegacyReader`, `ChunkReader`, `openReader`, `closeReader`, `getReaderCheckpoint` 이름을 모든 task에서 동일하게 사용한다.
- Scope check: DB/ORM/Kafka/file reader 구현은 제외했고, core와 Nest example migration으로 범위를 제한했다.
