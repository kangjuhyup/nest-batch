import { randomUUID } from "node:crypto";
import { isSkipItem } from "./skip-item.js";
import type {
  AnyStepDefinition,
  BatchExecutionId,
  BatchRunOptions,
  BatchRunner,
  BatchStepExecutionId,
  ChunkStepDefinition,
  DatabaseBatchStorage,
  JobDefinition,
  JobExecution,
  JobParameters,
  StepExecution,
  TaskletStepDefinition
} from "./types/index.js";

export interface DefaultBatchRunnerOptions {
  readonly generateExecutionId?: () => BatchExecutionId;
  readonly generateStepExecutionId?: (context: {
    readonly jobExecutionId: BatchExecutionId;
    readonly stepName: string;
    readonly stepIndex: number;
  }) => BatchStepExecutionId;
  readonly generateOwnerId?: () => string;
  readonly now?: () => Date;
}

interface StepRunContext {
  readonly jobExecutionId: BatchExecutionId;
  readonly stepIndex: number;
  readonly input: unknown;
  readonly signal?: AbortSignal;
}

interface StepRunResult {
  readonly output?: unknown;
  readonly readCount: number;
  readonly writeCount: number;
  readonly skipCount: number;
  readonly retryCount: number;
}

export class DefaultBatchRunner implements BatchRunner {
  constructor(
    private readonly storage: DatabaseBatchStorage,
    private readonly options: DefaultBatchRunnerOptions = {}
  ) {}

  async run<Parameters extends JobParameters = JobParameters>(
    job: JobDefinition<Parameters>,
    parameters: Parameters,
    options: BatchRunOptions = {}
  ): Promise<JobExecution<Parameters>> {
    const executionId = options.executionId ?? this.generateExecutionId();
    const ownerId = options.ownerId ?? this.generateOwnerId();
    const lock = await this.storage.lockManager.acquire(`job-execution:${executionId}`, ownerId, {
      signal: options.signal,
      ttlMs: options.lockTtlMs
    });

    if (!lock) {
      throw new Error(`Job execution "${executionId}" is already locked.`);
    }

    let execution: JobExecution<Parameters> = {
      id: executionId,
      jobName: job.name,
      status: "created",
      parameters,
      createdAt: this.now()
    };
    let created = false;

    try {
      await this.storage.repository.create(execution);
      created = true;
      options.signal?.throwIfAborted();

      execution = {
        ...execution,
        status: "running",
        startedAt: this.now()
      };
      await this.storage.repository.update(execution);

      let input: unknown;

      for (const [stepIndex, step] of job.steps.entries()) {
        options.signal?.throwIfAborted();
        const result = await this.runStep(step, {
          jobExecutionId: executionId,
          stepIndex,
          input,
          signal: options.signal
        });
        input = result.output;
      }

      execution = {
        ...execution,
        status: "completed",
        endedAt: this.now()
      };
      await this.storage.repository.update(execution);

      return execution;
    } catch (error) {
      if (!created) {
        throw error;
      }

      execution = {
        ...execution,
        status: isAbortError(error) || options.signal?.aborted ? "cancelled" : "failed",
        endedAt: this.now(),
        failureReason: errorToFailureReason(error)
      };
      await this.storage.repository.update(execution);

      return execution;
    } finally {
      await this.storage.lockManager.release(lock);
    }
  }

  private async runStep(step: AnyStepDefinition, context: StepRunContext): Promise<StepRunResult> {
    let execution: StepExecution = {
      id: this.generateStepExecutionId({
        jobExecutionId: context.jobExecutionId,
        stepName: step.name,
        stepIndex: context.stepIndex
      }),
      jobExecutionId: context.jobExecutionId,
      stepName: step.name,
      status: "created",
      readCount: 0,
      writeCount: 0,
      skipCount: 0,
      retryCount: 0,
      createdAt: this.now()
    };

    await this.storage.repository.createStepExecution(execution);

    try {
      context.signal?.throwIfAborted();
      execution = {
        ...execution,
        status: "running",
        startedAt: this.now()
      };
      await this.storage.repository.updateStepExecution(execution);

      const result =
        step.kind === "chunk"
          ? await this.runChunkStep(step, context)
          : await this.runTaskletStep(step, context);

      execution = {
        ...execution,
        ...result,
        status: "completed",
        endedAt: this.now()
      };
      await this.storage.repository.updateStepExecution(execution);

      return result;
    } catch (error) {
      execution = {
        ...execution,
        status: isAbortError(error) || context.signal?.aborted ? "cancelled" : "failed",
        endedAt: this.now(),
        failureReason: errorToFailureReason(error)
      };
      await this.storage.repository.updateStepExecution(execution);

      throw error;
    }
  }

  private async runTaskletStep(
    step: TaskletStepDefinition,
    context: StepRunContext
  ): Promise<StepRunResult> {
    const checkpoint = await this.storage.checkpointStore.read(context.jobExecutionId, step.name);
    const output = await step.execute({
      input: context.input,
      signal: requireSignal(context.signal),
      checkpoint
    });

    return {
      output,
      readCount: 0,
      writeCount: 0,
      skipCount: 0,
      retryCount: 0
    };
  }

  private async runChunkStep<Input, Output, TCheckpoint>(
    step: ChunkStepDefinition<Input, Output, TCheckpoint>,
    context: StepRunContext
  ): Promise<StepRunResult> {
    let checkpoint = await this.storage.checkpointStore.read<TCheckpoint>(
      context.jobExecutionId,
      step.name
    );
    let readCount = 0;
    let writeCount = 0;
    let skipCount = 0;
    let chunkIndex = 0;
    let chunk: Output[] = [];
    const signal = requireSignal(context.signal);
    const readerContext = { signal, checkpoint };

    const flush = async (): Promise<void> => {
      if (chunk.length === 0) {
        return;
      }

      signal.throwIfAborted();
      const items = chunk;
      chunk = [];
      await step.writer.write(items, {
        attempt: 1,
        chunkIndex,
        signal,
        checkpoint
      });
      writeCount += items.length;

      if (step.checkpoint) {
        const nextCheckpoint = await step.checkpoint({
          executionId: context.jobExecutionId,
          stepName: step.name,
          chunkIndex,
          readCount,
          writeCount,
          skipCount,
          signal,
          checkpoint
        });

        if (nextCheckpoint !== undefined) {
          checkpoint = nextCheckpoint;
          await this.storage.checkpointStore.write(context.jobExecutionId, step.name, checkpoint);
        }
      }

      chunkIndex += 1;
    };

    for await (const item of toAsyncIterable(step.reader.read(readerContext))) {
      signal.throwIfAborted();
      readCount += 1;
      let output: Output | undefined;

      if (step.processor) {
        const processed = await step.processor.process(item, {
          item,
          index: readCount - 1,
          signal,
          checkpoint
        });

        if (isSkipItem(processed)) {
          skipCount += 1;
          continue;
        }

        output = processed as Output;
      } else {
        output = item as unknown as Output;
      }

      chunk.push(output);

      if (chunk.length >= step.chunkSize) {
        await flush();
      }
    }

    await flush();

    return {
      readCount,
      writeCount,
      skipCount,
      retryCount: 0
    };
  }

  private generateExecutionId(): BatchExecutionId {
    return this.options.generateExecutionId?.() ?? randomUUID();
  }

  private generateStepExecutionId(context: {
    readonly jobExecutionId: BatchExecutionId;
    readonly stepName: string;
    readonly stepIndex: number;
  }): BatchStepExecutionId {
    return (
      this.options.generateStepExecutionId?.(context) ??
      `${context.jobExecutionId}:${context.stepIndex}:${context.stepName}`
    );
  }

  private generateOwnerId(): string {
    return this.options.generateOwnerId?.() ?? randomUUID();
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

const requireSignal = (signal: AbortSignal | undefined): AbortSignal => {
  if (signal) {
    return signal;
  }

  return new AbortController().signal;
};

const toAsyncIterable = async function* <T>(items: AsyncIterable<T> | Iterable<T>): AsyncIterable<T> {
  for await (const item of items) {
    yield item;
  }
};

const isAbortError = (error: unknown): boolean => {
  return error instanceof Error && error.name === "AbortError";
};

const errorToFailureReason = (error: unknown): string => {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  return "Unknown batch execution failure.";
};
