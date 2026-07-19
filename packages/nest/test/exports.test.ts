import { describe, expect, it } from "vitest";
import {
  BATCH_CHECKPOINT_STORE,
  BATCH_JOB_METADATA,
  BATCH_JOB_REPOSITORY,
  BATCH_LOCK_MANAGER,
  BATCH_STEP_METADATA,
  BatchJob,
  BatchStep,
  NestBatchModule,
  NEST_BATCH_OPTIONS
} from "../src/index.js";

describe("nest package exports / nest package export를 검증한다", () => {
  it("exports public Nest integration API / 공개 Nest integration API를 export한다", () => {
    expect(typeof NEST_BATCH_OPTIONS).toBe("symbol");
    expect(typeof BATCH_JOB_METADATA).toBe("symbol");
    expect(typeof BATCH_STEP_METADATA).toBe("symbol");
    expect(typeof BATCH_JOB_REPOSITORY).toBe("symbol");
    expect(typeof BATCH_CHECKPOINT_STORE).toBe("symbol");
    expect(typeof BATCH_LOCK_MANAGER).toBe("symbol");
    expect(typeof BatchJob).toBe("function");
    expect(typeof BatchStep).toBe("function");
    expect(typeof NestBatchModule.forRoot).toBe("function");
    expect(typeof NestBatchModule.forRootAsync).toBe("function");
  });

  it("keeps provider helpers internal / provider helper를 public API 밖에 둔다", async () => {
    const publicApi = await import("../src/index.js");

    expect(publicApi).not.toHaveProperty("assertDatabaseBatchStorage");
    expect(publicApi).not.toHaveProperty("createStaticStorageProviders");
    expect(publicApi).not.toHaveProperty("createAsyncStorageProviders");
    expect(publicApi).not.toHaveProperty("NEST_BATCH_STORAGE_EXPORTS");
  });
});
