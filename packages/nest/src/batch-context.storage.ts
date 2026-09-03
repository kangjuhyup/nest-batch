import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";
import type { NestBatchExecutionContext } from "./batch-context.types.js";

@Injectable()
export class BatchContextStorage {
  private readonly storage = new AsyncLocalStorage<NestBatchExecutionContext>();

  get(): NestBatchExecutionContext | undefined {
    return this.storage.getStore();
  }

  run<TContext extends NestBatchExecutionContext, TResult>(
    context: TContext,
    callback: () => TResult
  ): TResult {
    return this.storage.run(context, callback);
  }
}
