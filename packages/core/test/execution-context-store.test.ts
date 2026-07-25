import { describe, expect, it } from "vitest";
import type {
  ExecutionContextKey,
  ExecutionContextStore
} from "../src/index.js";

class RecordingExecutionContextStore implements ExecutionContextStore {
  private readonly contexts = new Map<string, unknown>();

  async read<TContext = unknown>(key: ExecutionContextKey): Promise<TContext | undefined> {
    return this.contexts.get(this.createKey(key)) as TContext | undefined;
  }

  async write<TContext = unknown>(key: ExecutionContextKey, context: TContext): Promise<void> {
    if (context === undefined) {
      throw new TypeError("Execution context cannot be undefined.");
    }

    this.contexts.set(this.createKey(key), structuredClone(context));
  }

  async merge<TContext extends Record<string, unknown>>(
    key: ExecutionContextKey,
    patch: Readonly<Partial<TContext>>
  ): Promise<TContext> {
    const current = await this.read<Record<string, unknown>>(key);
    const merged = {
      ...(current ?? {}),
      ...patch
    } as TContext;

    await this.write(key, merged);

    return merged;
  }

  async delete(key: ExecutionContextKey): Promise<void> {
    this.contexts.delete(this.createKey(key));
  }

  private createKey(key: ExecutionContextKey): string {
    return `${key.executionId}:${key.scope}:${key.name}`;
  }
}

describe("execution context store contract / execution context store contract를 검증한다", () => {
  it("stores job and step scoped context separately / job과 step scope context를 분리해서 저장한다", async () => {
    const store = new RecordingExecutionContextStore();
    const jobKey: ExecutionContextKey = {
      executionId: "execution-1",
      scope: "job",
      name: "billing"
    };
    const stepKey: ExecutionContextKey = {
      executionId: "execution-1",
      scope: "step",
      name: "billing"
    };

    await store.write(jobKey, { tenantId: "acme" });
    await store.write(stepKey, { cursor: 10 });

    await expect(store.read(jobKey)).resolves.toEqual({ tenantId: "acme" });
    await expect(store.read(stepKey)).resolves.toEqual({ cursor: 10 });
  });

  it("merges JSON object context and deletes by key / JSON object context를 병합하고 key로 삭제한다", async () => {
    const store = new RecordingExecutionContextStore();
    const key: ExecutionContextKey = {
      executionId: "execution-1",
      scope: "step",
      name: "copy-users"
    };

    await store.write(key, { cursor: 10, tenantId: "acme" });
    const merged = await store.merge(key, { cursor: 20 });
    await store.delete(key);

    expect(merged).toEqual({ cursor: 20, tenantId: "acme" });
    await expect(store.read(key)).resolves.toBeUndefined();
  });
});
