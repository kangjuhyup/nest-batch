import { SetMetadata } from "@nestjs/common";
import { BATCH_JOB_METADATA, BATCH_STEP_METADATA } from "./constants.js";

export interface BatchJobOptions {
  readonly name?: string;
}

export interface BatchStepOptions {
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
  SetMetadata(BATCH_JOB_METADATA, normalizeOptions<BatchJobOptions>(nameOrOptions));

export const BatchStep = (nameOrOptions?: string | BatchStepOptions): MethodDecorator =>
  SetMetadata(BATCH_STEP_METADATA, normalizeOptions<BatchStepOptions>(nameOrOptions));
