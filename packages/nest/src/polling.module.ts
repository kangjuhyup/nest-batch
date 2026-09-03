import { Module } from "@nestjs/common";
import type { DynamicModule, Provider } from "@nestjs/common";
import { BATCH_POLLING_WORKERS } from "./constants.js";
import type {
  NestBatchPollingModuleAsyncOptions,
  NestBatchPollingModuleOptions
} from "./module-options.js";
import { NestBatchPollingLifecycle } from "./polling-lifecycle.service.js";

@Module({})
export class NestBatchPollingModule {
  static forRoot(options: NestBatchPollingModuleOptions = {}): DynamicModule {
    return {
      module: NestBatchPollingModule,
      global: true,
      providers: [
        {
          provide: BATCH_POLLING_WORKERS,
          useValue: options.pollingWorkers ?? []
        },
        NestBatchPollingLifecycle
      ],
      exports: [BATCH_POLLING_WORKERS]
    };
  }

  static forRootAsync(options: NestBatchPollingModuleAsyncOptions): DynamicModule {
    return {
      module: NestBatchPollingModule,
      global: true,
      imports: options.imports ?? [],
      providers: [createAsyncPollingWorkersProvider(options), NestBatchPollingLifecycle],
      exports: [BATCH_POLLING_WORKERS]
    };
  }
}

const createAsyncPollingWorkersProvider = (
  options: NestBatchPollingModuleAsyncOptions
): Provider => ({
  provide: BATCH_POLLING_WORKERS,
  useFactory: async (...args: unknown[]) => {
    const resolved = await options.useFactory(...args);
    return resolved.pollingWorkers ?? [];
  },
  inject: options.inject ?? []
});
