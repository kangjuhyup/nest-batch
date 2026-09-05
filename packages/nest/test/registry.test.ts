import "reflect-metadata";
import { defineStep } from "@rvkang/batch-core";
import type { JobParameters, StepExecutionContext } from "@rvkang/batch-core";
import { InMemoryBatchStorage } from "@rvkang/batch-inmemory";
import { Inject, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import {
  BatchContextAccessor,
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
  type BillingParameters = JobParameters & { readonly tenant: string };

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
    const receivedContexts: Array<{
      readonly jobName: string;
      readonly jobExecutionId: string;
      readonly stepName: string;
      readonly parameters: { readonly tenant: string };
      readonly restart: boolean;
    }> = [];
    const accessorContexts: Array<{
      readonly jobName: string;
      readonly jobExecutionId: string;
      readonly stepName: string;
      readonly parameters: BillingParameters;
      readonly checkpoint: unknown;
      readonly signalAborted: boolean;
    }> = [];

    class BillingJob {
      constructor(@Inject(BatchContextAccessor) private readonly batchContext: BatchContextAccessor) {}

      chargeAccounts() {
        const batchContext = this.batchContext;

        return defineStep<unknown, string, BillingParameters>({
          name: "charge-accounts",
          execute(context) {
            const accessorContext = batchContext.getRequiredContext<
              StepExecutionContext<unknown, BillingParameters>
            >();
            const parameters = batchContext.getRequiredParameters<BillingParameters>();
            const signal = batchContext.getRequiredSignal();

            accessorContexts.push({
              jobName: accessorContext.jobName,
              jobExecutionId: accessorContext.jobExecutionId,
              stepName: accessorContext.stepName,
              parameters,
              checkpoint: batchContext.getCheckpoint(),
              signalAborted: signal.aborted
            });
            receivedContexts.push({
              jobName: context.jobName,
              jobExecutionId: context.jobExecutionId,
              stepName: context.stepName,
              parameters: context.parameters,
              restart: context.restart
            });
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
      const batchContext = app.get(BatchContextAccessor);

      expect(batchContext.getContext()).toBeUndefined();
      expect(batchContext.getCheckpoint()).toBeUndefined();
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
      expect(receivedContexts).toEqual([
        {
          jobName: "daily-billing",
          jobExecutionId: "nestjs-discovered-execution",
          stepName: "charge-accounts",
          parameters: { tenant: "acme" },
          restart: false
        }
      ]);
      expect(accessorContexts).toEqual([
        {
          jobName: "daily-billing",
          jobExecutionId: "nestjs-discovered-execution",
          stepName: "charge-accounts",
          parameters: { tenant: "acme" },
          checkpoint: undefined,
          signalAborted: false
        }
      ]);
      expect(batchContext.getContext()).toBeUndefined();
      expect(batchContext.getCheckpoint()).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
