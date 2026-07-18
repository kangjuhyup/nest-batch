import type { JobDefinition, JobParameters, StepDefinition } from "./types.js";

const assertName = (kind: "Job" | "Step", name: string): void => {
  if (name.trim().length === 0) {
    throw new Error(`${kind} name is required.`);
  }
};

export const defineStep = <Input = unknown, Output = unknown>(
  definition: StepDefinition<Input, Output>
): StepDefinition<Input, Output> => {
  assertName("Step", definition.name);

  return Object.freeze({
    ...definition,
    name: definition.name.trim()
  });
};

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
