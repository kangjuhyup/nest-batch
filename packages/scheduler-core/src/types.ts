import type {
  BatchExecutionId,
  BatchRunOptions,
  BatchRunner,
  JobDefinition,
  JobParameters,
  LockManager
} from "@nest-batch/core";
import type { WorkQueue, WorkUnit } from "@nest-batch/queue-core";

export type ScheduleOccurrenceStatus = "claimed" | "dispatched" | "failed";
export type ScheduleMisfirePolicy = "fire-once" | "fire-all";

export interface ScheduleTriggerContext {
  readonly after?: Date;
  readonly now: Date;
}

export interface ScheduleTrigger {
  getDueOccurrences(context: ScheduleTriggerContext): readonly Date[];
}

export interface ScheduleParametersContext {
  readonly scheduleName: string;
  readonly jobName: string;
  readonly occurrenceId: string;
  readonly scheduledAt: Date;
}

export interface ScheduleDefinition<Parameters extends JobParameters = JobParameters> {
  readonly name: string;
  readonly jobName: string;
  readonly trigger: ScheduleTrigger;
  readonly parameters?: Parameters | ((context: ScheduleParametersContext) => Parameters);
  readonly misfirePolicy?: ScheduleMisfirePolicy;
  readonly maxCatchUpOccurrences?: number;
  readonly runOptions?: Omit<BatchRunOptions, "executionId" | "signal" | "observer" | "restart">;
}

export interface ScheduleOccurrence {
  readonly scheduleName: string;
  readonly occurrenceId: string;
  readonly scheduledAt: Date;
  readonly status: ScheduleOccurrenceStatus;
  readonly ownerId?: string;
  readonly claimedAt?: Date;
  readonly claimExpiresAt?: Date;
  readonly dispatchedAt?: Date;
  readonly failedAt?: Date;
  readonly failureReason?: string;
}

export interface ScheduleOccurrenceCandidate {
  readonly scheduleName: string;
  readonly occurrenceId: string;
  readonly scheduledAt: Date;
}

export interface ScheduleClaimOptions {
  readonly ownerId: string;
  readonly claimedAt: Date;
  readonly claimTtlMs?: number;
}

export interface ScheduleMarkDispatchedOptions {
  readonly ownerId: string;
  readonly dispatchedAt: Date;
}

export interface ScheduleMarkFailedOptions {
  readonly ownerId: string;
  readonly failedAt: Date;
  readonly failureReason: string;
}

export interface ScheduleStore {
  findLatestOccurrence(scheduleName: string): Promise<ScheduleOccurrence | undefined>;
  claimOccurrence(
    occurrence: ScheduleOccurrenceCandidate,
    options: ScheduleClaimOptions
  ): Promise<ScheduleOccurrence | undefined>;
  markDispatched(
    occurrence: ScheduleOccurrence,
    options: ScheduleMarkDispatchedOptions
  ): Promise<boolean>;
  markFailed(occurrence: ScheduleOccurrence, options: ScheduleMarkFailedOptions): Promise<boolean>;
}

export interface ScheduleDispatchContext {
  readonly schedule: ScheduleDefinition;
  readonly occurrence: ScheduleOccurrence;
  readonly signal: AbortSignal;
}

export type ScheduleDispatcher = (context: ScheduleDispatchContext) => Promise<void> | void;

export interface SchedulerLoopOptions {
  readonly schedules: readonly ScheduleDefinition[];
  readonly store: ScheduleStore;
  readonly lockManager: LockManager;
  readonly dispatcher: ScheduleDispatcher;
  readonly ownerId: string;
  readonly lockTtlMs?: number;
  readonly claimTtlMs?: number;
  readonly pollIntervalMs?: number;
  readonly now?: () => Date;
}

export interface SchedulerTickOptions {
  readonly now?: Date;
  readonly signal?: AbortSignal;
}

export interface SchedulerTickResult {
  readonly scannedSchedules: number;
  readonly claimedOccurrences: number;
  readonly dispatchedOccurrences: number;
  readonly failedOccurrences: number;
}

export interface RunnerScheduleDispatcherOptions {
  readonly jobs: readonly JobDefinition[];
  readonly runner: BatchRunner;
  readonly ownerId?: string;
}

export interface QueueScheduleDispatcherOptions {
  readonly queue: WorkQueue;
  readonly workType?: string;
}

export interface ScheduledJobWorkPayload {
  readonly jobName: string;
  readonly parameters: JobParameters;
  readonly executionId: BatchExecutionId;
  readonly ownerId?: string;
  readonly lockTtlMs?: number;
  readonly restart?: false;
}

export type ScheduledJobWorkUnit = WorkUnit<ScheduledJobWorkPayload>;
