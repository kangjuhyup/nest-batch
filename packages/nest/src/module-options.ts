import type { BatchRunOptions, BatchRunner } from "@nest-batch/core";
import type { DatabaseBatchStorage } from "@nest-batch/core";
import type { DynamicModule, FactoryProvider } from "@nestjs/common";

export interface NestBatchModuleOptions {
  readonly storage: DatabaseBatchStorage;
  readonly defaultTimeoutMs?: number;
  readonly runner?: Partial<BatchRunOptions>;
  readonly batchRunner?: BatchRunner;
}

export interface NestBatchModuleAsyncOptions {
  readonly imports?: DynamicModule["imports"];
  readonly inject?: FactoryProvider["inject"];
  readonly useFactory: (...args: any[]) => Promise<NestBatchModuleOptions> | NestBatchModuleOptions;
}
