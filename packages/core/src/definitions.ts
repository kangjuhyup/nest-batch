import type {
  ChunkStepDefinition,
  ChunkStepOptions,
  ChunkStepWithProcessorOptions,
  ChunkStepWithoutProcessorOptions,
  JobDefinition,
  JobParameters,
  SkipItem,
  TaskletStepDefinition
} from "./types.js";
import { SKIP_ITEM } from "./types.js";

const assertName = (kind: "Job" | "Step", name: string): void => {
  if (name.trim().length === 0) {
    throw new Error(`${kind} name is required.`);
  }
};

const assertChunkSize = (chunkSize: number): void => {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("Chunk size must be a positive integer.");
  }
};

export const skipItem = (reason?: string, cause?: unknown): SkipItem =>
  Object.freeze({
    kind: "skip",
    reason,
    cause,
    [SKIP_ITEM]: true
  });

export const isSkipItem = (value: unknown): value is SkipItem => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (value as { readonly [SKIP_ITEM]?: unknown })[SKIP_ITEM] === true;
};

export const defineStep = <Input = unknown, Output = unknown>(
  definition: TaskletStepDefinition<Input, Output>
): TaskletStepDefinition<Input, Output> => {
  assertName("Step", definition.name);

  return Object.freeze({
    ...definition,
    name: definition.name.trim()
  });
};

export function defineChunkStep<Input = unknown, TCheckpoint = unknown>(
  definition: ChunkStepWithoutProcessorOptions<Input, TCheckpoint>
): ChunkStepDefinition<Input, Input, TCheckpoint>;

export function defineChunkStep<Input = unknown, Output = unknown, TCheckpoint = unknown>(
  definition: ChunkStepWithProcessorOptions<Input, Output, TCheckpoint>
): ChunkStepDefinition<Input, Output, TCheckpoint>;

export function defineChunkStep<Input = unknown, Output = Input, TCheckpoint = unknown>(
  definition: ChunkStepOptions<Input, Output, TCheckpoint>
): ChunkStepDefinition<Input, Output, TCheckpoint> {
  assertName("Step", definition.name);
  assertChunkSize(definition.chunkSize);

  return Object.freeze({
    ...definition,
    kind: "chunk" as const,
    name: definition.name.trim()
  }) as ChunkStepDefinition<Input, Output, TCheckpoint>;
}

export const defineJob = <Parameters extends JobParameters = JobParameters>(
  definition: JobDefinition<Parameters>
): JobDefinition<Parameters> => {
  assertName("Job", definition.name);

  if (definition.steps.length === 0) {
    throw new Error(`Job "${definition.name.trim()}" must include at least one step.`);
  }

  return Object.freeze({
    ...definition,
    name: definition.name.trim(),
    steps: Object.freeze([...definition.steps])
  });
};
