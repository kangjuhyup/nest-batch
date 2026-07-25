import type { JobParameters } from "./common.js";
import type {
  BatchEvent,
  BatchEventType,
  JobCancelledBatchEvent,
  JobCompletedBatchEvent,
  JobFailedBatchEvent,
  JobStartedBatchEvent,
  StepFailedBatchEvent
} from "./runner.js";
import type { AnyStepDefinition } from "./step.js";

export type BatchEventByType<Type extends BatchEventType> = Extract<BatchEvent, { readonly type: Type }>;

export type BatchEventListener<Event extends BatchEvent = BatchEvent> = (
  event: Event
) => Promise<void> | void;

export interface BatchEventListenerRegistration<Event extends BatchEvent = BatchEvent> {
  readonly type?: Event["type"];
  readonly listener: BatchEventListener<Event>;
}

export interface JobDefinition<Parameters extends JobParameters = JobParameters> {
  readonly name: string;
  readonly steps: readonly AnyStepDefinition[];
  readonly parametersSchema?: (parameters: unknown) => Parameters;
  readonly listeners?: readonly BatchEventListenerRegistration[];
}

export interface ChainableJobDefinition<Parameters extends JobParameters = JobParameters>
  extends JobDefinition<Parameters> {
  onEvent<Type extends BatchEventType>(
    type: Type,
    listener: BatchEventListener<BatchEventByType<Type>>
  ): ChainableJobDefinition<Parameters>;
  onStart(listener: BatchEventListener<JobStartedBatchEvent>): ChainableJobDefinition<Parameters>;
  onSuccess(listener: BatchEventListener<JobCompletedBatchEvent>): ChainableJobDefinition<Parameters>;
  onFailure(listener: BatchEventListener<JobFailedBatchEvent>): ChainableJobDefinition<Parameters>;
  onCancel(listener: BatchEventListener<JobCancelledBatchEvent>): ChainableJobDefinition<Parameters>;
  onStepFailure(listener: BatchEventListener<StepFailedBatchEvent>): ChainableJobDefinition<Parameters>;
}
