import { Inject, Injectable, type OnApplicationBootstrap, type Type } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import { defineJob } from "@rv-nest-batch/core";
import type { AnyStepDefinition, JobDefinition } from "@rv-nest-batch/core";
import {
  BATCH_JOB_METADATA,
  BATCH_PROCESSOR_METADATA,
  BATCH_READER_METADATA,
  BATCH_STEP_METADATA,
  BATCH_WRITER_METADATA
} from "./constants.js";
import type {
  BatchJobOptions,
  BatchProcessorOptions,
  BatchReaderOptions,
  BatchStepOptions,
  BatchWriterOptions
} from "./decorators.js";
import { BatchContextStorage } from "./batch-context.storage.js";
import { bindStepDefinitionContext } from "./context-wrappers.js";

export interface NestBatchComponent<T = unknown> {
  readonly name: string;
  readonly instance: T;
  readonly metatype: Type<T>;
}

export interface NestBatchDiscoveredJob<Parameters extends Record<string, unknown> = Record<string, unknown>> {
  readonly name: string;
  readonly instance: object;
  readonly metatype: Type<unknown>;
  readonly definition: JobDefinition<Parameters>;
}

type ProviderWrapper = ReturnType<DiscoveryService["getProviders"]>[number];

@Injectable()
export class NestBatchRegistry implements OnApplicationBootstrap {
  private discovered = false;
  private readonly jobs = new Map<string, NestBatchDiscoveredJob>();
  private readonly readers = new Map<string, NestBatchComponent>();
  private readonly processors = new Map<string, NestBatchComponent>();
  private readonly writers = new Map<string, NestBatchComponent>();

  constructor(
    @Inject(DiscoveryService) private readonly discoveryService: DiscoveryService,
    @Inject(BatchContextStorage) private readonly batchContextStorage: BatchContextStorage
  ) {}

  onApplicationBootstrap(): void {
    this.discover();
  }

  discover(): void {
    this.jobs.clear();
    this.readers.clear();
    this.processors.clear();
    this.writers.clear();

    for (const wrapper of this.discoveryService.getProviders()) {
      this.discoverProvider(wrapper);
    }

    this.discovered = true;
  }

  getJobs(): readonly JobDefinition[] {
    this.ensureDiscovered();
    return [...this.jobs.values()].map((job) => job.definition);
  }

  getDiscoveredJobs(): readonly NestBatchDiscoveredJob[] {
    this.ensureDiscovered();
    return [...this.jobs.values()];
  }

  getJob<Parameters extends Record<string, unknown> = Record<string, unknown>>(
    name: string
  ): JobDefinition<Parameters> | undefined {
    this.ensureDiscovered();
    return this.jobs.get(name)?.definition as JobDefinition<Parameters> | undefined;
  }

  getReaders(): readonly NestBatchComponent[] {
    this.ensureDiscovered();
    return [...this.readers.values()];
  }

  getReader<T = unknown>(name: string): NestBatchComponent<T> | undefined {
    this.ensureDiscovered();
    return this.readers.get(name) as NestBatchComponent<T> | undefined;
  }

  getProcessors(): readonly NestBatchComponent[] {
    this.ensureDiscovered();
    return [...this.processors.values()];
  }

  getProcessor<T = unknown>(name: string): NestBatchComponent<T> | undefined {
    this.ensureDiscovered();
    return this.processors.get(name) as NestBatchComponent<T> | undefined;
  }

  getWriters(): readonly NestBatchComponent[] {
    this.ensureDiscovered();
    return [...this.writers.values()];
  }

  getWriter<T = unknown>(name: string): NestBatchComponent<T> | undefined {
    this.ensureDiscovered();
    return this.writers.get(name) as NestBatchComponent<T> | undefined;
  }

  private ensureDiscovered(): void {
    if (!this.discovered) {
      this.discover();
    }
  }

  private discoverProvider(wrapper: ProviderWrapper): void {
    const instance = wrapper.instance as object | undefined;
    const metatype = wrapper.metatype as Type<unknown> | undefined;

    if (!instance || !metatype) {
      return;
    }

    this.discoverJob(instance, metatype);
    this.discoverComponent(this.readers, "reader", instance, metatype, BATCH_READER_METADATA);
    this.discoverComponent(this.processors, "processor", instance, metatype, BATCH_PROCESSOR_METADATA);
    this.discoverComponent(this.writers, "writer", instance, metatype, BATCH_WRITER_METADATA);
  }

  private discoverJob(instance: object, metatype: Type<unknown>): void {
    const metadata = Reflect.getMetadata(BATCH_JOB_METADATA, metatype) as BatchJobOptions | undefined;

    if (!metadata) {
      return;
    }

    const name = resolveDiscoveredName("job", metadata.name, metatype.name);
    const steps = this.discoverSteps(instance, metatype);
    const definition = defineJob({
      name,
      steps
    });

    setUnique(this.jobs, name, {
      name,
      instance,
      metatype,
      definition
    }, "job");
  }

  private discoverSteps(instance: object, metatype: Type<unknown>): readonly AnyStepDefinition[] {
    const steps: AnyStepDefinition[] = [];
    const prototype = metatype.prototype as Record<string, unknown>;

    for (const propertyName of Object.getOwnPropertyNames(prototype)) {
      if (propertyName === "constructor") {
        continue;
      }

      const method = prototype[propertyName];

      if (typeof method !== "function") {
        continue;
      }

      const metadata = Reflect.getMetadata(BATCH_STEP_METADATA, method) as BatchStepOptions | undefined;

      if (!metadata) {
        continue;
      }

      const step = (instance as Record<string, unknown>)[propertyName];

      if (typeof step !== "function") {
        continue;
      }

      const normalized = normalizeStepDefinition(step.call(instance), metadata, propertyName);
      steps.push(bindStepDefinitionContext(normalized, this.batchContextStorage));
    }

    return steps;
  }

  private discoverComponent(
    components: Map<string, NestBatchComponent>,
    kind: "reader" | "processor" | "writer",
    instance: object,
    metatype: Type<unknown>,
    metadataKey: symbol
  ): void {
    const metadata = Reflect.getMetadata(metadataKey, metatype) as
      | BatchReaderOptions
      | BatchProcessorOptions
      | BatchWriterOptions
      | undefined;

    if (!metadata) {
      return;
    }

    const name = resolveDiscoveredName(kind, metadata.name, metatype.name);
    setUnique(components, name, {
      name,
      instance,
      metatype
    }, kind);
  }
}

const resolveDiscoveredName = (
  kind: "job" | "step" | "reader" | "processor" | "writer",
  name: string | undefined,
  fallback: string
): string => {
  const resolved = (name ?? fallback).trim();

  if (resolved.length === 0) {
    throw new Error(`Batch ${kind} name is required.`);
  }

  return resolved;
};

const normalizeStepDefinition = (
  value: unknown,
  metadata: BatchStepOptions,
  methodName: string
): AnyStepDefinition => {
  if (!isStepDefinition(value)) {
    throw new Error(`Batch step method "${methodName}" must return a StepDefinition.`);
  }

  const name =
    metadata.name === undefined
      ? value.name
      : resolveDiscoveredName("step", metadata.name, methodName);

  if (name === value.name) {
    return value;
  }

  return Object.freeze({
    ...value,
    name
  }) as AnyStepDefinition;
};

const isStepDefinition = (value: unknown): value is AnyStepDefinition => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<AnyStepDefinition>;
  return typeof candidate.name === "string";
};

const setUnique = <T>(
  values: Map<string, T>,
  name: string,
  value: T,
  kind: "job" | "reader" | "processor" | "writer"
): void => {
  if (values.has(name)) {
    throw new Error(`Batch ${kind} "${name}" is already registered.`);
  }

  values.set(name, value);
};
