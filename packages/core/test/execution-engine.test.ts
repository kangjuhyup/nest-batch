import { InMemoryBatchStorage } from "@rvkang/batch-inmemory";
import { describe, expect, it } from "vitest";
import { DefaultBatchRunner, defineJob, defineStep } from "../src/index.js";
import type { ExecutionEngine } from "../src/index.js";

describe("execution engine contract / execution engine contract", () => {
  it("uses DefaultBatchRunner as an execution engine / DefaultBatchRunner를 execution engine으로 사용한다", async () => {
    const storage = new InMemoryBatchStorage();
    const engine: ExecutionEngine = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "engine-execution-1",
      generateStepExecutionId: ({ stepName }) => `engine-execution-1:${stepName}`,
      generateOwnerId: () => "engine-worker-1",
      now: () => new Date("2026-07-25T00:00:00.000Z")
    });
    const job = defineJob({
      name: "engine-contract-job",
      steps: [
        defineStep({
          name: "load-users",
          execute() {
            return "loaded";
          }
        })
      ]
    });

    const execution = await engine.runJob(job, {});
    const stepExecutions = await storage.repository.findStepExecutions(execution.id);

    expect(execution).toMatchObject({
      id: "engine-execution-1",
      jobName: "engine-contract-job",
      status: "completed"
    });
    expect(stepExecutions).toEqual([
      expect.objectContaining({
        id: "engine-execution-1:load-users",
        stepName: "load-users",
        status: "completed"
      })
    ]);
  });
});
