import type { BatchRunOptions, BatchRunner, ExecutionEngine, WorkerPool } from "@nest-batch/core";
import type { DatabaseBatchStorage } from "@nest-batch/core";
import type { WorkQueue } from "@nest-batch/queue-core";
import type {
  ScheduleDefinition,
  ScheduleDispatcher,
  ScheduleStore,
  SchedulerLoop
} from "@nest-batch/scheduler-core";
import type { DynamicModule, FactoryProvider } from "@nestjs/common";

export interface NestBatchSchedulerOptions {
  readonly autoStart?: boolean;
  readonly pollIntervalMs?: number;
  readonly ownerId?: string;
  readonly lockTtlMs?: number;
  readonly claimTtlMs?: number;
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
}

export interface NestBatchModuleAsyncOptions {
  readonly imports?: DynamicModule["imports"];
  readonly inject?: FactoryProvider["inject"];
  readonly useFactory: (...args: any[]) => Promise<NestBatchModuleOptions> | NestBatchModuleOptions;
}
