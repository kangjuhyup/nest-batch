import { describe, expect, it } from "vitest";
import {
  DatabaseBatchStorage,
  defineChunkStep,
  defineJob,
  defineStep,
  isSkipItem,
  skipItem
} from "../src/index.js";
import type { CheckpointStore, JobRepository, LockManager } from "../src/index.js";

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

    const step = defineChunkStep({
      name: " copy-users ",
      chunkSize: 2,
      reader: async function* () {
        yield { id: "user-1" };
        yield { id: "user-2" };
      },
      writer(items) {
        written.push([...items]);
      }
    });

    const job = defineJob({
      name: "copy-users-job",
      steps: [step]
    });

    await step.writer([{ id: "user-1" }, { id: "user-2" }], {
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

  it("defines a chunk step with a processor and explicit skip / processor와 명시적 skip이 있는 chunk step을 정의한다", async () => {
    const step = defineChunkStep({
      name: "filter-users",
      chunkSize: 10,
      reader: function* () {
        yield { id: "user-1", active: false };
      },
      processor(user) {
        if (!user.active) {
          return skipItem("inactive user");
        }

        return { id: user.id };
      },
      writer() {
        return undefined;
      }
    });

    const result = await step.processor?.(
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

  it("keeps null and undefined as valid processor outputs / null과 undefined를 유효한 processor output으로 유지한다", async () => {
    const nullableStep = defineChunkStep<{ id: string }, null>({
      name: "nullable-users",
      chunkSize: 1,
      reader: function* () {
        yield { id: "user-1" };
      },
      processor() {
        return null;
      },
      writer() {
        return undefined;
      }
    });

    const undefinedStep = defineChunkStep<{ id: string }, undefined>({
      name: "undefined-users",
      chunkSize: 1,
      reader: function* () {
        yield { id: "user-1" };
      },
      processor() {
        return undefined;
      },
      writer() {
        return undefined;
      }
    });

    const signal = new AbortController().signal;
    const nullableResult = await nullableStep.processor?.(
      { id: "user-1" },
      { index: 0, item: { id: "user-1" }, signal }
    );
    const undefinedResult = await undefinedStep.processor?.(
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
          reader: [],
          writer() {
            return undefined;
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
        reader: [],
        writer() {
          return undefined;
        }
      })
    ).toThrow("Step name is required.");
  });
});
