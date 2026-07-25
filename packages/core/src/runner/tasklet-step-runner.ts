import type { CheckpointStore, JobParameters, TaskletStepDefinition } from "../types/index.js";
import { requireSignal } from "./signals.js";
import {
  createStepRuntimeContext,
  type ActiveStepRunContext,
  type StepRunResult
} from "./step-run-context.js";

export const runTaskletStep = async <
  Input = unknown,
  Output = unknown,
  Parameters extends JobParameters = JobParameters
>(
  step: TaskletStepDefinition<Input, Output, Parameters>,
  context: ActiveStepRunContext<Parameters>,
  checkpointStore: CheckpointStore
): Promise<StepRunResult> => {
  const checkpoint = await checkpointStore.read(context.checkpointExecutionId, step.name);
  const signal = requireSignal(context.signal);
  const output = await step.execute({
    ...createStepRuntimeContext(context, signal, checkpoint),
    input: context.input as Input | undefined,
    checkpoint
  });

  return {
    output,
    readCount: 0,
    writeCount: 0,
    skipCount: 0,
    retryCount: 0
  };
};
