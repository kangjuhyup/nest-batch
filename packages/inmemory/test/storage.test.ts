import { DatabaseBatchStorage } from "@nest-batch/core";
import type { JobExecution, JobInstance, StepExecution } from "@nest-batch/core";
import { describe, expect, it } from "vitest";
import {
  InMemoryBatchStorage,
  InMemoryCheckpointStore,
  InMemoryJobRepository,
  InMemoryLockManager
} from "../src/index.js";

const createInstance = (overrides: Partial<JobInstance> = {}): JobInstance => ({
  id: "instance-1",
  jobName: "daily-user-import",
  parametersHash: "sha256:parameters",
  parameters: { tenant: "acme" },
  createdAt: new Date("2026-07-19T00:00:00.000Z"),
  ...overrides
});

const createExecution = (overrides: Partial<JobExecution> = {}): JobExecution => ({
  id: "execution-1",
  instanceId: "instance-1",
  jobName: "daily-user-import",
  status: "created",
  parameters: { tenant: "acme" },
  createdAt: new Date("2026-07-19T00:00:00.000Z"),
  ...overrides
});

const createStepExecution = (overrides: Partial<StepExecution> = {}): StepExecution => ({
  id: "step-execution-1",
  jobExecutionId: "execution-1",
  stepName: "load-users",
  status: "created",
  readCount: 0,
  writeCount: 0,
  skipCount: 0,
  retryCount: 0,
  createdAt: new Date("2026-07-19T00:00:00.000Z"),
  ...overrides
});

describe("inmemory batch storage / inmemory batch storage를 검증한다", () => {
  it("implements DatabaseBatchStorage with inmemory adapters / inmemory adapter로 DatabaseBatchStorage를 구현한다", () => {
    const storage = new InMemoryBatchStorage();

    expect(storage).toBeInstanceOf(DatabaseBatchStorage);
    expect(storage.repository).toBeInstanceOf(InMemoryJobRepository);
    expect(storage.checkpointStore).toBeInstanceOf(InMemoryCheckpointStore);
    expect(storage.lockManager).toBeInstanceOf(InMemoryLockManager);
  });

  it("stores job instances executions and step executions / job instance execution step execution을 저장한다", async () => {
    const repository = new InMemoryJobRepository();
    const instance = createInstance();
    const createdAt = new Date("2026-07-19T00:00:00.000Z");
    const startedAt = new Date("2026-07-19T00:01:00.000Z");
    const endedAt = new Date("2026-07-19T00:02:00.000Z");

    await expect(repository.createJobInstance(instance)).resolves.toEqual(instance);
    await expect(repository.findJobInstance("daily-user-import", "sha256:parameters")).resolves.toEqual(instance);

    await repository.create(createExecution({ createdAt }));
    await expect(repository.findActiveJobExecution("instance-1")).resolves.toEqual(createExecution({ createdAt }));

    await repository.update(createExecution({ status: "completed", createdAt, startedAt, endedAt }));
    await expect(repository.findById("execution-1")).resolves.toEqual(
      createExecution({ status: "completed", createdAt, startedAt, endedAt })
    );
    await expect(repository.findActiveJobExecution("instance-1")).resolves.toBeUndefined();

    await repository.create(
      createExecution({
        id: "failed-execution-1",
        status: "failed",
        createdAt: new Date("2026-07-19T00:03:00.000Z")
      })
    );
    await repository.create(
      createExecution({
        id: "failed-execution-2",
        status: "failed",
        createdAt: new Date("2026-07-19T00:04:00.000Z"),
        failureReason: "writer unavailable"
      })
    );
    await expect(repository.findLatestFailedJobExecution("instance-1")).resolves.toEqual(
      createExecution({
        id: "failed-execution-2",
        status: "failed",
        createdAt: new Date("2026-07-19T00:04:00.000Z"),
        failureReason: "writer unavailable"
      })
    );

    await repository.createStepExecution(createStepExecution());
    await repository.updateStepExecution(
      createStepExecution({
        status: "completed",
        readCount: 3,
        writeCount: 2,
        skipCount: 1,
        endedAt
      })
    );

    await expect(repository.findStepExecutions("execution-1")).resolves.toEqual([
      createStepExecution({
        status: "completed",
        readCount: 3,
        writeCount: 2,
        skipCount: 1,
        endedAt
      })
    ]);
  });

  it("stores reads and deletes checkpoints / checkpoint를 저장 조회 삭제한다", async () => {
    const store = new InMemoryCheckpointStore();

    await store.write("execution-1", "load-users", { cursor: 20 });
    await expect(store.read("execution-1", "load-users")).resolves.toEqual({ cursor: 20 });

    await store.delete("execution-1", "load-users");
    await expect(store.read("execution-1", "load-users")).resolves.toBeUndefined();
  });

  it("acquires renews releases and expires locks / lock 획득 갱신 해제 만료를 처리한다", async () => {
    const lockManager = new InMemoryLockManager();

    const handle = await lockManager.acquire("job:daily-user-import", "worker-1", { ttlMs: 10 });
    expect(handle).toMatchObject({
      resource: "job:daily-user-import",
      ownerId: "worker-1",
      expiresAt: expect.any(Date)
    });
    await expect(lockManager.acquire("job:daily-user-import", "worker-2")).resolves.toBeUndefined();

    const renewed = await lockManager.acquire("job:daily-user-import", "worker-1", { ttlMs: 10 });
    expect(renewed?.ownerId).toBe("worker-1");

    await lockManager.release({ resource: "job:daily-user-import", ownerId: "worker-2" });
    await expect(lockManager.acquire("job:daily-user-import", "worker-2")).resolves.toBeUndefined();

    await lockManager.release({ resource: "job:daily-user-import", ownerId: "worker-1" });
    await expect(lockManager.acquire("job:daily-user-import", "worker-2")).resolves.toMatchObject({
      resource: "job:daily-user-import",
      ownerId: "worker-2"
    });

    await expect(lockManager.acquire("job:expiring-import", "worker-1", { ttlMs: 1 })).resolves.toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(lockManager.acquire("job:expiring-import", "worker-2")).resolves.toMatchObject({
      resource: "job:expiring-import",
      ownerId: "worker-2"
    });
  });

  it("rejects invalid lock ttl values / 잘못된 lock ttl 값을 거부한다", async () => {
    const lockManager = new InMemoryLockManager();

    await expect(lockManager.acquire("job:daily-user-import", "worker-1", { ttlMs: 0 })).rejects.toThrow(
      "InMemory lock ttlMs must be a positive safe integer."
    );
  });
});
