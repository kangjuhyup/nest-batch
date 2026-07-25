import type {
  ChunkStepDefinition,
  ChunkStepOptions,
  ChunkStepWithProcessorOptions,
  ChunkStepWithoutProcessorOptions,
  BatchEventListener,
  BatchEventListenerRegistration,
  BatchEventType,
  ChainableJobDefinition,
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

export const defineStep = <
  Input = unknown,
  Output = unknown,
  Parameters extends JobParameters = JobParameters
>(
  definition: TaskletStepDefinition<Input, Output, Parameters>
): TaskletStepDefinition<Input, Output, Parameters> => {
  assertName("Step", definition.name);

  return Object.freeze({
    ...definition,
    name: definition.name.trim()
  });
};

export const definePartitionedStep = <
  TPartition = unknown,
  Parameters extends JobParameters = JobParameters
>(
  definition: PartitionedStepOptions<TPartition, Parameters>
): PartitionedStepDefinition<TPartition, Parameters> => {
  assertName("Step", definition.name);
  assertMaxConcurrency(definition.maxConcurrency);

  return Object.freeze({
    ...definition,
    kind: "partitioned" as const,
    name: definition.name.trim()
  });
};

export function defineChunkStep<
  Input = unknown,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
>(
  definition: ChunkStepWithoutProcessorOptions<Input, TCheckpoint, Parameters>
): ChunkStepDefinition<Input, Input, TCheckpoint, Parameters>;

export function defineChunkStep<
  Input = unknown,
  Output = unknown,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
>(
  definition: ChunkStepWithProcessorOptions<Input, Output, TCheckpoint, Parameters>
): ChunkStepDefinition<Input, Output, TCheckpoint, Parameters>;

export function defineChunkStep<
  Input = unknown,
  Output = Input,
  TCheckpoint = unknown,
  Parameters extends JobParameters = JobParameters
>(
  definition: ChunkStepOptions<Input, Output, TCheckpoint, Parameters>
): ChunkStepDefinition<Input, Output, TCheckpoint, Parameters> {
  assertName("Step", definition.name);
  assertChunkSize(definition.chunkSize);

  return Object.freeze({
    ...definition,
    kind: "chunk" as const,
    name: definition.name.trim(),
    reader: normalizeReader(definition.reader)
  }) as ChunkStepDefinition<Input, Output, TCheckpoint, Parameters>;
}

export const defineJob = <Parameters extends JobParameters = JobParameters>(
  definition: JobDefinition<Parameters>
): ChainableJobDefinition<Parameters> => {
  assertName("Job", definition.name);

  if (definition.steps.length === 0) {
    throw new Error(`Job "${definition.name.trim()}" must include at least one step.`);
  }

  return createChainableJobDefinition({
    ...definition,
    name: definition.name.trim(),
    steps: Object.freeze([...definition.steps])
  });
};

const createChainableJobDefinition = <Parameters extends JobParameters>(
  definition: JobDefinition<Parameters>
): ChainableJobDefinition<Parameters> => {
  const listeners: BatchEventListenerRegistration[] = [...(definition.listeners ?? [])];
  const job = {
    ...definition
  } as ChainableJobDefinition<Parameters>;

  Object.defineProperties(job, {
    listeners: {
      enumerable: false,
      get() {
        return Object.freeze([...listeners]);
      }
    },
    onEvent: {
      enumerable: false,
      value(type: BatchEventType, listener: BatchEventListener) {
        appendListener(listeners, { type, listener });
        return job;
      }
    },
    onStart: {
      enumerable: false,
      value(listener: BatchEventListener) {
        appendListener(listeners, { type: "job.started", listener });
        return job;
      }
    },
    onSuccess: {
      enumerable: false,
      value(listener: BatchEventListener) {
        appendListener(listeners, { type: "job.completed", listener });
        return job;
      }
    },
    onFailure: {
      enumerable: false,
      value(listener: BatchEventListener) {
        appendListener(listeners, { type: "job.failed", listener });
        return job;
      }
    },
    onCancel: {
      enumerable: false,
      value(listener: BatchEventListener) {
        appendListener(listeners, { type: "job.cancelled", listener });
        return job;
      }
    },
    onStepFailure: {
      enumerable: false,
      value(listener: BatchEventListener) {
        appendListener(listeners, { type: "step.failed", listener });
        return job;
      }
    }
  });

  return Object.freeze(job);
};

const appendListener = (
  listeners: BatchEventListenerRegistration[],
  registration: BatchEventListenerRegistration
): void => {
  if (typeof registration.listener !== "function") {
    throw new TypeError("Batch event listener must be a function.");
  }

  listeners.push(registration);
};
