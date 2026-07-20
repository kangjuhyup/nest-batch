import { describe, expect, it } from "vitest";
import {
  createIterableSession,
  DatabaseBatchStorage,
  defineChunkStep,
  defineJob,
  defineStep,
  isSkipItem,
  openReader,
  skipItem
} from "../src/index.js";
import type { CheckpointStore, JobRepository, LockManager, Processor, Reader, Writer } from "../src/index.js";

class FakeDatabaseBatchStorage extends DatabaseBatchStorage {
  constructor(
    readonly repository: JobRepository,
    readonly checkpointStore: CheckpointStore,
    readonly lockManager: LockManager
  ) {
    super();
  }
}

describe("core definitions / core 정의", () => {
  it("groups database adapters behind one storage abstraction / database adapter들을 하나의 storage 추상화로 묶는다", () => {
    const repository = {} as JobRepository;
    const checkpointStore = {} as CheckpointStore;
    const lockManager = {} as LockManager;
    const storage = new FakeDatabaseBatchStorage(repository, checkpointStore, lockManager);

    expect(storage).toBeInstanceOf(DatabaseBatchStorage);
    expect(storage.repository).toBe(repository);
    expect(storage.checkpointStore).toBe(checkpointStore);
    expect(storage.lockManager).toBe(lockManager);
  });

  it("defines a job with ordered steps without NestJS / NestJS 없이 순서가 있는 step으로 job을 정의한다", async () => {
    const step = defineStep({
      name: "load-users",
      async execute({ input }) {
        return String(input ?? "none");
      }
    });

    const job = defineJob({
      name: "daily-user-import",
      steps: [step]
    });

    await expect(step.execute({ input: 42, signal: new AbortController().signal })).resolves.toBe("42");
    expect(job.name).toBe("daily-user-import");
    expect(job.steps).toHaveLength(1);
    expect(job.steps[0]).toBe(step);
  });

  it("defines a chunk step without a processor / processor 없이 chunk step을 정의한다", async () => {
    const written: Array<readonly { id: string }[]> = [];
    class CopyUsersReader implements Reader<{ id: string }> {
      open() {
        return createIterableSession([{ id: "user-1" }, { id: "user-2" }]);
      }
    }
    class CopyUsersWriter implements Writer<{ id: string }> {
      write(items: readonly { id: string }[]) {
        written.push([...items]);
      }
    }

    const step = defineChunkStep({
      name: " copy-users ",
      chunkSize: 2,
      reader: new CopyUsersReader(),
      writer: new CopyUsersWriter()
    });

    const job = defineJob({
      name: "copy-users-job",
      steps: [step]
    });

    await step.writer.write([{ id: "user-1" }, { id: "user-2" }], {
      attempt: 1,
      chunkIndex: 0,
      signal: new AbortController().signal
    });

    expect(step.kind).toBe("chunk");
    expect(step.name).toBe("copy-users");
    expect(step.chunkSize).toBe(2);
    expect(Object.isFrozen(step)).toBe(true);
    expect(job.steps[0]).toBe(step);
    expect(written).toEqual([[{ id: "user-1" }, { id: "user-2" }]]);
  });

  it("normalizes reader definitions in chunk steps / chunk step의 reader 정의를 변환한다", async () => {
    const step = defineChunkStep<string>({
      name: "reader-definition-users",
      chunkSize: 2,
      reader: {
        kind: "iterable",
        source: ["user-1", "user-2"]
      },
      writer: {
        write() {
          return undefined;
        }
      }
    });
    const session = await openReader(step.reader, {
      signal: new AbortController().signal
    });
    const items: string[] = [];

    for await (const item of session) {
      items.push(item);
    }

    expect(items).toEqual(["user-1", "user-2"]);
  });

  it("defines a chunk step with a processor and explicit skip / processor와 명시적 skip이 있는 chunk step을 정의한다", async () => {
    class FilterUsersReader implements Reader<{ id: string; active: boolean }> {
      open() {
        return createIterableSession([{ id: "user-1", active: false }]);
      }
    }
    class FilterUsersProcessor implements Processor<{ id: string; active: boolean }, { id: string }> {
      process(user: { id: string; active: boolean }) {
        if (!user.active) {
          return skipItem("inactive user");
        }

        return { id: user.id };
      }
    }
    class FilterUsersWriter implements Writer<{ id: string }> {
      write() {
        return undefined;
      }
    }

    const step = defineChunkStep({
      name: "filter-users",
      chunkSize: 10,
      reader: new FilterUsersReader(),
      processor: new FilterUsersProcessor(),
      writer: new FilterUsersWriter()
    });

    const result = await step.processor?.process(
      { id: "user-1", active: false },
      {
        index: 0,
        item: { id: "user-1", active: false },
        signal: new AbortController().signal
      }
    );

    expect(isSkipItem(result)).toBe(true);
    expect(result).toMatchObject({ kind: "skip", reason: "inactive user" });
  });

  it("accepts Reader Processor Writer classes / Reader Processor Writer class 구현체를 받는다", async () => {
    const written: Array<readonly { externalId: string }[]> = [];
    class UserReader implements Reader<{ id: string }> {
      open() {
        return createIterableSession([{ id: "user-1" }]);
      }
    }
    class UserProcessor implements Processor<{ id: string }, { externalId: string }> {
      process(item: { id: string }) {
        return { externalId: item.id };
      }
    }
    class UserWriter implements Writer<{ externalId: string }> {
      write(items: readonly { externalId: string }[]) {
        written.push([...items]);
      }
    }

    const step = defineChunkStep({
      name: "interface-users",
      chunkSize: 1,
      reader: new UserReader(),
      processor: new UserProcessor(),
      writer: new UserWriter()
    });

    const signal = new AbortController().signal;
    const readerSession = await openReader(step.reader, { signal });
    const items: Array<{ id: string }> = [];
    for await (const item of readerSession) {
      items.push(item);
    }
    const processed = await step.processor?.process([...items][0], {
      index: 0,
      item: { id: "user-1" },
      signal
    });

    await step.writer.write([processed as { externalId: string }], {
      attempt: 1,
      chunkIndex: 0,
      signal
    });

    expect(written).toEqual([[{ externalId: "user-1" }]]);
  });

  it("keeps null and undefined as valid processor outputs / null과 undefined를 유효한 processor output으로 유지한다", async () => {
    const reader: Reader<{ id: string }> = {
      open() {
        return createIterableSession([{ id: "user-1" }]);
      }
    };
    const writer: Writer<null | undefined> = {
      write() {
        return undefined;
      }
    };
    const nullableStep = defineChunkStep<{ id: string }, null>({
      name: "nullable-users",
      chunkSize: 1,
      reader,
      processor: {
        process() {
          return null;
        }
      },
      writer
    });

    const undefinedStep = defineChunkStep<{ id: string }, undefined>({
      name: "undefined-users",
      chunkSize: 1,
      reader,
      processor: {
        process() {
          return undefined;
        }
      },
      writer
    });

    const signal = new AbortController().signal;
    const nullableResult = await nullableStep.processor?.process(
      { id: "user-1" },
      { index: 0, item: { id: "user-1" }, signal }
    );
    const undefinedResult = await undefinedStep.processor?.process(
      { id: "user-1" },
      { index: 0, item: { id: "user-1" }, signal }
    );

    expect(nullableResult).toBeNull();
    expect(undefinedResult).toBeUndefined();
    expect(isSkipItem(null)).toBe(false);
    expect(isSkipItem(undefined)).toBe(false);
  });

  it("detects only branded skip items / branded skip item만 인식한다", () => {
    const cause = new Error("inactive");
    const skipped = skipItem("inactive user", cause);

    expect(isSkipItem(skipped)).toBe(true);
    expect(skipped).toMatchObject({
      kind: "skip",
      reason: "inactive user",
      cause
    });
    expect(Object.isFrozen(skipped)).toBe(true);
    expect(isSkipItem({ kind: "skip", reason: "inactive user" })).toBe(false);
    expect(isSkipItem(false)).toBe(false);
    expect(isSkipItem(0)).toBe(false);
  });

  it("rejects invalid chunk sizes / 유효하지 않은 chunk size를 거부한다", () => {
    for (const chunkSize of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        defineChunkStep({
          name: "invalid-chunk",
          chunkSize,
          reader: {
            *read() {}
          },
          writer: {
            write() {
              return undefined;
            }
          }
        })
      ).toThrow("Chunk size must be a positive integer.");
    }
  });

  it("rejects jobs without steps / step이 없는 job을 거부한다", () => {
    expect(() => defineJob({ name: "empty-job", steps: [] })).toThrow(
      'Job "empty-job" must include at least one step.'
    );
  });

  it("rejects blank names / 비어 있는 이름을 거부한다", () => {
    expect(() =>
      defineStep({
        name: " ",
        async execute() {
          return undefined;
        }
      })
    ).toThrow("Step name is required.");

    expect(() =>
      defineChunkStep({
        name: " ",
        chunkSize: 1,
        reader: {
          *read() {}
        },
        writer: {
          write() {
            return undefined;
          }
        }
      })
    ).toThrow("Step name is required.");
  });
});
