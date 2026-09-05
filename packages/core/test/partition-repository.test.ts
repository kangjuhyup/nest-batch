import { InMemoryJobRepository } from "@rv-nest-batch/inmemory";
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

  it("recovers stale running partitions / 오래된 running partition을 회수한다", async () => {
    const repository = new InMemoryJobRepository();
    const heartbeatAt = new Date("2026-07-25T00:00:00.000Z");
    const claimedAt = new Date("2026-07-25T00:01:00.000Z");

    await repository.createPartitionExecution(
      createPartition({
        status: "running",
        ownerId: "dead-worker",
        heartbeatAt,
        startedAt: heartbeatAt
      })
    );

    await expect(
      repository.claimPartitionExecution({
        stepExecutionId: "step-execution-1",
        ownerId: "worker-2",
        staleAfterMs: 30_000,
        now: claimedAt
      })
    ).resolves.toMatchObject({
      id: "partition-1",
      status: "running",
      ownerId: "worker-2",
      heartbeatAt: claimedAt,
      claimExpiresAt: new Date("2026-07-25T00:01:30.000Z")
    });
  });

  it("does not recover fresh running partitions / 최신 running partition은 회수하지 않는다", async () => {
    const repository = new InMemoryJobRepository();

    await repository.createPartitionExecution(
      createPartition({
        status: "running",
        ownerId: "worker-1",
        heartbeatAt: new Date("2026-07-25T00:00:45.000Z"),
        startedAt: new Date("2026-07-25T00:00:00.000Z")
      })
    );

    await expect(
      repository.claimPartitionExecution({
        stepExecutionId: "step-execution-1",
        ownerId: "worker-2",
        staleAfterMs: 30_000,
        now: new Date("2026-07-25T00:01:00.000Z")
      })
    ).resolves.toBeUndefined();
  });

  it("updates heartbeat only for current owner / 현재 owner만 heartbeat를 갱신한다", async () => {
    const repository = new InMemoryJobRepository();
    const heartbeatAt = new Date("2026-07-25T00:01:00.000Z");

    await repository.createPartitionExecution(
      createPartition({
        status: "running",
        ownerId: "worker-1"
      })
    );

    await expect(
      repository.heartbeatPartitionExecution("partition-1", "worker-2", heartbeatAt)
    ).resolves.toBe(false);
    await expect(
      repository.heartbeatPartitionExecution("partition-1", "worker-1", heartbeatAt)
    ).resolves.toBe(true);
    await expect(repository.findPartitionExecutions("step-execution-1")).resolves.toMatchObject([
      {
        id: "partition-1",
        heartbeatAt
      }
    ]);
  });

  it("completes only when owner matches / owner가 일치할 때만 완료한다", async () => {
    const repository = new InMemoryJobRepository();
    const running = createPartition({
      status: "running",
      ownerId: "worker-1",
      startedAt: new Date("2026-07-25T00:01:00.000Z")
    });

    await repository.createPartitionExecution(running);

    await expect(
      repository.completePartitionExecution({ ...running, status: "completed" }, "worker-2")
    ).resolves.toBe(false);
    await expect(
      repository.completePartitionExecution({ ...running, status: "completed" }, "worker-1")
    ).resolves.toBe(true);
  });
});
