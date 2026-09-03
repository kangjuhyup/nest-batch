import { openReader } from "@nest-batch/core";
import type {
  AnyStepDefinition,
  ChunkCheckpointContext,
  ChunkItemContext,
  ChunkReader,
  ChunkRetryContext,
  ChunkSkipContext,
  ChunkStepExecutionContext,
  ChunkStepDefinition,
  ChunkWriteContext,
  JobParameters,
  PartitionExecutionContext,
  PartitionedStepDefinition,
  Processor,
  ReaderSession,
  RetryPolicy,
  SkipPolicy,
  TaskletStepExecutionContext,
  TaskletStepDefinition,
  Writer
} from "@nest-batch/core";
import type { BatchContextStorage } from "./batch-context.storage.js";
import type { NestBatchExecutionContext } from "./batch-context.types.js";

export const bindStepDefinitionContext = (
  step: AnyStepDefinition,
  contextStorage: BatchContextStorage
): AnyStepDefinition => {
  if (isChunkStepDefinition(step)) {
    return bindChunkStepContext(step, contextStorage) as AnyStepDefinition;
  }

  if (isPartitionedStepDefinition(step)) {
    return bindPartitionedStepContext(step, contextStorage) as AnyStepDefinition;
  }

  return bindTaskletStepContext(step as TaskletStepDefinition, contextStorage) as AnyStepDefinition;
};

const bindTaskletStepContext = <
  Input,
  Output,
  Parameters extends JobParameters
>(
  step: TaskletStepDefinition<Input, Output, Parameters>,
  contextStorage: BatchContextStorage
): TaskletStepDefinition<Input, Output, Parameters> =>
  Object.freeze({
    ...step,
    execute(context: TaskletStepExecutionContext<Input, Parameters>) {
      return contextStorage.run(context, () => step.execute(context));
    }
  });

const bindChunkStepContext = <
  Input,
  Output,
  TCheckpoint,
  Parameters extends JobParameters
>(
  step: ChunkStepDefinition<Input, Output, TCheckpoint, Parameters>,
  contextStorage: BatchContextStorage
): ChunkStepDefinition<Input, Output, TCheckpoint, Parameters> => {
  const checkpoint = step.checkpoint;

  return Object.freeze({
    ...step,
    reader: bindChunkReaderContext(step.reader, contextStorage),
    ...(step.processor ? { processor: bindProcessorContext(step.processor, contextStorage) } : {}),
    writer: bindWriterContext(step.writer, contextStorage),
    ...(step.retryPolicy ? { retryPolicy: bindRetryPolicyContext(step.retryPolicy, contextStorage) } : {}),
    ...(step.skipPolicy ? { skipPolicy: bindSkipPolicyContext(step.skipPolicy, contextStorage) } : {}),
    ...(checkpoint
      ? {
          checkpoint(context: ChunkCheckpointContext<TCheckpoint, Parameters>) {
            return contextStorage.run(context, () => checkpoint(context));
          }
        }
      : {})
  });
};

const bindPartitionedStepContext = <
  TPartition,
  Parameters extends JobParameters
>(
  step: PartitionedStepDefinition<TPartition, Parameters>,
  contextStorage: BatchContextStorage
): PartitionedStepDefinition<TPartition, Parameters> =>
  Object.freeze({
    ...step,
    execute(partition: TPartition, context: PartitionExecutionContext<TPartition, Parameters>) {
      return contextStorage.run(context, () => step.execute(partition, context));
    }
  });

const bindChunkReaderContext = <
  Input,
  TCheckpoint,
  Parameters extends JobParameters
>(
  reader: ChunkReader<Input, TCheckpoint, Parameters>,
  contextStorage: BatchContextStorage
): ChunkReader<Input, TCheckpoint, Parameters> => ({
  async open(context: ChunkStepExecutionContext<TCheckpoint, Parameters>) {
    const session = await contextStorage.run(context, () => openReader(reader, context));
    return bindReaderSessionContext(session, context, contextStorage);
  }
});

const bindReaderSessionContext = <
  Input,
  TCheckpoint,
  TContext extends NestBatchExecutionContext
>(
  session: ReaderSession<Input, TCheckpoint>,
  context: TContext,
  contextStorage: BatchContextStorage
): ReaderSession<Input, TCheckpoint> => ({
  async *[Symbol.asyncIterator]() {
    const iterator = session[Symbol.asyncIterator]();

    try {
      while (true) {
        const next = await contextStorage.run(context, () => iterator.next());

        if (next.done) {
          return;
        }

        yield next.value;
      }
    } finally {
      if (typeof iterator.return === "function") {
        await contextStorage.run(context, () => iterator.return?.());
      }
    }
  },
  ...(session.checkpoint
    ? {
        checkpoint: () => {
          const checkpoint = session.checkpoint;
          return contextStorage.run(context, () => checkpoint?.call(session));
        }
      }
    : {}),
  ...(session.close
    ? {
        close: () => {
          const close = session.close;
          return contextStorage.run(context, () => close?.call(session));
        }
      }
    : {})
});

const bindProcessorContext = <
  Input,
  Output,
  TCheckpoint,
  Parameters extends JobParameters
>(
  processor: Processor<Input, Output, TCheckpoint, Parameters>,
  contextStorage: BatchContextStorage
): Processor<Input, Output, TCheckpoint, Parameters> => ({
  process(item: Input, context: ChunkItemContext<Input, TCheckpoint, Parameters>) {
    return contextStorage.run(context, () => processor.process(item, context));
  }
});

const bindWriterContext = <
  Output,
  TCheckpoint,
  Parameters extends JobParameters
>(
  writer: Writer<Output, TCheckpoint, Parameters>,
  contextStorage: BatchContextStorage
): Writer<Output, TCheckpoint, Parameters> => ({
  write(items, context) {
    return contextStorage.run(context, () => writer.write(items, context));
  }
});

const bindRetryPolicyContext = <
  Input,
  Output,
  TCheckpoint,
  Parameters extends JobParameters
>(
  retryPolicy: RetryPolicy<Input, Output, TCheckpoint, Parameters>,
  contextStorage: BatchContextStorage
): RetryPolicy<Input, Output, TCheckpoint, Parameters> => {
  const backoffMs = retryPolicy.backoffMs;

  return {
    canRetry(context: ChunkRetryContext<Input, Output, TCheckpoint, Parameters>) {
      return contextStorage.run(context, () => retryPolicy.canRetry(context));
    },
    ...(backoffMs
      ? {
          backoffMs(context: ChunkRetryContext<Input, Output, TCheckpoint, Parameters>) {
            return contextStorage.run(context, () => backoffMs(context));
          }
        }
      : {})
  };
};

const bindSkipPolicyContext = <
  Input,
  TCheckpoint,
  Parameters extends JobParameters
>(
  skipPolicy: SkipPolicy<Input, TCheckpoint, Parameters>,
  contextStorage: BatchContextStorage
): SkipPolicy<Input, TCheckpoint, Parameters> => ({
  canSkip(context: ChunkSkipContext<Input, TCheckpoint, Parameters>) {
    return contextStorage.run(context, () => skipPolicy.canSkip(context));
  }
});

const isChunkStepDefinition = (step: AnyStepDefinition): step is ChunkStepDefinition => {
  return step.kind === "chunk";
};

const isPartitionedStepDefinition = (step: AnyStepDefinition): step is PartitionedStepDefinition => {
  return step.kind === "partitioned";
};
