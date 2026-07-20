import { describe, expect, it } from "vitest";
import {
  closeReader,
  createCursorReader,
  createFunctionReader,
  createIterableReader,
  createPagingReader,
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

  it("creates reader sessions from iterable factories / iterable factory로 reader session을 만든다", async () => {
    const reader = createIterableReader((context: ChunkStepExecutionContext<{ readonly start: number }>) => [
      context.checkpoint?.start ?? 0,
      2,
      3
    ]);

    const opened = await openReader(reader, createContext({ start: 1 }));

    const items: number[] = [];
    for await (const item of opened) {
      items.push(item);
    }

    expect(items).toEqual([1, 2, 3]);
  });

  it("opens reader definitions without calling factory helpers / factory helper 직접 호출 없이 reader 정의를 연다", async () => {
    const opened = await openReader(
      {
        kind: "iterable",
        source: ["a", "b"]
      },
      createContext()
    );

    const items: string[] = [];
    for await (const item of opened) {
      items.push(item);
    }

    expect(items).toEqual(["a", "b"]);
  });

  it("creates reader sessions from read functions / read function으로 reader session을 만든다", async () => {
    const reader = createFunctionReader(async function* (
      context: ChunkStepExecutionContext<{ readonly cursor?: string }>
    ) {
      yield context.checkpoint?.cursor ?? "first";
      yield "second";
    });

    const opened = await openReader(reader, createContext({ cursor: "resume" }));

    const items: string[] = [];
    for await (const item of opened) {
      items.push(item);
    }

    expect(items).toEqual(["resume", "second"]);
  });

  it("creates cursor readers with checkpoint support / checkpoint를 지원하는 cursor reader를 만든다", async () => {
    const reader = createCursorReader<{ readonly id: number; readonly name: string }, number>({
      async fetch({ cursor }: { readonly cursor?: number }) {
        return cursor === undefined
          ? [
              { id: 1, name: "first" },
              { id: 2, name: "second" }
            ]
          : [];
      },
      getCursor(item: { readonly id: number }) {
        return item.id;
      }
    });

    const opened = await openReader(reader, createContext());

    const names: string[] = [];
    for await (const item of opened) {
      names.push(item.name);
    }

    await expect(getReaderCheckpoint(opened)).resolves.toEqual({ cursor: 2 });
    expect(names).toEqual(["first", "second"]);
  });

  it("opens cursor reader definitions with checkpoint support / checkpoint를 지원하는 cursor reader 정의를 연다", async () => {
    const opened = await openReader(
      {
        kind: "cursor",
        fetch({ cursor }: { readonly cursor?: number }) {
          return cursor === undefined
            ? [
                { id: 1, name: "first" },
                { id: 2, name: "second" }
              ]
            : [];
        },
        getCursor(item: { readonly id: number }) {
          return item.id;
        }
      },
      createContext()
    );

    const names: string[] = [];
    for await (const item of opened) {
      names.push(item.name);
    }

    await expect(getReaderCheckpoint(opened)).resolves.toEqual({ cursor: 2 });
    expect(names).toEqual(["first", "second"]);
  });

  it("creates paging readers with page offset checkpoints / page offset checkpoint를 지원하는 paging reader를 만든다", async () => {
    const reader = createPagingReader<string>({
      pageSize: 2,
      async fetch({ page }: { readonly page: number }) {
        return page === 0 ? ["a", "b"] : [];
      }
    });

    const opened = await openReader(reader, createContext());
    const iterator = opened[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ value: "a", done: false });
    await expect(getReaderCheckpoint(opened)).resolves.toEqual({ page: 0, offset: 1 });
    await expect(iterator.next()).resolves.toEqual({ value: "b", done: false });
    await expect(getReaderCheckpoint(opened)).resolves.toEqual({ page: 1, offset: 0 });
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it("rejects invalid paging reader options and checkpoints / 유효하지 않은 paging reader 설정과 checkpoint를 거부한다", async () => {
    expect(() =>
      createPagingReader({
        pageSize: 0,
        fetch() {
          return [];
        }
      })
    ).toThrow("Paging reader pageSize must be a positive safe integer.");

    const reader = createPagingReader({
      pageSize: 1,
      fetch() {
        return [];
      }
    });

    await expect(openReader(reader, createContext({ page: -1 }))).rejects.toThrow(
      "Paging reader checkpoint.page must be a non-negative safe integer."
    );
    await expect(openReader(reader, createContext({ page: 0, offset: -1 }))).rejects.toThrow(
      "Paging reader checkpoint.offset must be a non-negative safe integer."
    );
  });
});
