import { describe, expect, it } from "vitest";
import { DatabaseBatchStorage } from "@nest-batch/core";
import type { CheckpointStore, JobRepository, LockManager } from "@nest-batch/core";
import {
  BATCH_CHECKPOINT_STORE,
  BATCH_JOB_REPOSITORY,
  BATCH_LOCK_MANAGER,
  BatchJob,
  BatchStep,
  NestBatchModule,
  type NestBatchModuleOptions,
  NEST_BATCH_OPTIONS
} from "../src/index.js";

class FakeDatabaseBatchStorage extends DatabaseBatchStorage {
  readonly repository = {} as JobRepository;
  readonly checkpointStore = {} as CheckpointStore;
  readonly lockManager = {} as LockManager;
}

describe("nest package exports / nest package export를 검증한다", () => {
  it("creates a dynamic module with options provider / options provider가 있는 dynamic module을 생성한다", () => {
    const storage = new FakeDatabaseBatchStorage();
    const dynamicModule = NestBatchModule.forRoot({ defaultTimeoutMs: 5000, storage });

    expect(dynamicModule.module).toBe(NestBatchModule);
    expect(dynamicModule.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: NEST_BATCH_OPTIONS, useValue: { defaultTimeoutMs: 5000, storage } }),
        expect.objectContaining({ provide: DatabaseBatchStorage, useValue: storage })
      ])
    );
    expect(dynamicModule.exports).toEqual(expect.arrayContaining([NEST_BATCH_OPTIONS, DatabaseBatchStorage]));
  });

  it("rejects root options without storage / storage 없는 root option을 거부한다", () => {
    expect(() =>
      NestBatchModule.forRoot({ defaultTimeoutMs: 5000 } as unknown as NestBatchModuleOptions)
    ).toThrow("NestBatchModule requires a DatabaseBatchStorage instance.");
  });

  it("depends on DatabaseBatchStorage for database wiring / database wiring에 DatabaseBatchStorage만 의존한다", () => {
    const storage = new FakeDatabaseBatchStorage();
    const dynamicModule = NestBatchModule.forRoot({ storage });

    expect(dynamicModule.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: DatabaseBatchStorage, useValue: storage }),
        expect.objectContaining({ provide: BATCH_JOB_REPOSITORY }),
        expect.objectContaining({ provide: BATCH_CHECKPOINT_STORE }),
        expect.objectContaining({ provide: BATCH_LOCK_MANAGER })
      ])
    );
    expect(dynamicModule.exports).toEqual(
      expect.arrayContaining([
        DatabaseBatchStorage,
        BATCH_JOB_REPOSITORY,
        BATCH_CHECKPOINT_STORE,
        BATCH_LOCK_MANAGER
      ])
    );
  });

  it("creates async module providers from DatabaseBatchStorage options / DatabaseBatchStorage option으로 async module provider를 생성한다", () => {
    const storage = new FakeDatabaseBatchStorage();
    const dynamicModule = NestBatchModule.forRootAsync({
      inject: ["CONFIG"],
      useFactory: () => ({ storage })
    });

    expect(dynamicModule.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: NEST_BATCH_OPTIONS, inject: ["CONFIG"] }),
        expect.objectContaining({ provide: DatabaseBatchStorage, inject: [NEST_BATCH_OPTIONS] }),
        expect.objectContaining({ provide: BATCH_JOB_REPOSITORY }),
        expect.objectContaining({ provide: BATCH_CHECKPOINT_STORE }),
        expect.objectContaining({ provide: BATCH_LOCK_MANAGER })
      ])
    );
    expect(dynamicModule.exports).toEqual(
      expect.arrayContaining([
        DatabaseBatchStorage,
        BATCH_JOB_REPOSITORY,
        BATCH_CHECKPOINT_STORE,
        BATCH_LOCK_MANAGER
      ])
    );
  });

  it("exports decorator factories / decorator factory를 export한다", () => {
    expect(typeof BatchJob("daily-billing")).toBe("function");
    expect(typeof BatchStep("charge-account")).toBe("function");
  });
});
