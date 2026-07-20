import { isSkipItem } from "../skip-item.js";
import { closeReader, getReaderCheckpoint, openReader } from "../readers/index.js";
import type {
  CheckpointStore,
  ChunkRetryContext,
  ChunkSkipContext,
  ChunkStepDefinition,
  RetryPolicy,
  SkipPolicy
} from "../types/index.js";
import { emitBatchEvent } from "./events.js";
import { delay, requireSignal } from "./signals.js";
import type { StepRunContext, StepRunResult } from "./step-run-context.js";

export const runChunkStep = async <Input, Output, TCheckpoint>(
  step: ChunkStepDefinition<Input, Output, TCheckpoint>,
  context: StepRunContext,
  checkpointStore: CheckpointStore
): Promise<StepRunResult> => {
  let checkpoint = await checkpointStore.read<TCheckpoint>(context.checkpointExecutionId, step.name);
  let readCount = 0;
  let writeCount = 0;
  let skipCount = 0;
  let retryCount = 0;
  let chunkIndex = 0;
  let chunk: Output[] = [];
  const signal = requireSignal(context.signal);
  const readerContext = { signal, checkpoint };

  type ProcessItemResult = { readonly skipped: true } | { readonly skipped: false; readonly output: Output };

  const processItem = async (item: Input): Promise<ProcessItemResult> => {
    if (!step.processor) {
      return { skipped: false, output: item as unknown as Output };
    }

    let attempt = 1;

    while (true) {
      try {
        const processed = await step.processor.process(item, {
          item,
          index: readCount - 1,
          signal,
          checkpoint
        });

        if (isSkipItem(processed)) {
          skipCount += 1;
          await emitBatchEvent(context.observer, {
            type: "item.skipped",
            jobExecutionId: context.jobExecutionId,
            stepName: step.name,
            item,
            error: processed.cause,
            reason: processed.reason
          });
          return { skipped: true };
        }

        return { skipped: false, output: processed as Output };
      } catch (error) {
        const retryContext: ChunkRetryContext<Input, Output, TCheckpoint> = {
          phase: "process",
          error,
          attempt,
          item,
          readCount,
          writeCount,
          skipCount,
          signal,
          checkpoint
        };

        if (await shouldRetry(step.retryPolicy, retryContext)) {
          retryCount += 1;
          await emitBatchEvent(context.observer, {
            type: "retry",
            jobExecutionId: context.jobExecutionId,
            stepName: step.name,
            phase: "process",
            attempt,
            error
          });
          await backoff(step.retryPolicy, retryContext, signal);
          attempt += 1;
          continue;
        }

        if (await shouldSkip(step.skipPolicy, {
          phase: "process",
          error,
          item,
          readCount,
          writeCount,
          skipCount,
          signal,
          checkpoint
        })) {
          skipCount += 1;
          await emitBatchEvent(context.observer, {
            type: "item.skipped",
            jobExecutionId: context.jobExecutionId,
            stepName: step.name,
            item,
            error
          });
          return { skipped: true };
        }

        throw error;
      }
    }
  };

  const writeWithRetry = async (items: readonly Output[]): Promise<void> => {
    let attempt = 1;

    while (true) {
      try {
        await step.writer.write(items, {
          attempt,
          chunkIndex,
          signal,
          checkpoint
        });
        return;
      } catch (error) {
        const retryContext: ChunkRetryContext<Input, Output, TCheckpoint> = {
          phase: "write",
          error,
          attempt,
          items,
          readCount,
          writeCount,
          skipCount,
          signal,
          checkpoint
        };

        if (!(await shouldRetry(step.retryPolicy, retryContext))) {
          throw error;
        }

        retryCount += 1;
        await emitBatchEvent(context.observer, {
          type: "retry",
          jobExecutionId: context.jobExecutionId,
          stepName: step.name,
          phase: "write",
          attempt,
          error
        });
        await backoff(step.retryPolicy, retryContext, signal);
        attempt += 1;
      }
    }
  };

  const readerSession = await openReader(step.reader, readerContext);

  const flush = async (): Promise<void> => {
    if (chunk.length === 0) {
      return;
    }

    signal.throwIfAborted();
    const items = chunk;
    chunk = [];
    await writeWithRetry(items);
    writeCount += items.length;
    await emitBatchEvent(context.observer, {
      type: "chunk.written",
      jobExecutionId: context.jobExecutionId,
      stepName: step.name,
      chunkIndex,
      itemCount: items.length,
      readCount,
      writeCount,
      skipCount
    });

    const nextCheckpoint = step.checkpoint
      ? await step.checkpoint({
        executionId: context.jobExecutionId,
        stepName: step.name,
        chunkIndex,
        readCount,
        writeCount,
        skipCount,
        signal,
        checkpoint
      })
      : await getReaderCheckpoint(readerSession);

    if (nextCheckpoint !== undefined) {
      checkpoint = nextCheckpoint;
      await checkpointStore.write(context.jobExecutionId, step.name, checkpoint);
    }

    chunkIndex += 1;
  };

  try {
    for await (const item of readerSession) {
      signal.throwIfAborted();
      readCount += 1;
      const result = await processItem(item);

      if (result.skipped) {
        continue;
      }

      chunk.push(result.output);

      if (chunk.length >= step.chunkSize) {
        await flush();
      }
    }

    await flush();
  } finally {
    await closeReader(readerSession);
  }

  return {
    readCount,
    writeCount,
    skipCount,
    retryCount
  };
};

const shouldRetry = async <Input, Output, TCheckpoint>(
  policy: RetryPolicy<Input, Output, TCheckpoint> | undefined,
  context: ChunkRetryContext<Input, Output, TCheckpoint>
): Promise<boolean> => {
  return policy ? await policy.canRetry(context) : false;
};

const shouldSkip = async <Input, TCheckpoint>(
  policy: SkipPolicy<Input, TCheckpoint> | undefined,
  context: ChunkSkipContext<Input, TCheckpoint>
): Promise<boolean> => {
  return policy ? await policy.canSkip(context) : false;
};

const backoff = async <Input, Output, TCheckpoint>(
  policy: RetryPolicy<Input, Output, TCheckpoint> | undefined,
  context: ChunkRetryContext<Input, Output, TCheckpoint>,
  signal: AbortSignal
): Promise<void> => {
  const backoffMs = policy?.backoffMs ? await policy.backoffMs(context) : 0;

  if (!Number.isFinite(backoffMs) || backoffMs < 0) {
    throw new TypeError("Retry backoff must be a non-negative finite number.");
  }

  await delay(backoffMs, signal);
};
