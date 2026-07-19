import { Module } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import { NEST_BATCH_OPTIONS } from "./constants.js";
import type { NestBatchModuleAsyncOptions, NestBatchModuleOptions } from "./module-options.js";
import {
  assertDatabaseBatchStorage,
  createAsyncStorageProviders,
  createStaticStorageProviders,
  NEST_BATCH_STORAGE_EXPORTS
} from "./storage.providers.js";

@Module({})
export class NestBatchModule {
  static forRoot(options: NestBatchModuleOptions): DynamicModule {
    const storage = assertDatabaseBatchStorage(options?.storage);
    const storageProviders = createStaticStorageProviders(storage);

    return {
      module: NestBatchModule,
      providers: [
        {
          provide: NEST_BATCH_OPTIONS,
          useValue: options
        },
        ...storageProviders
      ],
      exports: [NEST_BATCH_OPTIONS, ...NEST_BATCH_STORAGE_EXPORTS]
    };
  }

  static forRootAsync(options: NestBatchModuleAsyncOptions): DynamicModule {
    return {
      module: NestBatchModule,
      imports: options.imports,
      providers: [
        {
          provide: NEST_BATCH_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? []
        },
        ...createAsyncStorageProviders()
      ],
      exports: [NEST_BATCH_OPTIONS, ...NEST_BATCH_STORAGE_EXPORTS]
    };
  }
}
