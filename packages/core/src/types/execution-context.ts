import type { BatchExecutionId } from "./common.js";

export type ExecutionContextScope = "job" | "step";

export interface ExecutionContextKey {
  readonly executionId: BatchExecutionId;
  readonly scope: ExecutionContextScope;
  readonly name: string;
}

export interface ExecutionContextStore {
  read<TContext = unknown>(key: ExecutionContextKey): Promise<TContext | undefined>;
  write<TContext = unknown>(key: ExecutionContextKey, context: TContext): Promise<void>;
  merge<TContext extends Record<string, unknown> = Record<string, unknown>>(
    key: ExecutionContextKey,
    patch: Readonly<Partial<TContext>>
  ): Promise<TContext>;
  delete(key: ExecutionContextKey): Promise<void>;
}
