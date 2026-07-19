import { errorToFailureReason, isAbortError } from "./errors.js";
import { runChunkStep } from "./chunk-step-runner.js";
import { emitBatchEvent } from "./events.js";
import { runTaskletStep } from "./tasklet-step-runner.js";
import type {
  AnyStepDefinition,
  BatchExecutionId,
  BatchStepExecutionId,
  DatabaseBatchStorage,
  StepExecution
} from "../types/index.js";
import type { StepRunContext, StepRunResult } from "./step-run-context.js";

export interface StepExecutionRunnerOptions {
  readonly storage: DatabaseBatchStorage;
  readonly generateStepExecutionId: (context: {
    readonly jobExecutionId: BatchExecutionId;
    readonly stepName: string;
    readonly stepIndex: number;
  }) => BatchStepExecutionId;
  readonly now: () => Date;
}

export const runStepExecution = async (
  step: AnyStepDefinition,
  context: StepRunContext,
  options: StepExecutionRunnerOptions
): Promise<StepRunResult> => {
  const { storage } = options;
  let execution: StepExecution = {
    id: options.generateStepExecutionId({
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
    createdAt: options.now()
  };

  await storage.repository.createStepExecution(execution);

  try {
    context.signal?.throwIfAborted();
    execution = {
      ...execution,
      status: "running",
      startedAt: options.now()
    };
    await storage.repository.updateStepExecution(execution);
    await emitBatchEvent(context.observer, { type: "step.started", execution });

    const result =
      step.kind === "chunk"
        ? await runChunkStep(step, context, storage.checkpointStore)
        : await runTaskletStep(step, context, storage.checkpointStore);

    execution = {
      ...execution,
      ...result,
      status: "completed",
      endedAt: options.now()
    };
    await storage.repository.updateStepExecution(execution);
    await emitBatchEvent(context.observer, { type: "step.completed", execution });

    return result;
  } catch (error) {
    execution = {
      ...execution,
      status: isAbortError(error) || context.signal?.aborted ? "cancelled" : "failed",
      endedAt: options.now(),
      failureReason: errorToFailureReason(error)
    };
    await storage.repository.updateStepExecution(execution);
    await emitBatchEvent(context.observer, {
      type: execution.status === "cancelled" ? "step.cancelled" : "step.failed",
      execution
    });

    throw error;
  }
};

export const recordCompletedRestartStepExecution = async (
  previousExecution: StepExecution,
  context: StepRunContext,
  options: StepExecutionRunnerOptions
): Promise<StepRunResult> => {
  const execution: StepExecution = {
    id: options.generateStepExecutionId({
      jobExecutionId: context.jobExecutionId,
      stepName: previousExecution.stepName,
      stepIndex: context.stepIndex
    }),
    jobExecutionId: context.jobExecutionId,
    stepName: previousExecution.stepName,
    status: "completed",
    readCount: previousExecution.readCount,
    writeCount: previousExecution.writeCount,
    skipCount: previousExecution.skipCount,
    retryCount: previousExecution.retryCount,
    createdAt: options.now(),
    startedAt: options.now(),
    endedAt: options.now()
  };

  await options.storage.repository.createStepExecution(execution);
  await emitBatchEvent(context.observer, { type: "step.completed", execution });

  return {
    readCount: execution.readCount,
    writeCount: execution.writeCount,
    skipCount: execution.skipCount,
    retryCount: execution.retryCount
  };
};
