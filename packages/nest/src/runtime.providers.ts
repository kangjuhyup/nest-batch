import { DefaultBatchRunner, DatabaseBatchStorage } from "@nest-batch/core";
import type { BatchRunner } from "@nest-batch/core";
import type { Provider } from "@nestjs/common";
import { BATCH_RUNNER, NEST_BATCH_OPTIONS } from "./constants.js";
import type { NestBatchModuleOptions } from "./module-options.js";
import { NestBatchRegistry } from "./registry.js";
import { NestBatchRunner } from "./runner.service.js";

export const NEST_BATCH_RUNTIME_EXPORTS = [
  BATCH_RUNNER,
  NestBatchRegistry,
  NestBatchRunner
] as const;

export const createRuntimeProviders = (): Provider[] => [
  NestBatchRegistry,
  {
    provide: BATCH_RUNNER,
    useFactory: (
      storage: DatabaseBatchStorage,
      options: NestBatchModuleOptions
    ): BatchRunner => options.batchRunner ?? new DefaultBatchRunner(storage),
    inject: [DatabaseBatchStorage, NEST_BATCH_OPTIONS]
  },
  NestBatchRunner
];
