import { DatabaseBatchStorage } from "@rvkang/batch-core";
import type { Provider } from "@nestjs/common";
import {
  BATCH_CHECKPOINT_STORE,
  BATCH_JOB_REPOSITORY,
  BATCH_LOCK_MANAGER,
  NEST_BATCH_OPTIONS
} from "./constants.js";
import type { NestBatchModuleOptions } from "./module-options.js";

export const NEST_BATCH_STORAGE_EXPORTS = [
  DatabaseBatchStorage,
  BATCH_JOB_REPOSITORY,
  BATCH_CHECKPOINT_STORE,
  BATCH_LOCK_MANAGER
];

export const assertDatabaseBatchStorage = (
  storage: DatabaseBatchStorage | undefined
): DatabaseBatchStorage => {
  if (!storage) {
    throw new Error("NestBatchModule requires a DatabaseBatchStorage instance.");
  }

  return storage;
};

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

export const createStaticStorageProviders = (storage: DatabaseBatchStorage): Provider[] => [
  {
    provide: DatabaseBatchStorage,
    useValue: storage
  },
  ...createDatabaseStorageProviders()
];

export const createAsyncStorageProviders = (): Provider[] => [
  {
    provide: DatabaseBatchStorage,
    useFactory: (options: NestBatchModuleOptions): DatabaseBatchStorage => {
      return assertDatabaseBatchStorage(options?.storage);
    },
    inject: [NEST_BATCH_OPTIONS]
  },
  ...createDatabaseStorageProviders()
];
