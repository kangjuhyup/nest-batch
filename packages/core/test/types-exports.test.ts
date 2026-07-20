import { describe, expect, it } from "vitest";
import { SKIP_ITEM, isSkipItem, skipItem } from "../src/skip-item.js";
import {
  BATCH_EVENT_TYPES,
  DatabaseBatchStorage,
  JOB_BATCH_EVENT_TYPES,
  STEP_BATCH_EVENT_TYPES
} from "../src/types/index.js";
import type {
  BatchEvent,
  BatchEventType,
  CheckpointStore,
  ChunkWrittenBatchEvent,
  ItemSkippedBatchEvent,
  JobBatchEvent,
  JobExecution,
  JobRepository,
  LockManager,
  Reader,
  RetryBatchEvent,
  StepBatchEvent,
  StepExecution,
  Writer
} from "../src/types/index.js";

class FakeDatabaseBatchStorage extends DatabaseBatchStorage {
  constructor(
    readonly repository: JobRepository,
    readonly checkpointStore: CheckpointStore,
    readonly lockManager: LockManager
  ) {
    super();
  }
}

describe("core type module exports / core type module export", () => {
  it("exports split type modules through the types barrel / 분리된 type module을 types barrel로 export한다", async () => {
    const repository = {} as JobRepository;
    const checkpointStore = {} as CheckpointStore;
    const lockManager = {} as LockManager;
    const storage = new FakeDatabaseBatchStorage(repository, checkpointStore, lockManager);
    const reader: Reader<string> = {
      open() {
        return {
          async *[Symbol.asyncIterator]() {
            yield "user-1";
          }
        };
      }
    };
    const writer: Writer<string> = {
      write() {
        return undefined;
      }
    };

    expect(storage.repository).toBe(repository);
    const items: string[] = [];
    for await (const item of await reader.open({ signal: new AbortController().signal })) {
      items.push(item);
    }
    expect(items).toEqual(["user-1"]);
    expect(writer.write(["user-1"], { attempt: 1, chunkIndex: 0, signal: new AbortController().signal })).toBeUndefined();
  });

  it("keeps skip item runtime helpers outside the type definitions / skip item runtime helper를 type 정의 밖에 둔다", () => {
    const skipped = skipItem("filtered");

    expect(skipped[SKIP_ITEM]).toBe(true);
    expect(isSkipItem(skipped)).toBe(true);
    expect(isSkipItem({ kind: "skip", reason: "filtered" })).toBe(false);
  });

  it("exports explicit batch event type values / 명시적인 batch event type 값을 export한다", () => {
    const expectedTypes: readonly BatchEventType[] = [
      "job.started",
      "job.completed",
      "job.failed",
      "job.cancelled",
      "step.started",
      "step.completed",
      "step.failed",
      "step.cancelled",
      "chunk.written",
      "retry",
      "item.skipped"
    ];
    const jobEvent: JobBatchEvent = {
      type: "job.started",
      execution: {} as JobExecution
    };
    const stepEvent: StepBatchEvent = {
      type: "step.completed",
      execution: {} as StepExecution
    };
    const chunkEvent: ChunkWrittenBatchEvent = {
      type: "chunk.written",
      jobExecutionId: "execution-1",
      stepName: "copy-users",
      chunkIndex: 0,
      itemCount: 2,
      readCount: 2,
      writeCount: 2,
      skipCount: 0
    };
    const retryEvent: RetryBatchEvent = {
      type: "retry",
      jobExecutionId: "execution-1",
      stepName: "copy-users",
      phase: "write",
      attempt: 1,
      error: new Error("temporary failure")
    };
    const skippedEvent: ItemSkippedBatchEvent = {
      type: "item.skipped",
      jobExecutionId: "execution-1",
      stepName: "copy-users",
      item: "user-1",
      reason: "inactive user"
    };
    const events: readonly BatchEvent[] = [
      jobEvent,
      stepEvent,
      chunkEvent,
      retryEvent,
      skippedEvent
    ];

    expect(JOB_BATCH_EVENT_TYPES).toEqual([
      "job.started",
      "job.completed",
      "job.failed",
      "job.cancelled"
    ]);
    expect(STEP_BATCH_EVENT_TYPES).toEqual([
      "step.started",
      "step.completed",
      "step.failed",
      "step.cancelled"
    ]);
    expect(BATCH_EVENT_TYPES).toEqual(expectedTypes);
    expect(events.map((event) => event.type)).toEqual([
      "job.started",
      "step.completed",
      "chunk.written",
      "retry",
      "item.skipped"
    ]);
  });
});
