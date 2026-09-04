import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { SchedulerLoop } from "@nest-batch/core/scheduler";
import { describe, expect, it, vi } from "vitest";
import { NestBatchModule } from "../src/index.js";
import { FakeDatabaseBatchStorage } from "./support/providers.js";

describe("Nest scheduler lifecycle / Nest scheduler lifecycle를 검증한다", () => {
  it("starts the scheduler loop on bootstrap when autoStart is enabled / autoStart가 켜지면 bootstrap에서 scheduler loop를 시작한다", async () => {
    const storage = new FakeDatabaseBatchStorage();
    const observedSignals: AbortSignal[] = [];
    const schedulerLoop = {
      runUntilStopped: vi.fn(async (options?: { readonly signal?: AbortSignal }) => {
        if (options?.signal) {
          observedSignals.push(options.signal);
        }
      })
    } as Pick<SchedulerLoop, "runUntilStopped"> as SchedulerLoop;

    @Module({
      imports: [
        NestBatchModule.forRoot({
          storage,
          schedulerLoop,
          scheduler: { autoStart: true }
        })
      ]
    })
    class TestModule {}

    const app = await NestFactory.createApplicationContext(TestModule, {
      abortOnError: false,
      logger: false
    });

    try {
      expect(schedulerLoop.runUntilStopped).toHaveBeenCalledTimes(1);
      expect(observedSignals).toHaveLength(1);
      expect(observedSignals[0]?.aborted).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("aborts the scheduler loop on shutdown / shutdown에서 scheduler loop를 abort한다", async () => {
    const storage = new FakeDatabaseBatchStorage();
    const observedSignals: AbortSignal[] = [];
    const schedulerLoop = {
      runUntilStopped: vi.fn(async (options?: { readonly signal?: AbortSignal }) => {
        if (options?.signal) {
          observedSignals.push(options.signal);
        }
      })
    } as Pick<SchedulerLoop, "runUntilStopped"> as SchedulerLoop;

    @Module({
      imports: [
        NestBatchModule.forRoot({
          storage,
          schedulerLoop,
          scheduler: { autoStart: true }
        })
      ]
    })
    class TestModule {}

    const app = await NestFactory.createApplicationContext(TestModule, {
      abortOnError: false,
      logger: false
    });

    expect(observedSignals[0]?.aborted).toBe(false);

    await app.close();

    expect(observedSignals[0]?.aborted).toBe(true);
  });

  it("waits for the scheduler loop to stop on shutdown / shutdown에서 scheduler loop 정지를 기다린다", async () => {
    const storage = new FakeDatabaseBatchStorage();
    let stopped = false;
    const schedulerLoop = {
      runUntilStopped: vi.fn(
        (options?: { readonly signal?: AbortSignal }) =>
          new Promise<void>((resolve) => {
            options?.signal?.addEventListener(
              "abort",
              () => {
                setTimeout(() => {
                  stopped = true;
                  resolve();
                }, 0);
              },
              { once: true }
            );
          })
      )
    } as Pick<SchedulerLoop, "runUntilStopped"> as SchedulerLoop;

    @Module({
      imports: [
        NestBatchModule.forRoot({
          storage,
          schedulerLoop,
          scheduler: { autoStart: true }
        })
      ]
    })
    class TestModule {}

    const app = await NestFactory.createApplicationContext(TestModule, {
      abortOnError: false,
      logger: false
    });

    await app.close();

    expect(stopped).toBe(true);
  });

  it("rejects autoStart without a scheduler loop / scheduler loop 없이 autoStart를 켜면 거부한다", async () => {
    const storage = new FakeDatabaseBatchStorage();

    @Module({
      imports: [
        NestBatchModule.forRoot({
          storage,
          scheduler: { autoStart: true }
        })
      ]
    })
    class TestModule {}

    await expect(
      NestFactory.createApplicationContext(TestModule, {
        abortOnError: false,
        logger: false
      })
    ).rejects.toThrow("NestBatchModule scheduler autoStart requires a SchedulerLoop provider.");
  });

  it("does nothing when autoStart is disabled / autoStart가 꺼져 있으면 아무 작업도 하지 않는다", async () => {
    const storage = new FakeDatabaseBatchStorage();
    const schedulerLoop = {
      runUntilStopped: vi.fn(async () => undefined)
    } as Pick<SchedulerLoop, "runUntilStopped"> as SchedulerLoop;

    @Module({
      imports: [
        NestBatchModule.forRoot({
          storage,
          schedulerLoop,
          scheduler: { autoStart: false }
        })
      ]
    })
    class TestModule {}

    const app = await NestFactory.createApplicationContext(TestModule, {
      abortOnError: false,
      logger: false
    });

    try {
      expect(schedulerLoop.runUntilStopped).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
