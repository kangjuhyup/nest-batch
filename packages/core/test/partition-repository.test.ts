import { InMemoryJobRepository } from "@nest-batch/inmemory";
import { describe, expect, it } from "vitest";
import type { PartitionExecution } from "../src/index.js";

interface TestPartition {
  readonly shard: number;
}

const createPartition = (
  overrides: Partial<PartitionExecution<TestPartition>> = {}
): PartitionExecution<TestPartition> => ({
  id: "partition-1",
  stepExecutionId: "step-execution-1",
  stepName: "load-users",
  status: "created",
  partition: { shard: 0 },
  readCount: 0,
  writeCount: 0,
  skipCount: 0,
  retryCount: 0,
  createdAt: new Date("2026-07-25T00:00:00.000Z"),
  ...overrides
});

describe("partition repository contract / partition repository contract", () => {
  it("claims one pending partition at a time / pending partition을 하나씩 claim한다", async () => {
    const repository = new InMemoryJobRepository();
    const claimedAt = new Date("2026-07-25T00:01:00.000Z");

    await repository.createPartitionExecution(createPartition());
    await repository.createPartitionExecution(
      createPartition({
        id: "partition-2",
        partition: { shard: 1 },
        createdAt: new Date("2026-07-25T00:00:01.000Z")
      })
    );

    const first = await repository.claimPartitionExecution({
      stepExecutionId: "step-execution-1",
      ownerId: "worker-1",
      now: claimedAt
    });

    expect(first).toMatchObject({
      id: "partition-1",
      status: "running",
      ownerId: "worker-1",
      startedAt: claimedAt
    });

    const second = await repository.claimPartitionExecution({
      stepExecutionId: "step-execution-1",
      ownerId: "worker-2",
      now: new Date("2026-07-25T00:01:01.000Z")
    });

    expect(second).toMatchObject({
      id: "partition-2",
      status: "running",
      ownerId: "worker-2"
    });
    await expect(
      repository.claimPartitionExecution({
        stepExecutionId: "step-execution-1",
        ownerId: "worker-3",
        now: new Date("2026-07-25T00:01:02.000Z")
      })
    ).resolves.toBeUndefined();
  });
});
