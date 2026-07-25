import { describe, expect, it } from "vitest";
import { DatabaseBatchStorage, DefaultBatchRunner } from "@nest-batch/core";
import type { ExecutionEngine, WorkerPool } from "@nest-batch/core";
import type { WorkQueue } from "@nest-batch/queue-core";
import { DiscoveryModule } from "@nestjs/core";
import {
  BATCH_CHECKPOINT_STORE,
  BATCH_EXECUTION_ENGINE,
  BATCH_JOB_REPOSITORY,
  BATCH_LOCK_MANAGER,
  BATCH_RUNNER,
  BATCH_WORKER_POOL,
  BATCH_WORK_QUEUE,
  BatchContextAccessor,
  NestBatchRegistry,
  NestBatchModule,
  NestBatchRunner,
  type NestBatchModuleOptions,
  NEST_BATCH_OPTIONS
} from "../src/index.js";
import { FakeDatabaseBatchStorage, findFactoryProvider, findValueProvider } from "./support/providers.js";

describe("NestBatchModule / NestBatchModule", () => {
  it("creates a root module with options and storage providers / options와 storage provider가 있는 root module을 생성한다", () => {
    const storage = new FakeDatabaseBatchStorage();
    const dynamicModule = NestBatchModule.forRoot({ defaultTimeoutMs: 5000, storage });
    const providers = dynamicModule.providers ?? [];

    expect(dynamicModule.module).toBe(NestBatchModule);
    expect(dynamicModule.global).toBe(true);
    expect(dynamicModule.imports).toEqual([DiscoveryModule]);
    expect(findValueProvider(providers, NEST_BATCH_OPTIONS).useValue).toEqual({
      defaultTimeoutMs: 5000,
      storage
    });
    expect(findValueProvider(providers, DatabaseBatchStorage).useValue).toBe(storage);
    expect(dynamicModule.exports).toEqual(
      expect.arrayContaining([
        NEST_BATCH_OPTIONS,
        DatabaseBatchStorage,
        BATCH_JOB_REPOSITORY,
        BATCH_CHECKPOINT_STORE,
        BATCH_LOCK_MANAGER,
        BATCH_RUNNER,
        BatchContextAccessor,
        NestBatchRegistry,
        NestBatchRunner
      ])
    );
  });

  it("rejects root options without storage / storage 없는 root option을 거부한다", () => {
    expect(() =>
      NestBatchModule.forRoot({ defaultTimeoutMs: 5000 } as unknown as NestBatchModuleOptions)
    ).toThrow("NestBatchModule requires a DatabaseBatchStorage instance.");
  });

  it("depends on DatabaseBatchStorage for database wiring / database wiring에 DatabaseBatchStorage만 의존한다", () => {
    const storage = new FakeDatabaseBatchStorage();
    const dynamicModule = NestBatchModule.forRoot({ storage });
    const providers = dynamicModule.providers ?? [];

    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: DatabaseBatchStorage, useValue: storage }),
        expect.objectContaining({ provide: BATCH_JOB_REPOSITORY }),
        expect.objectContaining({ provide: BATCH_CHECKPOINT_STORE }),
        expect.objectContaining({ provide: BATCH_LOCK_MANAGER }),
        NestBatchRegistry,
        expect.objectContaining({ provide: BATCH_RUNNER }),
        NestBatchRunner
      ])
    );
  });

  it("creates a default runner provider / 기본 runner provider를 생성한다", () => {
    const storage = new FakeDatabaseBatchStorage();
    const dynamicModule = NestBatchModule.forRoot({ storage });
    const runnerProvider = findFactoryProvider(dynamicModule.providers ?? [], BATCH_RUNNER);

    expect(runnerProvider.inject).toEqual([DatabaseBatchStorage, NEST_BATCH_OPTIONS]);
    expect(runnerProvider.useFactory(storage, { storage })).toBeInstanceOf(DefaultBatchRunner);
  });

  it("uses a custom batch runner from options / option으로 custom batch runner를 사용한다", () => {
    const storage = new FakeDatabaseBatchStorage();
    const batchRunner = { run: async () => ({ status: "completed" }) };
    const dynamicModule = NestBatchModule.forRoot({ storage, batchRunner });
    const runnerProvider = findFactoryProvider(dynamicModule.providers ?? [], BATCH_RUNNER);

    expect(runnerProvider.useFactory(storage, { storage, batchRunner })).toBe(batchRunner);
  });

  it("accepts runtime extension providers / runtime 확장 provider를 설정한다", () => {
    const storage = new FakeDatabaseBatchStorage();
    const executionEngine = { runJob: async () => ({ status: "completed" }) } as ExecutionEngine;
    const workerPool = { capacity: 1, run: async () => "done" } as WorkerPool;
    const workQueue = {
      enqueue: async () => undefined,
      claim: async () => undefined,
      complete: async () => undefined,
      fail: async () => undefined
    } as WorkQueue;
    const dynamicModule = NestBatchModule.forRoot({
      storage,
      executionEngine,
      workerPool,
      workQueue
    });
    const providers = dynamicModule.providers ?? [];

    expect(findValueProvider(providers, BATCH_EXECUTION_ENGINE).useValue).toBe(executionEngine);
    expect(findValueProvider(providers, BATCH_WORKER_POOL).useValue).toBe(workerPool);
    expect(findValueProvider(providers, BATCH_WORK_QUEUE).useValue).toBe(workQueue);
    expect(dynamicModule.exports).toEqual(
      expect.arrayContaining([BATCH_EXECUTION_ENGINE, BATCH_WORKER_POOL, BATCH_WORK_QUEUE])
    );
  });

  it("creates async module providers from storage options / storage option으로 async module provider를 생성한다", () => {
    const storage = new FakeDatabaseBatchStorage();
    const dynamicModule = NestBatchModule.forRootAsync({
      inject: ["CONFIG"],
      useFactory: () => ({ storage })
    });
    const providers = dynamicModule.providers ?? [];

    expect(findFactoryProvider(providers, NEST_BATCH_OPTIONS).inject).toEqual(["CONFIG"]);
    expect(findFactoryProvider(providers, DatabaseBatchStorage).inject).toEqual([NEST_BATCH_OPTIONS]);
    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: BATCH_JOB_REPOSITORY }),
        expect.objectContaining({ provide: BATCH_CHECKPOINT_STORE }),
        expect.objectContaining({ provide: BATCH_LOCK_MANAGER })
      ])
    );
    expect(dynamicModule.exports).toEqual(
      expect.arrayContaining([
        NEST_BATCH_OPTIONS,
        DatabaseBatchStorage,
        BATCH_JOB_REPOSITORY,
        BATCH_CHECKPOINT_STORE,
        BATCH_LOCK_MANAGER,
        BATCH_RUNNER,
        BatchContextAccessor,
        NestBatchRegistry,
        NestBatchRunner
      ])
    );
  });

  it("keeps async module imports and defaults empty injection / async module imports와 기본 inject 값을 유지한다", () => {
    const importedModule = { module: class ConfigModule {} };
    const dynamicModule = NestBatchModule.forRootAsync({
      imports: [importedModule],
      useFactory: () => ({ storage: new FakeDatabaseBatchStorage() })
    });
    const optionsProvider = findFactoryProvider(dynamicModule.providers ?? [], NEST_BATCH_OPTIONS);

    expect(dynamicModule.global).toBe(true);
    expect(dynamicModule.imports).toEqual([DiscoveryModule, importedModule]);
    expect(optionsProvider.inject).toEqual([]);
  });
});
