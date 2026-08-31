import { DefaultBatchRunner, DatabaseBatchStorage } from "@nest-batch/core";
import type { BatchRunner } from "@nest-batch/core";
import type { DynamicModule, Provider } from "@nestjs/common";
import {
  BATCH_EXECUTION_ENGINE,
  BATCH_RUNNER,
  BATCH_SCHEDULE_STORE,
  BATCH_SCHEDULES,
  BATCH_SCHEDULER_DISPATCHER,
  BATCH_SCHEDULER_LOOP,
  BATCH_WORKER_POOL,
  BATCH_WORK_QUEUE,
  NEST_BATCH_OPTIONS
} from "./constants.js";
import { BatchContextAccessor } from "./batch-context-accessor.js";
import { BatchContextStorage } from "./batch-context.storage.js";
import type { NestBatchModuleOptions } from "./module-options.js";
import { NestBatchRegistry } from "./registry.js";
import { NestBatchRunner } from "./runner.service.js";
import { NestBatchSchedulerLifecycle } from "./scheduler-lifecycle.service.js";

export const NEST_BATCH_RUNTIME_EXPORTS = [
  BATCH_RUNNER,
  BatchContextAccessor,
  NestBatchRegistry,
  NestBatchRunner
] as const;

export const createRuntimeProviders = (options?: NestBatchModuleOptions): Provider[] => [
  BatchContextStorage,
  BatchContextAccessor,
  NestBatchRegistry,
  NestBatchSchedulerLifecycle,
  ...createRuntimeOptionProviders(options),
  {
    provide: BATCH_RUNNER,
    useFactory: (
      storage: DatabaseBatchStorage,
      moduleOptions: NestBatchModuleOptions
    ): BatchRunner => moduleOptions.batchRunner ?? new DefaultBatchRunner(storage),
    inject: [DatabaseBatchStorage, NEST_BATCH_OPTIONS]
  },
  NestBatchRunner
];

export const createRuntimeExports = (
  options?: NestBatchModuleOptions
): NonNullable<DynamicModule["exports"]> => [
  ...NEST_BATCH_RUNTIME_EXPORTS,
  ...createRuntimeOptionExports(options)
];

const createRuntimeOptionProviders = (options?: NestBatchModuleOptions): Provider[] => {
  if (!options) {
    return [
      createRuntimeOptionFactoryProvider(BATCH_EXECUTION_ENGINE, "executionEngine"),
      createRuntimeOptionFactoryProvider(BATCH_WORKER_POOL, "workerPool"),
      createRuntimeOptionFactoryProvider(BATCH_WORK_QUEUE, "workQueue"),
      createRuntimeOptionFactoryProvider(BATCH_SCHEDULE_STORE, "scheduleStore"),
      createRuntimeOptionFactoryProvider(BATCH_SCHEDULES, "schedules"),
      createRuntimeOptionFactoryProvider(BATCH_SCHEDULER_DISPATCHER, "schedulerDispatcher"),
      createRuntimeOptionFactoryProvider(BATCH_SCHEDULER_LOOP, "schedulerLoop")
    ];
  }

  const providers: Provider[] = [];

  if (options.executionEngine !== undefined) {
    providers.push({ provide: BATCH_EXECUTION_ENGINE, useValue: options.executionEngine });
  }

  if (options.workerPool !== undefined) {
    providers.push({ provide: BATCH_WORKER_POOL, useValue: options.workerPool });
  }

  if (options.workQueue !== undefined) {
    providers.push({ provide: BATCH_WORK_QUEUE, useValue: options.workQueue });
  }

  if (options.scheduleStore !== undefined) {
    providers.push({ provide: BATCH_SCHEDULE_STORE, useValue: options.scheduleStore });
  }

  if (options.schedules !== undefined) {
    providers.push({ provide: BATCH_SCHEDULES, useValue: options.schedules });
  }

  if (options.schedulerDispatcher !== undefined) {
    providers.push({ provide: BATCH_SCHEDULER_DISPATCHER, useValue: options.schedulerDispatcher });
  }

  if (options.schedulerLoop !== undefined) {
    providers.push({ provide: BATCH_SCHEDULER_LOOP, useValue: options.schedulerLoop });
  }

  return providers;
};

const createRuntimeOptionExports = (
  options?: NestBatchModuleOptions
): NonNullable<DynamicModule["exports"]> => {
  if (!options) {
    return [
      BATCH_EXECUTION_ENGINE,
      BATCH_WORKER_POOL,
      BATCH_WORK_QUEUE,
      BATCH_SCHEDULE_STORE,
      BATCH_SCHEDULES,
      BATCH_SCHEDULER_DISPATCHER,
      BATCH_SCHEDULER_LOOP
    ];
  }

  const exports: NonNullable<DynamicModule["exports"]> = [];

  if (options.executionEngine !== undefined) {
    exports.push(BATCH_EXECUTION_ENGINE);
  }

  if (options.workerPool !== undefined) {
    exports.push(BATCH_WORKER_POOL);
  }

  if (options.workQueue !== undefined) {
    exports.push(BATCH_WORK_QUEUE);
  }

  if (options.scheduleStore !== undefined) {
    exports.push(BATCH_SCHEDULE_STORE);
  }

  if (options.schedules !== undefined) {
    exports.push(BATCH_SCHEDULES);
  }

  if (options.schedulerDispatcher !== undefined) {
    exports.push(BATCH_SCHEDULER_DISPATCHER);
  }

  if (options.schedulerLoop !== undefined) {
    exports.push(BATCH_SCHEDULER_LOOP);
  }

  return exports;
};

const createRuntimeOptionFactoryProvider = (
  provide: symbol,
  key:
    | "executionEngine"
    | "workerPool"
    | "workQueue"
    | "scheduleStore"
    | "schedules"
    | "schedulerDispatcher"
    | "schedulerLoop"
): Provider => ({
  provide,
  useFactory: (options: NestBatchModuleOptions): unknown => options[key],
  inject: [NEST_BATCH_OPTIONS]
});
