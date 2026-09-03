import { describe, expect, it } from "vitest";
import {
  BATCH_CHECKPOINT_STORE,
  BATCH_JOB_METADATA,
  BATCH_JOB_REPOSITORY,
  BATCH_LOCK_MANAGER,
  BATCH_POLLING_WORKERS,
  BATCH_PROCESSOR_METADATA,
  BATCH_READER_METADATA,
  BATCH_RUNNER,
  BATCH_SCHEDULE_STORE,
  BATCH_SCHEDULES,
  BATCH_SCHEDULER_DISPATCHER,
  BATCH_SCHEDULER_LOOP,
  BATCH_STEP_METADATA,
  BATCH_WRITER_METADATA,
  BatchJob,
  BatchProcessor,
  BatchReader,
  BatchStep,
  BatchWriter,
  BatchContextAccessor,
  NestBatchRegistry,
  NestBatchModule,
  NestBatchPollingModule,
  NestBatchRunner,
  NEST_BATCH_OPTIONS
} from "../src/index.js";

describe("nest package exports / nest package export를 검증한다", () => {
  it("exports public Nest integration API / 공개 Nest integration API를 export한다", () => {
    expect(typeof NEST_BATCH_OPTIONS).toBe("symbol");
    expect(typeof BATCH_JOB_METADATA).toBe("symbol");
    expect(typeof BATCH_STEP_METADATA).toBe("symbol");
    expect(typeof BATCH_READER_METADATA).toBe("symbol");
    expect(typeof BATCH_PROCESSOR_METADATA).toBe("symbol");
    expect(typeof BATCH_WRITER_METADATA).toBe("symbol");
    expect(typeof BATCH_JOB_REPOSITORY).toBe("symbol");
    expect(typeof BATCH_CHECKPOINT_STORE).toBe("symbol");
    expect(typeof BATCH_LOCK_MANAGER).toBe("symbol");
    expect(typeof BATCH_POLLING_WORKERS).toBe("symbol");
    expect(typeof BATCH_RUNNER).toBe("symbol");
    expect(typeof BATCH_SCHEDULE_STORE).toBe("symbol");
    expect(typeof BATCH_SCHEDULES).toBe("symbol");
    expect(typeof BATCH_SCHEDULER_DISPATCHER).toBe("symbol");
    expect(typeof BATCH_SCHEDULER_LOOP).toBe("symbol");
    expect(typeof BatchJob).toBe("function");
    expect(typeof BatchStep).toBe("function");
    expect(typeof BatchReader).toBe("function");
    expect(typeof BatchProcessor).toBe("function");
    expect(typeof BatchWriter).toBe("function");
    expect(typeof BatchContextAccessor).toBe("function");
    expect(typeof NestBatchRegistry).toBe("function");
    expect(typeof NestBatchRunner).toBe("function");
    expect(typeof NestBatchModule.forRoot).toBe("function");
    expect(typeof NestBatchModule.forRootAsync).toBe("function");
    expect(typeof NestBatchPollingModule.forRoot).toBe("function");
    expect(typeof NestBatchPollingModule.forRootAsync).toBe("function");
  });

  it("keeps provider helpers internal / provider helper를 public API 밖에 둔다", async () => {
    const publicApi = await import("../src/index.js");

    expect(publicApi).not.toHaveProperty("assertDatabaseBatchStorage");
    expect(publicApi).not.toHaveProperty("createStaticStorageProviders");
    expect(publicApi).not.toHaveProperty("createAsyncStorageProviders");
    expect(publicApi).not.toHaveProperty("NEST_BATCH_STORAGE_EXPORTS");
    expect(publicApi).not.toHaveProperty("createRuntimeProviders");
    expect(publicApi).not.toHaveProperty("NEST_BATCH_RUNTIME_EXPORTS");
    expect(publicApi).not.toHaveProperty("BatchContextStorage");
    expect(publicApi).not.toHaveProperty("NestBatchPollingLifecycle");
    expect(publicApi).not.toHaveProperty("bindStepDefinitionContext");
  });
});
