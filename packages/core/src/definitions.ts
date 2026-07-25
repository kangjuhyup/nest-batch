import type {
  ChunkStepDefinition,
  ChunkStepOptions,
  ChunkStepWithProcessorOptions,
  ChunkStepWithoutProcessorOptions,
  JobDefinition,
  JobParameters,
  PartitionedStepDefinition,
  PartitionedStepOptions,
  TaskletStepDefinition
} from "./types/index.js";
import { normalizeReader } from "./readers/definition-reader.js";

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

const assertMaxConcurrency = (maxConcurrency: number | undefined): void => {
  if (maxConcurrency !== undefined && (!Number.isSafeInteger(maxConcurrency) || maxConcurrency <= 0)) {
    throw new Error("Max concurrency must be a positive safe integer.");
  }
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

export const definePartitionedStep = <TPartition = unknown>(
  definition: PartitionedStepOptions<TPartition>
): PartitionedStepDefinition<TPartition> => {
  assertName("Step", definition.name);
  assertMaxConcurrency(definition.maxConcurrency);

  return Object.freeze({
    ...definition,
    kind: "partitioned" as const,
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
    name: definition.name.trim(),
    reader: normalizeReader(definition.reader)
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
