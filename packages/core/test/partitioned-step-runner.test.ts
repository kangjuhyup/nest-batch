import { InMemoryBatchStorage } from "@rv-nest-batch/inmemory";
import { describe, expect, it } from "vitest";
import { DefaultBatchRunner, defineJob, definePartitionedStep } from "../src/index.js";

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("partitioned step runner / partitioned step runner", () => {
  it("runs partitions with max concurrency / max concurrency로 partition을 실행한다", async () => {
    const storage = new InMemoryBatchStorage();
    const activeCounts: number[] = [];
    let active = 0;
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "partition-job-execution",
      generateStepExecutionId: ({ stepName }) => `partition-job-execution:${stepName}`,
      generateOwnerId: () => "partition-worker",
      now: () => new Date("2026-07-25T00:00:00.000Z")
    });
    const step = definePartitionedStep({
      name: "partition-users",
      maxConcurrency: 2,
      partitions: () => [{ shard: 0 }, { shard: 1 }, { shard: 2 }],
      async execute(partition) {
        active += 1;
        activeCounts.push(active);

        try {
          await delay(10);
          return {
            readCount: 10,
            writeCount: 9,
            skipCount: 1,
            retryCount: partition.shard
          };
        } finally {
          active -= 1;
        }
      }
    });

    const execution = await runner.run(defineJob({ name: "partition-job", steps: [step] }), {});
    const [stepExecution] = await storage.repository.findStepExecutions(execution.id);
    const partitions = await storage.repository.findPartitionExecutions(stepExecution.id);

    expect(execution.status).toBe("completed");
    expect(Math.max(...activeCounts)).toBe(2);
    expect(stepExecution).toMatchObject({
      status: "completed",
      readCount: 30,
      writeCount: 27,
      skipCount: 3,
      retryCount: 3
    });
    expect(partitions).toHaveLength(3);
    expect(partitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "completed", partition: { shard: 0 } }),
        expect.objectContaining({ status: "completed", partition: { shard: 1 } }),
        expect.objectContaining({ status: "completed", partition: { shard: 2 } })
      ])
    );
  });
});
