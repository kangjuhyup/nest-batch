import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { DatabaseBatchStorage } from "@rv-nest-batch/core";
import {
  BATCH_CHECKPOINT_STORE,
  BATCH_JOB_REPOSITORY,
  BATCH_LOCK_MANAGER,
  BATCH_POLLING_WORKERS,
  BATCH_RUNNER,
  BATCH_SCHEDULE_STORE,
  BATCH_SCHEDULES,
  BATCH_SCHEDULER_LOOP,
  NestBatchPollingModule
} from "../src/index.js";
import { findValueProvider } from "./support/providers.js";

describe("NestBatchPollingModule / NestBatchPollingModule", () => {
  it("creates polling-only providers without batch storage / batch storage 없이 polling 전용 provider를 생성한다", () => {
    const pollingWorkers = [
      {
        workerId: "vote-outbox-worker-1",
        pollIntervalMs: 1_000,
        autoStart: false,
        task: () => 0
      }
    ];
    const dynamicModule = NestBatchPollingModule.forRoot({ pollingWorkers });
    const providers = dynamicModule.providers ?? [];

    expect(dynamicModule.module).toBe(NestBatchPollingModule);
    expect(findValueProvider(providers, BATCH_POLLING_WORKERS).useValue).toBe(pollingWorkers);
    expect(hasProvider(providers, DatabaseBatchStorage)).toBe(false);
    expect(hasProvider(providers, BATCH_RUNNER)).toBe(false);
    expect(hasProvider(providers, BATCH_JOB_REPOSITORY)).toBe(false);
    expect(hasProvider(providers, BATCH_CHECKPOINT_STORE)).toBe(false);
    expect(hasProvider(providers, BATCH_LOCK_MANAGER)).toBe(false);
    expect(hasProvider(providers, BATCH_SCHEDULE_STORE)).toBe(false);
    expect(hasProvider(providers, BATCH_SCHEDULES)).toBe(false);
    expect(hasProvider(providers, BATCH_SCHEDULER_LOOP)).toBe(false);
  });

  it("starts multiple autoStart workers from forRootAsync / forRootAsync에서 여러 autoStart worker를 시작한다", async () => {
    const config = {
      workerIdPrefix: "vote-outbox"
    };
    const started: string[] = [];
    const observedSignals: AbortSignal[] = [];

    @Module({
      providers: [{ provide: "CONFIG", useValue: config }],
      exports: ["CONFIG"]
    })
    class ConfigModule {}

    @Module({
      imports: [
        NestBatchPollingModule.forRootAsync({
          imports: [ConfigModule],
          inject: ["CONFIG"],
          useFactory: (nextConfig: typeof config) => ({
            pollingWorkers: [
              {
                workerId: `${nextConfig.workerIdPrefix}-1`,
                pollIntervalMs: 60_000,
                autoStart: true,
                task: ({ workerId, signal }) => {
                  started.push(workerId);
                  observedSignals.push(signal);
                  return 0;
                }
              },
              {
                workerId: `${nextConfig.workerIdPrefix}-2`,
                pollIntervalMs: 60_000,
                autoStart: true,
                task: ({ workerId, signal }) => {
                  started.push(workerId);
                  observedSignals.push(signal);
                  return 0;
                }
              },
              {
                workerId: `${nextConfig.workerIdPrefix}-manual`,
                pollIntervalMs: 60_000,
                autoStart: false,
                task: ({ workerId }) => {
                  started.push(workerId);
                  return 0;
                }
              }
            ]
          })
        })
      ]
    })
    class TestModule {}

    const app = await NestFactory.createApplicationContext(TestModule, {
      abortOnError: false,
      logger: false
    });

    try {
      expect(started).toEqual(["vote-outbox-1", "vote-outbox-2"]);
      expect(observedSignals).toHaveLength(2);
      expect(observedSignals.every((signal) => !signal.aborted)).toBe(true);
    } finally {
      await app.close();
    }

    expect(observedSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it("waits for in-flight polling work on shutdown / shutdown에서 진행 중인 polling 작업을 기다린다", async () => {
    let resolveTask: ((value: number) => void) | undefined;
    let closed = false;

    @Module({
      imports: [
        NestBatchPollingModule.forRoot({
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

  it("does not require batch storage providers / batch storage provider를 요구하지 않는다", async () => {
    @Module({
      imports: [
        NestBatchPollingModule.forRoot({
          pollingWorkers: [
            {
              workerId: "vote-outbox-worker-1",
              pollIntervalMs: 60_000,
              autoStart: true,
              task: () => 0
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
      expect(() => app.get(DatabaseBatchStorage, { strict: false })).toThrow();
      expect(() => app.get(BATCH_RUNNER, { strict: false })).toThrow();
      expect(() => app.get(BATCH_JOB_REPOSITORY, { strict: false })).toThrow();
      expect(() => app.get(BATCH_CHECKPOINT_STORE, { strict: false })).toThrow();
      expect(() => app.get(BATCH_LOCK_MANAGER, { strict: false })).toThrow();
      expect(() => app.get(BATCH_SCHEDULE_STORE, { strict: false })).toThrow();
      expect(() => app.get(BATCH_SCHEDULES, { strict: false })).toThrow();
      expect(() => app.get(BATCH_SCHEDULER_LOOP, { strict: false })).toThrow();
    } finally {
      await app.close();
    }
  });
});

const hasProvider = (providers: readonly unknown[], token: unknown): boolean =>
  providers.some((provider) => {
    if (provider === token) {
      return true;
    }

    return typeof provider === "object" && provider !== null && "provide" in provider && provider.provide === token;
  });
