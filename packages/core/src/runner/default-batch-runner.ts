import { randomUUID } from "node:crypto";
import { createJobInstanceId, hashJobParameters } from "../parameters.js";
import type {
  BatchExecutionId,
  BatchObserver,
  BatchRunOptions,
  BatchRunner,
  BatchStepExecutionId,
  DatabaseBatchStorage,
  ExecutionEngine,
  JobDefinition,
  JobExecution,
  JobInstance,
  JobParameters,
  StepExecution
} from "../types/index.js";
import { errorToFailureReason, isAbortError } from "./errors.js";
import { emitBatchEvent } from "./events.js";
import {
  recordCompletedRestartStepExecution,
  runStepExecution
} from "./step-execution-runner.js";

export interface DefaultBatchRunnerOptions {
  readonly generateExecutionId?: () => BatchExecutionId;
  readonly generateStepExecutionId?: (context: {
    readonly jobExecutionId: BatchExecutionId;
    readonly stepName: string;
    readonly stepIndex: number;
  }) => BatchStepExecutionId;
  readonly generateOwnerId?: () => string;
  readonly now?: () => Date;
  readonly observer?: BatchObserver;
}

export class DefaultBatchRunner implements BatchRunner, ExecutionEngine {
  constructor(
    private readonly storage: DatabaseBatchStorage,
    private readonly options: DefaultBatchRunnerOptions = {}
  ) {}

  async runJob<Parameters extends JobParameters = JobParameters>(
    job: JobDefinition<Parameters>,
    parameters: Parameters,
    options: BatchRunOptions = {}
  ): Promise<JobExecution<Parameters>> {
    return this.run(job, parameters, options);
  }

  async run<Parameters extends JobParameters = JobParameters>(
    job: JobDefinition<Parameters>,
    parameters: Parameters,
    options: BatchRunOptions = {}
  ): Promise<JobExecution<Parameters>> {
    const observer = options.observer ?? this.options.observer;
    const eventListeners = job.listeners ?? [];
    const executionId = options.executionId ?? this.generateExecutionId();
    const ownerId = options.ownerId ?? this.generateOwnerId();
    const parametersHash = hashJobParameters(parameters);
    const instanceId = createJobInstanceId(job.name, parametersHash);
    const lock = await this.storage.lockManager.acquire(`job-instance:${instanceId}`, ownerId, {
      signal: options.signal,
      ttlMs: options.lockTtlMs
    });

    if (!lock) {
      throw new Error(`Job instance "${instanceId}" is already locked.`);
    }

    let execution: JobExecution<Parameters> | undefined;
    let created = false;

    try {
      const candidateInstance: JobInstance<Parameters> = {
        id: instanceId,
        jobName: job.name,
        parameters,
        parametersHash,
        createdAt: this.now()
      };
      const instance = options.restart
        ? ((await this.storage.repository.findJobInstance(
            candidateInstance.jobName,
            candidateInstance.parametersHash
          )) as JobInstance<Parameters> | undefined)
        : candidateInstance;

      if (!instance) {
        throw new Error(`Job instance "${instanceId}" has no failed execution to restart.`);
      }

      const restartExecution = options.restart
        ? await this.storage.repository.findLatestFailedJobExecution(instance.id)
        : undefined;

      if (options.restart && !restartExecution) {
        throw new Error(`Job instance "${instance.id}" has no failed execution to restart.`);
      }

      const checkpointExecutionId = restartExecution?.id ?? executionId;
      const restartStepExecutions = restartExecution
        ? await this.storage.repository.findStepExecutions(restartExecution.id)
        : [];
      const restartStepExecutionsByName = toLatestStepExecutionByName(restartStepExecutions);

      execution = {
        id: executionId,
        instanceId: instance.id,
        jobName: job.name,
        status: "created",
        parameters,
        createdAt: this.now()
      };
      const attempt = await this.storage.repository.createExecutionAttempt(instance, execution);

      if (attempt.activeExecution) {
        throw new Error(
          `Job instance "${attempt.instance.id}" already has active execution "${attempt.activeExecution.id}".`
        );
      }

      execution = {
        ...execution,
        instanceId: attempt.instance.id
      };
      created = true;
      options.signal?.throwIfAborted();

      execution = {
        ...execution,
        status: "running",
        startedAt: this.now()
      };
      await this.storage.repository.update(execution);
      await emitBatchEvent(observer, { type: "job.started", execution }, eventListeners);

      let input: unknown;
      let reachedRestartStartStep = !restartExecution;

      for (const [stepIndex, step] of job.steps.entries()) {
        options.signal?.throwIfAborted();
        const restartStepExecution = restartStepExecutionsByName.get(step.name);
        const shouldSkipCompletedRestartStep =
          !reachedRestartStartStep && restartStepExecution?.status === "completed";

        if (shouldSkipCompletedRestartStep) {
          await recordCompletedRestartStepExecution(
            restartStepExecution,
            {
              jobName: job.name,
              jobExecutionId: executionId,
              checkpointExecutionId,
              stepIndex,
              input,
              parameters,
              restart: true,
              restartFromExecutionId: restartExecution!.id,
              signal: options.signal,
              observer,
              eventListeners
            },
            {
              storage: this.storage,
              generateStepExecutionId: (context) => this.generateStepExecutionId(context),
              now: () => this.now()
            }
          );
          input = undefined;
          continue;
        }

        reachedRestartStartStep = true;
        const result = await runStepExecution(
          step,
          {
            jobName: job.name,
            jobExecutionId: executionId,
            checkpointExecutionId,
            stepIndex,
            input,
            parameters,
            restart: Boolean(restartExecution),
            restartFromExecutionId: restartExecution?.id,
            signal: options.signal,
            observer,
            eventListeners
          },
          {
            storage: this.storage,
            generateStepExecutionId: (context) => this.generateStepExecutionId(context),
            now: () => this.now()
          }
        );
        input = result.output;
      }

      execution = {
        ...execution,
        status: "completed",
        endedAt: this.now()
      };
      await this.storage.repository.update(execution);
      await emitBatchEvent(observer, { type: "job.completed", execution }, eventListeners);

      return execution;
    } catch (error) {
      if (!created || !execution) {
        throw error;
      }

      execution = {
        ...execution,
        status: isAbortError(error) || options.signal?.aborted ? "cancelled" : "failed",
        endedAt: this.now(),
        failureReason: errorToFailureReason(error)
      };
      await this.storage.repository.update(execution);
      await emitBatchEvent(observer, {
        type: execution.status === "cancelled" ? "job.cancelled" : "job.failed",
        execution
      }, eventListeners);

      return execution;
    } finally {
      await this.storage.lockManager.release(lock);
    }
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

const toLatestStepExecutionByName = (
  stepExecutions: readonly StepExecution[]
): ReadonlyMap<string, StepExecution> => {
  const executionsByName = new Map<string, StepExecution>();

  for (const execution of stepExecutions) {
    const current = executionsByName.get(execution.stepName);

    if (!current || compareStepExecutionByCreatedAtAsc(current, execution) <= 0) {
      executionsByName.set(execution.stepName, execution);
    }
  }

  return executionsByName;
};

const compareStepExecutionByCreatedAtAsc = (left: StepExecution, right: StepExecution): number => {
  const diff = left.createdAt.getTime() - right.createdAt.getTime();
  return diff === 0 ? left.id.localeCompare(right.id) : diff;
};
