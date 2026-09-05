import { Inject, Injectable } from "@nestjs/common";
import type { JobParameters, StepRuntimeContext } from "@rvkang/batch-core";
import { BatchContextStorage } from "./batch-context.storage.js";
import type { NestBatchExecutionContext } from "./batch-context.types.js";

@Injectable()
export class BatchContextAccessor {
  constructor(@Inject(BatchContextStorage) private readonly storage: BatchContextStorage) {}

  getContext<TContext extends NestBatchExecutionContext = NestBatchExecutionContext>(): TContext | undefined {
    return this.storage.get() as TContext | undefined;
  }

  getRequiredContext<TContext extends NestBatchExecutionContext = NestBatchExecutionContext>(): TContext {
    const context = this.getContext<TContext>();

    if (!context) {
      throw new Error("Batch context is only available while a batch callback is executing.");
    }

    return context;
  }

  getStepContext<
    Parameters extends JobParameters = JobParameters,
    TCheckpoint = unknown
  >(): StepRuntimeContext<Parameters, TCheckpoint> | undefined {
    return this.getContext() as StepRuntimeContext<Parameters, TCheckpoint> | undefined;
  }

  getRequiredStepContext<
    Parameters extends JobParameters = JobParameters,
    TCheckpoint = unknown
  >(): StepRuntimeContext<Parameters, TCheckpoint> {
    const context = this.getStepContext<Parameters, TCheckpoint>();

    if (!context) {
      throw new Error("Batch context is only available while a batch callback is executing.");
    }

    return context;
  }

  getParameters<Parameters extends JobParameters = JobParameters>(): Parameters | undefined {
    return this.getContext()?.parameters as Parameters | undefined;
  }

  getRequiredParameters<Parameters extends JobParameters = JobParameters>(): Parameters {
    const parameters = this.getParameters<Parameters>();

    if (!parameters) {
      throw new Error("Batch context is only available while a batch callback is executing.");
    }

    return parameters;
  }

  getCheckpoint<TCheckpoint = unknown>(): TCheckpoint | undefined {
    return this.getContext()?.checkpoint as TCheckpoint | undefined;
  }

  getSignal(): AbortSignal | undefined {
    return this.getContext()?.signal;
  }

  getRequiredSignal(): AbortSignal {
    const signal = this.getSignal();

    if (!signal) {
      throw new Error("Batch context is only available while a batch callback is executing.");
    }

    return signal;
  }
}
