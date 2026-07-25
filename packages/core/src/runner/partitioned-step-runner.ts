import type {
  JobRepository,
  JobParameters,
  PartitionExecution,
  PartitionExecutionResult,
  PartitionedStepDefinition
} from "../types/index.js";
import { errorToFailureReason, isAbortError } from "./errors.js";
import { requireSignal } from "./signals.js";
import {
  createStepRuntimeContext,
  type ActiveStepRunContext,
  type StepRunResult
} from "./step-run-context.js";

export interface PartitionedStepRunnerOptions {
  readonly repository: JobRepository;
  readonly stepExecutionId: string;
  readonly now: () => Date;
}

export const runPartitionedStep = async <
  TPartition,
  Parameters extends JobParameters = JobParameters
>(
  step: PartitionedStepDefinition<TPartition, Parameters>,
  context: ActiveStepRunContext<Parameters>,
  options: PartitionedStepRunnerOptions
): Promise<StepRunResult> => {
  const signal = requireSignal(context.signal);
  const partitions = await step.partitions();

  for (const [index, partition] of partitions.entries()) {
    signal.throwIfAborted();
    await options.repository.createPartitionExecution({
      id: createPartitionExecutionId(options.stepExecutionId, index),
      stepExecutionId: options.stepExecutionId,
      stepName: step.name,
      status: "created",
      partition,
      readCount: 0,
      writeCount: 0,
      skipCount: 0,
      retryCount: 0,
      createdAt: options.now()
    });
  }

  let firstError: unknown;
  const maxConcurrency = Math.min(step.maxConcurrency ?? 1, Math.max(partitions.length, 1));
  const workers = Array.from({ length: maxConcurrency }, (_, workerIndex) =>
    runPartitionWorker(step, context, options, workerIndex, signal, () => firstError, (error) => {
      firstError ??= error;
    })
  );

  await Promise.all(workers);

  if (firstError !== undefined) {
    throw firstError;
  }

  const executions = await options.repository.findPartitionExecutions(options.stepExecutionId);

  return aggregatePartitionExecutions(executions);
};

const runPartitionWorker = async <
  TPartition,
  Parameters extends JobParameters
>(
  step: PartitionedStepDefinition<TPartition, Parameters>,
  context: ActiveStepRunContext<Parameters>,
  options: PartitionedStepRunnerOptions,
  workerIndex: number,
  signal: AbortSignal,
  getFirstError: () => unknown,
  setFirstError: (error: unknown) => void
): Promise<void> => {
  while (getFirstError() === undefined) {
    try {
      signal.throwIfAborted();
      const claimed = await options.repository.claimPartitionExecution({
        stepExecutionId: options.stepExecutionId,
        ownerId: `${context.jobExecutionId}:${step.name}:partition-worker-${workerIndex}`,
        now: options.now()
      });

      if (!claimed) {
        return;
      }

      await executeClaimedPartition(step, context, options, claimed, signal);
    } catch (error) {
      setFirstError(error);
      return;
    }
  }
};

const executeClaimedPartition = async <
  TPartition,
  Parameters extends JobParameters
>(
  step: PartitionedStepDefinition<TPartition, Parameters>,
  context: ActiveStepRunContext<Parameters>,
  options: PartitionedStepRunnerOptions,
  claimed: PartitionExecution,
  signal: AbortSignal
): Promise<void> => {
  try {
    signal.throwIfAborted();
    const result = await step.execute(claimed.partition as TPartition, {
      ...createStepRuntimeContext(context, signal, undefined),
      jobExecutionId: context.jobExecutionId,
      stepExecutionId: options.stepExecutionId,
      partitionExecutionId: claimed.id,
      stepName: step.name,
      partition: claimed.partition as TPartition,
      signal
    });
    const counts = normalizePartitionExecutionResult(result);

    await options.repository.updatePartitionExecution({
      ...claimed,
      ...counts,
      status: "completed",
      endedAt: options.now()
    });
  } catch (error) {
    await options.repository.updatePartitionExecution({
      ...claimed,
      status: isAbortError(error) || signal.aborted ? "cancelled" : "failed",
      endedAt: options.now(),
      failureReason: errorToFailureReason(error)
    });
    throw error;
  }
};

const normalizePartitionExecutionResult = (
  result: PartitionExecutionResult | void
): Required<PartitionExecutionResult> => ({
  readCount: normalizePartitionCount(result?.readCount, "readCount"),
  writeCount: normalizePartitionCount(result?.writeCount, "writeCount"),
  skipCount: normalizePartitionCount(result?.skipCount, "skipCount"),
  retryCount: normalizePartitionCount(result?.retryCount, "retryCount")
});

const normalizePartitionCount = (value: number | undefined, fieldName: string): number => {
  const count = value ?? 0;

  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError(`Partition execution ${fieldName} must be a non-negative safe integer.`);
  }

  return count;
};

const aggregatePartitionExecutions = (
  executions: readonly PartitionExecution[]
): StepRunResult => ({
  readCount: executions.reduce((sum, execution) => sum + execution.readCount, 0),
  writeCount: executions.reduce((sum, execution) => sum + execution.writeCount, 0),
  skipCount: executions.reduce((sum, execution) => sum + execution.skipCount, 0),
  retryCount: executions.reduce((sum, execution) => sum + execution.retryCount, 0)
});

const createPartitionExecutionId = (stepExecutionId: string, index: number): string => {
  return `${stepExecutionId}:partition:${index.toString().padStart(6, "0")}`;
};
