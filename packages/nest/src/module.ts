import { DynamicModule, Module } from "@nestjs/common";
import { DatabaseBatchStorage } from "@nest-batch/core";
import type { BatchRunOptions } from "@nest-batch/core";
import type { FactoryProvider, Provider } from "@nestjs/common";
import {
  BATCH_CHECKPOINT_STORE,
  BATCH_JOB_REPOSITORY,
  BATCH_LOCK_MANAGER,
  NEST_BATCH_OPTIONS
} from "./constants.js";

export interface NestBatchModuleOptions {
  readonly storage: DatabaseBatchStorage;
  readonly defaultTimeoutMs?: number;
  readonly runner?: Partial<BatchRunOptions>;
}

export interface NestBatchModuleAsyncOptions {
  readonly imports?: DynamicModule["imports"];
  readonly inject?: FactoryProvider["inject"];
  readonly useFactory: (...args: any[]) => Promise<NestBatchModuleOptions> | NestBatchModuleOptions;
}

const createDatabaseStorageProviders = (): Provider[] => [
  {
    provide: BATCH_JOB_REPOSITORY,
    useFactory: (storage: DatabaseBatchStorage) => storage.repository,
    inject: [DatabaseBatchStorage]
  },
  {
    provide: BATCH_CHECKPOINT_STORE,
    useFactory: (storage: DatabaseBatchStorage) => storage.checkpointStore,
    inject: [DatabaseBatchStorage]
  },
  {
    provide: BATCH_LOCK_MANAGER,
    useFactory: (storage: DatabaseBatchStorage) => storage.lockManager,
    inject: [DatabaseBatchStorage]
  }
];

const assertDatabaseBatchStorage = (storage: DatabaseBatchStorage | undefined): DatabaseBatchStorage => {
  if (!storage) {
    throw new Error("NestBatchModule requires a DatabaseBatchStorage instance.");
  }

  return storage;
};

const createStaticStorageProviders = (storage: DatabaseBatchStorage): Provider[] => {
  return [
    {
      provide: DatabaseBatchStorage,
      useValue: storage
    },
    ...createDatabaseStorageProviders()
  ];
};

const createAsyncStorageProviders = (): Provider[] => [
  {
    provide: DatabaseBatchStorage,
    useFactory: (options: NestBatchModuleOptions): DatabaseBatchStorage => {
      return assertDatabaseBatchStorage(options?.storage);
    },
    inject: [NEST_BATCH_OPTIONS]
  },
  ...createDatabaseStorageProviders()
];

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
      exports: [
        NEST_BATCH_OPTIONS,
        DatabaseBatchStorage,
        BATCH_JOB_REPOSITORY,
        BATCH_CHECKPOINT_STORE,
        BATCH_LOCK_MANAGER
      ]
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
      exports: [
        NEST_BATCH_OPTIONS,
        DatabaseBatchStorage,
        BATCH_JOB_REPOSITORY,
        BATCH_CHECKPOINT_STORE,
        BATCH_LOCK_MANAGER
      ]
    };
  }
}
