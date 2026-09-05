import type { BatchRunOptions, BatchRunner, ExecutionEngine, WorkerPool } from "@rvkang/batch-core";
import type { DatabaseBatchStorage } from "@rvkang/batch-core";
import type { ContinuousPollingLoopOptions } from "@rvkang/batch-core/polling";
import type { WorkQueue } from "@rvkang/batch-core/queue";
import type {
  ScheduleDefinition,
  ScheduleDispatcher,
  ScheduleStore,
  SchedulerLoop
} from "@rvkang/batch-core/scheduler";
import type { DynamicModule, FactoryProvider } from "@nestjs/common";

export interface NestBatchSchedulerOptions {
  readonly autoStart?: boolean;
  readonly pollIntervalMs?: number;
  readonly ownerId?: string;
  readonly lockTtlMs?: number;
  readonly claimTtlMs?: number;
}

export interface NestBatchPollingWorkerOptions extends ContinuousPollingLoopOptions {
  readonly autoStart?: boolean;
}

export interface NestBatchPollingModuleOptions {
  readonly pollingWorkers?: readonly NestBatchPollingWorkerOptions[];
}

export interface NestBatchPollingModuleAsyncOptions {
  readonly imports?: DynamicModule["imports"];
  readonly inject?: FactoryProvider["inject"];
  readonly useFactory: (
    ...args: any[]
  ) => Promise<NestBatchPollingModuleOptions> | NestBatchPollingModuleOptions;
}

export interface NestBatchModuleOptions {
  readonly storage: DatabaseBatchStorage;
  readonly defaultTimeoutMs?: number;
  readonly runner?: Partial<BatchRunOptions>;
  readonly batchRunner?: BatchRunner;
  readonly executionEngine?: ExecutionEngine;
  readonly workerPool?: WorkerPool;
  readonly workQueue?: WorkQueue;
  readonly scheduleStore?: ScheduleStore;
  readonly schedules?: readonly ScheduleDefinition[];
  readonly schedulerDispatcher?: ScheduleDispatcher;
  readonly schedulerLoop?: SchedulerLoop;
  readonly scheduler?: NestBatchSchedulerOptions;
  readonly pollingWorkers?: readonly NestBatchPollingWorkerOptions[];
}

export interface NestBatchModuleAsyncOptions {
  readonly imports?: DynamicModule["imports"];
  readonly inject?: FactoryProvider["inject"];
  readonly useFactory: (...args: any[]) => Promise<NestBatchModuleOptions> | NestBatchModuleOptions;
}
