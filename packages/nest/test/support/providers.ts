import { DatabaseBatchStorage } from "@nest-batch/core";
import type { CheckpointStore, JobRepository, LockManager } from "@nest-batch/core";
import type { FactoryProvider, Provider, ValueProvider } from "@nestjs/common";

export class FakeDatabaseBatchStorage extends DatabaseBatchStorage {
  readonly repository = { name: "repository" } as unknown as JobRepository;
  readonly checkpointStore = { name: "checkpoint-store" } as unknown as CheckpointStore;
  readonly lockManager = { name: "lock-manager" } as unknown as LockManager;
}

const isObjectProvider = (provider: Provider): provider is FactoryProvider | ValueProvider =>
  typeof provider === "object" && provider !== null && "provide" in provider;

export const findFactoryProvider = (providers: readonly Provider[], token: unknown): FactoryProvider => {
  const provider = providers.find(
    (candidate): candidate is FactoryProvider =>
      isObjectProvider(candidate) && candidate.provide === token && "useFactory" in candidate
  );

  if (!provider) {
    throw new Error(`Factory provider was not found for ${String(token)}.`);
  }

  return provider;
};

export const findValueProvider = (providers: readonly Provider[], token: unknown): ValueProvider => {
  const provider = providers.find(
    (candidate): candidate is ValueProvider =>
      isObjectProvider(candidate) && candidate.provide === token && "useValue" in candidate
  );

  if (!provider) {
    throw new Error(`Value provider was not found for ${String(token)}.`);
  }

  return provider;
};
