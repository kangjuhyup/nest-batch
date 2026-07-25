import type { ExecutionContextKey, ExecutionContextStore } from "@nest-batch/core";

export class InMemoryExecutionContextStore implements ExecutionContextStore {
  private readonly contexts = new Map<string, unknown>();

  async read<TContext = unknown>(key: ExecutionContextKey): Promise<TContext | undefined> {
    const context = this.contexts.get(this.createKey(key));

    return context === undefined ? undefined : cloneJson(context) as TContext;
  }

  async write<TContext = unknown>(key: ExecutionContextKey, context: TContext): Promise<void> {
    this.contexts.set(this.createKey(key), cloneJson(context));
  }

  async merge<TContext extends Record<string, unknown>>(
    key: ExecutionContextKey,
    patch: Readonly<Partial<TContext>>
  ): Promise<TContext> {
    const current = await this.read<Record<string, unknown>>(key);

    if (current !== undefined && !isPlainObject(current)) {
      throw new TypeError("InMemory execution context merge requires an object context.");
    }

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

const cloneJson = <T>(value: T): T => {
  const json = JSON.stringify(value);

  if (json === undefined) {
    throw new TypeError("InMemory execution context only supports JSON-serializable values.");
  }

  return JSON.parse(json) as T;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};
