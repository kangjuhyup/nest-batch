import "reflect-metadata";
import { DefaultBatchRunner, defineJob } from "@nest-batch/core";
import { NestFactory } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { exampleBatchStorage } from "../src/infrastructure/batch/example-batch-storage.js";
import { BillingJob } from "../src/jobs/billing/billing.job.js";
import { writtenCharges } from "../src/jobs/billing/billing.step.js";

describe("nestjs example e2e / nestjs example e2e를 검증한다", () => {
  it("boots the app context and runs the billing job / app context를 부팅하고 billing job을 실행한다", async () => {
    const executionId = "nestjs-example-e2e-execution-1";
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const runner = new DefaultBatchRunner(exampleBatchStorage, {
      generateExecutionId: () => executionId,
      generateOwnerId: () => "nestjs-example-worker-1",
      now: () => new Date("2026-07-19T00:00:00.000Z")
    });
    writtenCharges.length = 0;

    try {
      const billingJob = app.get(BillingJob);
      const execution = await runner.run(
        defineJob({
          name: "daily-billing",
          steps: [billingJob.chargeAccounts()]
        }),
        { tenant: "acme", run: executionId },
        { executionId }
      );

      expect(execution).toMatchObject({
        id: executionId,
        jobName: "daily-billing",
        status: "completed"
      });
      expect(writtenCharges).toEqual([{ accountId: "account-1", amount: 1200 }]);
    } finally {
      await app.close();
    }
  });
});
