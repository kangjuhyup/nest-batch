import type { JobParameters } from "./common.js";
import type { AnyStepDefinition } from "./step.js";

export interface JobDefinition<Parameters extends JobParameters = JobParameters> {
  readonly name: string;
  readonly steps: readonly AnyStepDefinition[];
  readonly parametersSchema?: (parameters: unknown) => Parameters;
}
