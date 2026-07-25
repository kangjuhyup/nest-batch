import { describe, expect, it } from "vitest";
import { InMemoryBatchStorage, InMemoryExecutionContextStore } from "../src/index.js";

describe("inmemory execution context store / inmemory execution context store를 검증한다", () => {
  it("connects execution context store to batch storage / batch storage에 execution context store를 연결한다", () => {
    const storage = new InMemoryBatchStorage();

    expect(storage.executionContextStore).toBeInstanceOf(InMemoryExecutionContextStore);
  });

  it("stores merges and deletes execution context independently from checkpoints / checkpoint와 분리해서 execution context를 저장 병합 삭제한다", async () => {
    const storage = new InMemoryBatchStorage();
    const key = {
      executionId: "execution-1",
      scope: "step" as const,
      name: "copy-users"
    };

    await storage.checkpointStore.write("execution-1", "copy-users", { cursor: 10 });
    await storage.executionContextStore.write(key, { tenantId: "acme", processed: 10 });
    const merged = await storage.executionContextStore.merge(key, { processed: 20 });
    await storage.executionContextStore.delete(key);

    expect(merged).toEqual({ tenantId: "acme", processed: 20 });
    await expect(storage.executionContextStore.read(key)).resolves.toBeUndefined();
    await expect(storage.checkpointStore.read("execution-1", "copy-users")).resolves.toEqual({ cursor: 10 });
  });

  it("allows restart flows to copy failed execution context into a new execution / restart 시 실패 execution context를 새 execution으로 이어 쓴다", async () => {
    const store = new InMemoryExecutionContextStore();
    const failedKey = {
      executionId: "failed-execution",
      scope: "step" as const,
      name: "copy-users"
    };
    const restartKey = {
      ...failedKey,
      executionId: "restart-execution"
    };

    await store.write(failedKey, { lastProcessedId: 100 });
    const failedContext = await store.read(failedKey);
    await store.write(restartKey, failedContext);

    await expect(store.read(restartKey)).resolves.toEqual({ lastProcessedId: 100 });
  });

  it("rejects undefined execution context values / undefined execution context 값을 거부한다", async () => {
    const store = new InMemoryExecutionContextStore();

    await expect(
      store.write({
        executionId: "execution-1",
        scope: "job",
        name: "billing"
      }, undefined)
    ).rejects.toThrow("InMemory execution context only supports JSON-serializable values.");
  });
});
