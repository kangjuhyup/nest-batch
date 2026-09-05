import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { DatabaseBatchStorage } from "@rv-nest-batch/core";
import type { CheckpointStore, JobRepository, LockManager } from "@rv-nest-batch/core";
import type { ScheduleStore } from "@rv-nest-batch/core/scheduler";
import { NestBatchModule } from "../src/index.js";
import { FakeDatabaseBatchStorage } from "./support/providers.js";

describe("Nest polling lifecycle / Nest polling lifecycle를 검증한다", () => {
  it("starts only autoStart polling workers / autoStart polling worker만 시작한다", async () => {
    const storage = new FakeDatabaseBatchStorage();
    const observedSignals: AbortSignal[] = [];
    const started = {
      auto: 0,
      manual: 0
    };

    @Module({
      imports: [
        NestBatchModule.forRoot({
          storage,
          pollingWorkers: [
            {
              workerId: "vote-outbox-worker-1",
              pollIntervalMs: 60_000,
              autoStart: true,
              task: ({ signal }) => {
                observedSignals.push(signal);
                started.auto += 1;
                return 0;
              }
            },
            {
              workerId: "vote-outbox-worker-2",
              pollIntervalMs: 60_000,
              autoStart: false,
              task: () => {
                started.manual += 1;
                return 0;
              }
            }
          ]
        })
      ]
    })
    class TestModule {}

    const app = await NestFactory.createApplicationContext(TestModule, {
      abortOnError: false,
      logger: false
    });

    try {
      expect(started).toEqual({ auto: 1, manual: 0 });
      expect(observedSignals).toHaveLength(1);
      expect(observedSignals[0]?.aborted).toBe(false);
    } finally {
      await app.close();
    }

    expect(observedSignals[0]?.aborted).toBe(true);
  });

  it("waits for in-flight polling work on shutdown / shutdown에서 진행 중인 polling 작업을 기다린다", async () => {
    const storage = new FakeDatabaseBatchStorage();
    let resolveTask: ((value: number) => void) | undefined;
    let closed = false;

    @Module({
      imports: [
        NestBatchModule.forRoot({
          storage,
          pollingWorkers: [
            {
              workerId: "vote-outbox-worker-1",
              pollIntervalMs: 60_000,
              autoStart: true,
              task: () =>
                new Promise<number>((resolve) => {
                  resolveTask = resolve;
                })
            }
          ]
        })
      ]
    })
    class TestModule {}

    const app = await NestFactory.createApplicationContext(TestModule, {
      abortOnError: false,
      logger: false
    });

    const closing = app.close().then(() => {
      closed = true;
    });
    await Promise.resolve();

    expect(closed).toBe(false);

    resolveTask?.(0);
    await closing;

    expect(closed).toBe(true);
  });

  it("validates autoStart workers before starting any polling loop / autoStart worker를 시작 전에 검증한다", async () => {
    const storage = new FakeDatabaseBatchStorage();
    let started = 0;

    @Module({
      imports: [
        NestBatchModule.forRoot({
          storage,
          pollingWorkers: [
            {
              workerId: "vote-outbox-worker-1",
              pollIntervalMs: 60_000,
              autoStart: true,
              task: () => {
                started += 1;
                return new Promise<number>(() => undefined);
              }
            },
            {
              workerId: "",
              pollIntervalMs: 60_000,
              autoStart: true,
              task: () => 0
            }
          ]
        })
      ]
    })
    class TestModule {}

    await expect(
      NestFactory.createApplicationContext(TestModule, {
        abortOnError: false,
        logger: false
      })
    ).rejects.toThrow("ContinuousPollingLoop workerId is required.");

    expect(started).toBe(0);
  });

  it("does not create batch or schedule metadata for polling ticks / polling tick마다 batch나 schedule metadata를 만들지 않는다", async () => {
    const metadataCalls: string[] = [];
    const storage = new ThrowingMetadataStorage(metadataCalls);
    const scheduleStore = createThrowingMetadataStore<ScheduleStore>("scheduleStore", metadataCalls);
    let taskCalls = 0;

    @Module({
      imports: [
        NestBatchModule.forRoot({
          storage,
          scheduleStore,
          pollingWorkers: [
            {
              workerId: "vote-outbox-worker-1",
              pollIntervalMs: 60_000,
              autoStart: true,
              task: () => {
                taskCalls += 1;
                return taskCalls === 1 ? 1 : 0;
              }
            }
          ]
        })
      ]
    })
    class TestModule {}

    const app = await NestFactory.createApplicationContext(TestModule, {
      abortOnError: false,
      logger: false
    });

    try {
      await vi.waitFor(() => expect(taskCalls).toBeGreaterThanOrEqual(2));
      expect(metadataCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

class ThrowingMetadataStorage extends DatabaseBatchStorage {
  readonly repository: JobRepository;
  readonly checkpointStore: CheckpointStore;
  readonly lockManager: LockManager;

  constructor(metadataCalls: string[]) {
    super();
    this.repository = createThrowingMetadataStore<JobRepository>("repository", metadataCalls);
    this.checkpointStore = createThrowingMetadataStore<CheckpointStore>(
      "checkpointStore",
      metadataCalls
    );
    this.lockManager = createThrowingMetadataStore<LockManager>("lockManager", metadataCalls);
  }
}

const createThrowingMetadataStore = <TStore extends object>(
  storeName: string,
  metadataCalls: string[]
): TStore =>
  new Proxy(
    {},
    {
      get: (_target, property) => {
        if (
          property === "then" ||
          property === "onModuleInit" ||
          property === "onModuleDestroy" ||
          property === "onApplicationBootstrap" ||
          property === "beforeApplicationShutdown" ||
          property === "onApplicationShutdown"
        ) {
          return undefined;
        }

        return () => {
          metadataCalls.push(`${storeName}.${String(property)}`);
          throw new Error(`${storeName}.${String(property)} must not be called by polling workers.`);
        };
      }
    }
  ) as TStore;
