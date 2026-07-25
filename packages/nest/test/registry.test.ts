import "reflect-metadata";
import { defineStep } from "@nest-batch/core";
import { InMemoryBatchStorage } from "@nest-batch/inmemory";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import {
  BatchJob,
  BatchProcessor,
  BatchReader,
  BatchStep,
  BatchWriter,
  NestBatchModule,
  NestBatchRegistry,
  NestBatchRunner
} from "../src/index.js";

describe("NestBatchRegistry / NestBatchRegistry", () => {
  it("discovers decorated jobs and components / decorator가 붙은 job과 component를 발견한다", async () => {
    const storage = new InMemoryBatchStorage();

    class BillingReader {}
    class BillingProcessor {}
    class BillingWriter {}
    class BillingJob {
      chargeAccounts() {
        return defineStep({
          name: "internal-charge-step",
          execute() {
            return "charged";
          }
        });
      }
    }

    BatchReader("billing-reader")(BillingReader);
    BatchProcessor("billing-processor")(BillingProcessor);
    BatchWriter("billing-writer")(BillingWriter);
    BatchJob("daily-billing")(BillingJob);
    const stepDescriptor = Object.getOwnPropertyDescriptor(BillingJob.prototype, "chargeAccounts");

    if (!stepDescriptor) {
      throw new Error("Step descriptor was not found.");
    }

    BatchStep("charge-accounts")(BillingJob.prototype, "chargeAccounts", stepDescriptor);

    @Module({
      imports: [NestBatchModule.forRoot({ storage })],
      providers: [BillingReader, BillingProcessor, BillingWriter, BillingJob]
    })
    class TestModule {}

    const app = await NestFactory.createApplicationContext(TestModule, {
      abortOnError: false,
      logger: false
    });

    try {
      const registry = app.get(NestBatchRegistry);

      expect(registry.getJobs()).toEqual([
        expect.objectContaining({
          name: "daily-billing",
          steps: [
            expect.objectContaining({
              name: "charge-accounts"
            })
          ]
        })
      ]);
      expect(registry.getReader("billing-reader")?.instance).toBeInstanceOf(BillingReader);
      expect(registry.getProcessor("billing-processor")?.instance).toBeInstanceOf(BillingProcessor);
      expect(registry.getWriter("billing-writer")?.instance).toBeInstanceOf(BillingWriter);
    } finally {
      await app.close();
    }
  });

  it("runs a discovered job by name / 발견한 job을 이름으로 실행한다", async () => {
    const storage = new InMemoryBatchStorage();
    const executed: string[] = [];

    class BillingJob {
      chargeAccounts() {
        return defineStep({
          name: "charge-accounts",
          execute() {
            executed.push("charge-accounts");
            return "charged";
          }
        });
      }
    }

    BatchJob("daily-billing")(BillingJob);
    const stepDescriptor = Object.getOwnPropertyDescriptor(BillingJob.prototype, "chargeAccounts");

    if (!stepDescriptor) {
      throw new Error("Step descriptor was not found.");
    }

    BatchStep()(BillingJob.prototype, "chargeAccounts", stepDescriptor);

    @Module({
      imports: [
        NestBatchModule.forRoot({
          storage,
          runner: {
            ownerId: "default-owner"
          }
        })
      ],
      providers: [BillingJob]
    })
    class TestModule {}

    const app = await NestFactory.createApplicationContext(TestModule, {
      abortOnError: false,
      logger: false
    });

    try {
      const runner = app.get(NestBatchRunner);
      const execution = await runner.run(
        "daily-billing",
        { tenant: "acme" },
        { executionId: "nestjs-discovered-execution" }
      );

      expect(execution).toMatchObject({
        id: "nestjs-discovered-execution",
        jobName: "daily-billing",
        status: "completed"
      });
      expect(executed).toEqual(["charge-accounts"]);
    } finally {
      await app.close();
    }
  });
});
