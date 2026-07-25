import { Injectable, SetMetadata, applyDecorators } from "@nestjs/common";
import {
  BATCH_JOB_METADATA,
  BATCH_PROCESSOR_METADATA,
  BATCH_READER_METADATA,
  BATCH_STEP_METADATA,
  BATCH_WRITER_METADATA
} from "./constants.js";

export interface BatchJobOptions {
  readonly name?: string;
}

export interface BatchStepOptions {
  readonly name?: string;
}

export interface BatchReaderOptions {
  readonly name?: string;
}

export interface BatchProcessorOptions {
  readonly name?: string;
}

export interface BatchWriterOptions {
  readonly name?: string;
}

const normalizeOptions = <TOptions extends { readonly name?: string }>(
  nameOrOptions?: string | TOptions
): TOptions => {
  if (typeof nameOrOptions === "string") {
    return { name: nameOrOptions } as TOptions;
  }

  return (nameOrOptions ?? {}) as TOptions;
};

export const BatchJob = (nameOrOptions?: string | BatchJobOptions): ClassDecorator =>
  createBatchComponentDecorator<BatchJobOptions>(BATCH_JOB_METADATA, nameOrOptions);

export const BatchStep = (nameOrOptions?: string | BatchStepOptions): MethodDecorator =>
  SetMetadata(BATCH_STEP_METADATA, normalizeOptions<BatchStepOptions>(nameOrOptions));

const createBatchComponentDecorator = <TOptions extends { readonly name?: string }>(
  metadataKey: symbol,
  nameOrOptions?: string | TOptions
): ClassDecorator =>
  applyDecorators(Injectable(), SetMetadata(metadataKey, normalizeOptions<TOptions>(nameOrOptions))) as ClassDecorator;

export const BatchReader = (nameOrOptions?: string | BatchReaderOptions): ClassDecorator =>
  createBatchComponentDecorator<BatchReaderOptions>(BATCH_READER_METADATA, nameOrOptions);

export const BatchProcessor = (nameOrOptions?: string | BatchProcessorOptions): ClassDecorator =>
  createBatchComponentDecorator<BatchProcessorOptions>(BATCH_PROCESSOR_METADATA, nameOrOptions);

export const BatchWriter = (nameOrOptions?: string | BatchWriterOptions): ClassDecorator =>
  createBatchComponentDecorator<BatchWriterOptions>(BATCH_WRITER_METADATA, nameOrOptions);
