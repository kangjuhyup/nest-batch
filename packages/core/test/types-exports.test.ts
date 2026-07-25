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
  ChunkFailurePhase,
  ChunkWrittenBatchEvent,
  CursorReader,
  CursorReaderDefinition,
  ExecutionEngine,
  FileReader,
  FileReaderDefinition,
  FunctionReader,
  FunctionReaderDefinition,
  HttpReader,
  HttpReaderDefinition,
  IterableReader,
  IterableReaderDefinition,
  ItemSkippedBatchEvent,
  JsonlFileReaderOptions,
  JsonHttpReaderOptions,
  JobBatchEvent,
  JobExecution,
  JobRepository,
  LockManager,
  LineFileReaderOptions,
  PageReader,
  PageReaderDefinition,
  PartitionClaimOptions,
  PartitionExecution,
  PartitionExecutionContext,
  PartitionExecutionResult,
  PartitionExecutionStatus,
  PartitionedStepDefinition,
  PartitionedStepOptions,
  PagingReader,
  PagingReaderDefinition,
  Reader,
  ReaderDefinition,
  RetryBatchEvent,
  SqlReader,
  SqlCursorReader,
  SqlCursorReaderOptions,
  SqlReaderDefinition,
  StepBatchEvent,
  StepExecution,
  WorkerPool,
  WorkerTask,
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
    const executionEngine = {} as ExecutionEngine;
    const partitionStatus: PartitionExecutionStatus = "created";
    const partition: PartitionExecution = {
      id: "partition-1",
      stepExecutionId: "step-execution-1",
      stepName: "load-users",
      status: partitionStatus,
      partition: { shard: 0 },
      readCount: 0,
      writeCount: 0,
      skipCount: 0,
      retryCount: 0,
      createdAt: new Date("2026-07-25T00:00:00.000Z")
    };
    const claimOptions: PartitionClaimOptions = {
      stepExecutionId: partition.stepExecutionId,
      ownerId: "worker-1",
      now: new Date("2026-07-25T00:01:00.000Z")
    };
    const partitionContext: PartitionExecutionContext<{ readonly shard: number }> = {
      jobExecutionId: "job-execution-1",
      stepExecutionId: "step-execution-1",
      partitionExecutionId: "partition-1",
      stepName: "load-users",
      partition: { shard: 0 },
      signal: new AbortController().signal
    };
    const partitionResult: PartitionExecutionResult = {
      readCount: 1,
      writeCount: 1
    };
    const partitionedStepOptions: PartitionedStepOptions<{ readonly shard: number }> = {
      name: "partition-users",
      partitions: () => [{ shard: 0 }],
      execute() {
        return partitionResult;
      }
    };
    const partitionedStep: PartitionedStepDefinition<{ readonly shard: number }> = {
      ...partitionedStepOptions,
      kind: "partitioned"
    };
    const workerTask: WorkerTask<string> = {
      run() {
        return "done";
      }
    };
    const workerPool = {} as WorkerPool;
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
    const iterableReader: IterableReader<string> = reader;
    const functionReader: FunctionReader<string> = reader;
    const cursorReader: CursorReader<string, string> = {
      open() {
        return {
          async *[Symbol.asyncIterator]() {
            yield "cursor-user";
          }
        };
      }
    };
    const pageReader: PageReader<string> = {
      open() {
        return {
          async *[Symbol.asyncIterator]() {
            yield "page-user";
          }
        };
      }
    };
    const pagingReader: PagingReader<string> = pageReader;
    const sqlReader: SqlReader<string> = pageReader;
    const sqlCursorReader: SqlCursorReader<string, string> = cursorReader;
    const httpReader: HttpReader<string, number> = reader;
    const fileReader: FileReader<string> = reader;
    const iterableReaderDefinition: IterableReaderDefinition<string> = {
      kind: "iterable",
      source: ["iterable-user"]
    };
    const functionReaderDefinition: FunctionReaderDefinition<string> = {
      kind: "function",
      read() {
        return ["function-user"];
      }
    };
    const cursorReaderDefinition: CursorReaderDefinition<string, string> = {
      kind: "cursor",
      fetch({ cursor }) {
        return cursor ? [] : ["cursor-definition-user"];
      },
      getCursor(item) {
        return item;
      }
    };
    const pageReaderDefinition: PageReaderDefinition<string> = {
      kind: "page",
      pageSize: 1,
      fetch({ page }) {
        return page === 0 ? ["page-definition-user"] : [];
      }
    };
    const pagingReaderDefinition: PagingReaderDefinition<string> = {
      kind: "paging",
      pageSize: 1,
      fetch({ page }) {
        return page === 0 ? ["paging-definition-user"] : [];
      }
    };
    const sqlReaderDefinition: SqlReaderDefinition<string> = {
      kind: "sql",
      pageSize: 1,
      query({ offset }) {
        return offset === 0 ? ["sql-definition-user"] : [];
      }
    };
    const httpReaderDefinition: HttpReaderDefinition<string, number> = {
      kind: "http",
      pageSize: 1,
      initialPage: 0,
      request({ page }) {
        return page === 0
          ? { items: ["http-definition-user"], nextPage: 1 }
          : { items: [] };
      }
    };
    const fileReaderDefinition: FileReaderDefinition<string> = {
      kind: "file",
      open() {
        return ["file-definition-user"];
      }
    };
    const lineFileReaderOptions: LineFileReaderOptions = {
      lines: ["line-1"]
    };
    const jsonlFileReaderOptions: JsonlFileReaderOptions<{ readonly id: string }> = {
      lines: ['{"id":"user-1"}']
    };
    const jsonHttpReaderOptions: JsonHttpReaderOptions<{ readonly id: string }> = {
      pageSize: 1,
      request() {
        return {
          ok: true,
          status: 200,
          json() {
            return { data: [{ id: "user-1" }] };
          }
        };
      },
      selectItems(body) {
        return (body as { readonly data: readonly { readonly id: string }[] }).data;
      }
    };
    const sqlCursorReaderOptions: SqlCursorReaderOptions<string, string> = {
      pageSize: 1,
      query({ cursor }) {
        return cursor ? [] : ["sql-cursor-user"];
      },
      getCursor(item) {
        return item;
      }
    };
    const readerDefinitions: readonly ReaderDefinition<string>[] = [
      iterableReaderDefinition,
      functionReaderDefinition,
      cursorReaderDefinition,
      pageReaderDefinition,
      pagingReaderDefinition,
      sqlReaderDefinition,
      httpReaderDefinition,
      fileReaderDefinition
    ];

    expect(storage.repository).toBe(repository);
    expect(executionEngine).toBeDefined();
    expect(partition.status).toBe("created");
    expect(claimOptions.stepExecutionId).toBe("step-execution-1");
    expect(partitionContext.partition.shard).toBe(0);
    expect(partitionedStep.kind).toBe("partitioned");
    expect(workerTask.run(new AbortController().signal)).toBe("done");
    expect(workerPool).toBeDefined();
    const items: string[] = [];
    for await (const item of await reader.open({ signal: new AbortController().signal })) {
      items.push(item);
    }
    expect(items).toEqual(["user-1"]);
    expect(iterableReader).toBe(reader);
    expect(functionReader).toBe(reader);
    expect(await collectReader(cursorReader)).toEqual(["cursor-user"]);
    expect(await collectReader(pagingReader)).toEqual(["page-user"]);
    expect(await collectReader(sqlReader)).toEqual(["page-user"]);
    expect(await collectReader(sqlCursorReader)).toEqual(["cursor-user"]);
    expect(await collectReader(httpReader)).toEqual(["user-1"]);
    expect(await collectReader(fileReader)).toEqual(["user-1"]);
    expect(lineFileReaderOptions.lines).toEqual(["line-1"]);
    expect(jsonlFileReaderOptions.lines).toEqual(['{"id":"user-1"}']);
    expect(jsonHttpReaderOptions.pageSize).toBe(1);
    expect(sqlCursorReaderOptions.pageSize).toBe(1);
    expect(readerDefinitions.map((definition) => definition.kind)).toEqual([
      "iterable",
      "function",
      "cursor",
      "page",
      "paging",
      "sql",
      "http",
      "file"
    ]);
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
    const expectedFailurePhases: readonly ChunkFailurePhase[] = ["read", "process", "write"];
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
    expect(expectedFailurePhases).toEqual(["read", "process", "write"]);
    expect(events.map((event) => event.type)).toEqual([
      "job.started",
      "step.completed",
      "chunk.written",
      "retry",
      "item.skipped"
    ]);
  });
});

const collectReader = async <TCheckpoint>(
  reader: Reader<string, TCheckpoint>,
  checkpoint?: TCheckpoint
): Promise<readonly string[]> => {
  const items: string[] = [];

  for await (const item of await reader.open({
    signal: new AbortController().signal,
    checkpoint
  })) {
    items.push(item);
  }

  return items;
};
