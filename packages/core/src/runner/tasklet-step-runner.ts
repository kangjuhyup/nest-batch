import type { CheckpointStore, TaskletStepDefinition } from "../types/index.js";
import { requireSignal } from "./signals.js";
import type { StepRunContext, StepRunResult } from "./step-run-context.js";

export const runTaskletStep = async <Input = unknown, Output = unknown>(
  step: TaskletStepDefinition<Input, Output>,
  context: StepRunContext,
  checkpointStore: CheckpointStore
): Promise<StepRunResult> => {
  const checkpoint = await checkpointStore.read(context.checkpointExecutionId, step.name);
  const output = await step.execute({
    input: context.input as Input | undefined,
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
};
