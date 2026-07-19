import { randomUUID } from "node:crypto";
import { createJobInstanceId, hashJobParameters } from "../parameters.js";
import type {
  BatchExecutionId,
  BatchRunOptions,
  BatchRunner,
  BatchStepExecutionId,
  DatabaseBatchStorage,
  JobDefinition,
  JobExecution,
  JobInstance,
  JobParameters
} from "../types/index.js";
import { errorToFailureReason, isAbortError } from "./errors.js";
import { runStepExecution } from "./step-execution-runner.js";

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
        : await this.findOrCreateJobInstance(candidateInstance);

      if (!instance) {
        throw new Error(`Job instance "${instanceId}" has no failed execution to restart.`);
      }

      const activeExecution = await this.storage.repository.findActiveJobExecution(instance.id);

      if (activeExecution) {
        throw new Error(
          `Job instance "${instance.id}" already has active execution "${activeExecution.id}".`
        );
      }

      const restartExecution = options.restart
        ? await this.storage.repository.findLatestFailedJobExecution(instance.id)
        : undefined;

      if (options.restart && !restartExecution) {
        throw new Error(`Job instance "${instance.id}" has no failed execution to restart.`);
      }

      const checkpointExecutionId = restartExecution?.id ?? executionId;

      execution = {
        id: executionId,
        instanceId: instance.id,
        jobName: job.name,
        status: "created",
        parameters,
        createdAt: this.now()
      };
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
        const result = await runStepExecution(
          step,
          {
            jobExecutionId: executionId,
            checkpointExecutionId,
            stepIndex,
            input,
            signal: options.signal
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

      return execution;
    } finally {
      await this.storage.lockManager.release(lock);
    }
  }

  private async findOrCreateJobInstance<Parameters extends JobParameters>(
    instance: JobInstance<Parameters>
  ): Promise<JobInstance<Parameters>> {
    const existing = await this.storage.repository.findJobInstance(
      instance.jobName,
      instance.parametersHash
    );

    if (existing) {
      return existing as JobInstance<Parameters>;
    }

    return (await this.storage.repository.createJobInstance(instance)) as JobInstance<Parameters>;
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
