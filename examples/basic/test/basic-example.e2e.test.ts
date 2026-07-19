import { DefaultBatchRunner } from "@nest-batch/core";
import { describe, expect, it } from "vitest";
import { dailyUserImport, writtenUsers } from "../src/index.js";
import { InMemoryBatchStorage } from "./support/in-memory-batch-storage.js";

describe("basic example e2e / basic example e2e를 검증한다", () => {
  it("runs the exported import job / export된 import job을 실행한다", async () => {
    const storage = new InMemoryBatchStorage();
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "basic-example-e2e-execution-1",
      generateOwnerId: () => "basic-example-worker-1",
      now: () => new Date("2026-07-19T00:00:00.000Z")
    });
    writtenUsers.length = 0;

    const execution = await runner.run(dailyUserImport, { tenant: "acme" });

    expect(execution).toMatchObject({
      id: "basic-example-e2e-execution-1",
      jobName: "daily-user-import",
      status: "completed"
    });
    expect(writtenUsers).toEqual([{ id: "user-1" }]);
    await expect(storage.repository.findStepExecutions(execution.id)).resolves.toEqual([
      expect.objectContaining({
        stepName: "import-users",
        status: "completed",
        readCount: 2,
        writeCount: 1,
        skipCount: 1
      })
    ]);
  });
});
