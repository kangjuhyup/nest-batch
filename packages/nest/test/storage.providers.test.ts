import { describe, expect, it } from "vitest";
import { DatabaseBatchStorage } from "@rv-nest-batch/core";
import {
  BATCH_CHECKPOINT_STORE,
  BATCH_JOB_REPOSITORY,
  BATCH_LOCK_MANAGER,
  type NestBatchModuleOptions,
  NEST_BATCH_OPTIONS
} from "../src/index.js";
import {
  assertDatabaseBatchStorage,
  createAsyncStorageProviders,
  createStaticStorageProviders,
  NEST_BATCH_STORAGE_EXPORTS
} from "../src/storage.providers.js";
import { FakeDatabaseBatchStorage, findFactoryProvider, findValueProvider } from "./support/providers.js";

describe("storage providers / storage provider", () => {
  it("creates static storage providers / static storage provider를 생성한다", () => {
    const storage = new FakeDatabaseBatchStorage();
    const providers = createStaticStorageProviders(storage);

    expect(findValueProvider(providers, DatabaseBatchStorage).useValue).toBe(storage);
    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: BATCH_JOB_REPOSITORY }),
        expect.objectContaining({ provide: BATCH_CHECKPOINT_STORE }),
        expect.objectContaining({ provide: BATCH_LOCK_MANAGER })
      ])
    );
  });

  it("wires storage providers to storage components / storage provider가 storage 구성요소를 반환한다", () => {
    const storage = new FakeDatabaseBatchStorage();
    const providers = createStaticStorageProviders(storage);

    expect(findFactoryProvider(providers, BATCH_JOB_REPOSITORY).useFactory(storage)).toBe(storage.repository);
    expect(findFactoryProvider(providers, BATCH_CHECKPOINT_STORE).useFactory(storage)).toBe(
      storage.checkpointStore
    );
    expect(findFactoryProvider(providers, BATCH_LOCK_MANAGER).useFactory(storage)).toBe(storage.lockManager);
  });

  it("creates async storage providers / async storage provider를 생성한다", () => {
    const providers = createAsyncStorageProviders();

    expect(findFactoryProvider(providers, DatabaseBatchStorage).inject).toEqual([NEST_BATCH_OPTIONS]);
    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: BATCH_JOB_REPOSITORY }),
        expect.objectContaining({ provide: BATCH_CHECKPOINT_STORE }),
        expect.objectContaining({ provide: BATCH_LOCK_MANAGER })
      ])
    );
  });

  it("resolves async storage and rejects missing storage / async storage를 해석하고 누락을 거부한다", () => {
    const storage = new FakeDatabaseBatchStorage();
    const providers = createAsyncStorageProviders();
    const storageProvider = findFactoryProvider(providers, DatabaseBatchStorage);

    expect(storageProvider.useFactory({ storage })).toBe(storage);
    expect(() =>
      storageProvider.useFactory({ defaultTimeoutMs: 5000 } as unknown as NestBatchModuleOptions)
    ).toThrow("NestBatchModule requires a DatabaseBatchStorage instance.");
    expect(() => storageProvider.useFactory(undefined as unknown as NestBatchModuleOptions)).toThrow(
      "NestBatchModule requires a DatabaseBatchStorage instance."
    );
  });

  it("validates storage through a focused helper / 전용 helper로 storage를 검증한다", () => {
    const storage = new FakeDatabaseBatchStorage();

    expect(assertDatabaseBatchStorage(storage)).toBe(storage);
    expect(() => assertDatabaseBatchStorage(undefined)).toThrow(
      "NestBatchModule requires a DatabaseBatchStorage instance."
    );
  });

  it("defines shared storage exports / 공통 storage export 목록을 정의한다", () => {
    expect(NEST_BATCH_STORAGE_EXPORTS).toEqual([
      DatabaseBatchStorage,
      BATCH_JOB_REPOSITORY,
      BATCH_CHECKPOINT_STORE,
      BATCH_LOCK_MANAGER
    ]);
  });
});
