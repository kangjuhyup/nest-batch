import type {
  BatchExecutionId,
  BatchStepExecutionId,
  JobExecution,
  JobExecutionAttempt,
  JobInstance,
  JobInstanceId,
  JobParametersHash,
  JobRepository,
  PartitionClaimOptions,
  PartitionExecution,
  StepExecution
} from "@nest-batch/core";
import {
  cloneJobExecution,
  cloneJobInstance,
  clonePartitionExecution,
  cloneStepExecution
} from "./mapper.js";

export class InMemoryJobRepository implements JobRepository {
  private readonly executions = new Map<BatchExecutionId, JobExecution>();
  private readonly instances = new Map<string, JobInstance>();
  private readonly stepExecutions = new Map<BatchExecutionId, StepExecution[]>();
  private readonly partitionExecutions = new Map<BatchStepExecutionId, PartitionExecution[]>();

  async createJobInstance(instance: JobInstance): Promise<JobInstance> {
    const stored = cloneJobInstance(instance);
    this.instances.set(this.instanceKey(instance.jobName, instance.parametersHash), stored);

    return cloneJobInstance(stored);
  }

  async findJobInstance(
    jobName: string,
    parametersHash: JobParametersHash
  ): Promise<JobInstance | undefined> {
    const instance = this.instances.get(this.instanceKey(jobName, parametersHash));

    return instance ? cloneJobInstance(instance) : undefined;
  }

  async findActiveJobExecution(instanceId: JobInstanceId): Promise<JobExecution | undefined> {
    const execution = [...this.executions.values()]
      .filter(
        (candidate) =>
          candidate.instanceId === instanceId &&
          (candidate.status === "created" || candidate.status === "running")
      )
      .sort(compareJobExecutionByCreatedAtAsc)[0];

    return execution ? cloneJobExecution(execution) : undefined;
  }

  async findLatestFailedJobExecution(instanceId: JobInstanceId): Promise<JobExecution | undefined> {
    const execution = [...this.executions.values()]
      .filter((candidate) => candidate.instanceId === instanceId && candidate.status === "failed")
      .sort(compareJobExecutionByCreatedAtDesc)[0];

    return execution ? cloneJobExecution(execution) : undefined;
  }

  async createExecutionAttempt(
    instance: JobInstance,
    execution: JobExecution
  ): Promise<JobExecutionAttempt> {
    const existingInstance =
      (await this.findJobInstance(instance.jobName, instance.parametersHash)) ??
      (await this.createJobInstance(instance));
    const activeExecution = await this.findActiveJobExecution(existingInstance.id);

    if (activeExecution) {
      return { instance: existingInstance, activeExecution };
    }

    await this.create({
      ...execution,
      instanceId: existingInstance.id
    });

    return { instance: existingInstance };
  }

  async create(execution: JobExecution): Promise<void> {
    this.executions.set(execution.id, cloneJobExecution(execution));
  }

  async update(execution: JobExecution): Promise<void> {
    this.executions.set(execution.id, cloneJobExecution(execution));
  }

  async findById(id: BatchExecutionId): Promise<JobExecution | undefined> {
    const execution = this.executions.get(id);

    return execution ? cloneJobExecution(execution) : undefined;
  }

  async createStepExecution(execution: StepExecution): Promise<void> {
    this.stepExecutions.set(execution.jobExecutionId, [
      ...(this.stepExecutions.get(execution.jobExecutionId) ?? []),
      cloneStepExecution(execution)
    ]);
  }

  async updateStepExecution(execution: StepExecution): Promise<void> {
    const executions = this.stepExecutions.get(execution.jobExecutionId) ?? [];
    this.stepExecutions.set(
      execution.jobExecutionId,
      executions.map((candidate) =>
        candidate.id === execution.id ? cloneStepExecution(execution) : candidate
      )
    );
  }

  async findStepExecutions(jobExecutionId: BatchExecutionId): Promise<readonly StepExecution[]> {
    return [...(this.stepExecutions.get(jobExecutionId) ?? [])]
      .sort(compareStepExecutionByCreatedAtAsc)
      .map(cloneStepExecution);
  }

  async createPartitionExecution(execution: PartitionExecution): Promise<void> {
    this.partitionExecutions.set(execution.stepExecutionId, [
      ...(this.partitionExecutions.get(execution.stepExecutionId) ?? []),
      clonePartitionExecution(execution)
    ]);
  }

  async updatePartitionExecution(execution: PartitionExecution): Promise<void> {
    const executions = this.partitionExecutions.get(execution.stepExecutionId) ?? [];
    this.partitionExecutions.set(
      execution.stepExecutionId,
      executions.map((candidate) =>
        candidate.id === execution.id ? clonePartitionExecution(execution) : candidate
      )
    );
  }

  async findPartitionExecutions(
    stepExecutionId: BatchStepExecutionId
  ): Promise<readonly PartitionExecution[]> {
    return [...(this.partitionExecutions.get(stepExecutionId) ?? [])]
      .sort(comparePartitionExecutionByCreatedAtAsc)
      .map(clonePartitionExecution);
  }

  async claimPartitionExecution(
    options: PartitionClaimOptions
  ): Promise<PartitionExecution | undefined> {
    const executions = this.partitionExecutions.get(options.stepExecutionId) ?? [];
    const partition = [...executions]
      .filter((candidate) => canClaimPartitionExecution(candidate, options))
      .sort(comparePartitionExecutionByCreatedAtAsc)[0];

    if (!partition) {
      return undefined;
    }

    const claimed: PartitionExecution = {
      ...partition,
      status: "running",
      ownerId: options.ownerId,
      heartbeatAt: options.now,
      claimExpiresAt: createClaimExpiresAt(options),
      startedAt: partition.startedAt ?? options.now
    };

    await this.updatePartitionExecution(claimed);

    return clonePartitionExecution(claimed);
  }

  async heartbeatPartitionExecution(id: string, ownerId: string, now: Date): Promise<boolean> {
    const execution = this.findPartitionExecutionById(id);

    if (!execution || execution.status !== "running" || execution.ownerId !== ownerId) {
      return false;
    }

    await this.updatePartitionExecution({
      ...execution,
      heartbeatAt: now
    });

    return true;
  }

  async completePartitionExecution(execution: PartitionExecution, ownerId: string): Promise<boolean> {
    return this.updateOwnedPartitionExecution(execution, ownerId);
  }

  async failPartitionExecution(execution: PartitionExecution, ownerId: string): Promise<boolean> {
    return this.updateOwnedPartitionExecution(execution, ownerId);
  }

  private instanceKey(jobName: string, parametersHash: JobParametersHash): string {
    return `${jobName}:${parametersHash}`;
  }

  private findPartitionExecutionById(id: string): PartitionExecution | undefined {
    for (const executions of this.partitionExecutions.values()) {
      const execution = executions.find((candidate) => candidate.id === id);

      if (execution) {
        return execution;
      }
    }

    return undefined;
  }

  private async updateOwnedPartitionExecution(
    execution: PartitionExecution,
    ownerId: string
  ): Promise<boolean> {
    const stored = this.findPartitionExecutionById(execution.id);

    if (!stored || stored.ownerId !== ownerId) {
      return false;
    }

    await this.updatePartitionExecution(execution);

    return true;
  }
}

const canClaimPartitionExecution = (
  execution: PartitionExecution,
  options: PartitionClaimOptions
): boolean => {
  if (execution.status === "created") {
    return true;
  }

  if (execution.status !== "running" || options.staleAfterMs === undefined) {
    return false;
  }

  const staleBefore = options.now.getTime() - options.staleAfterMs;
  return (execution.heartbeatAt?.getTime() ?? Number.POSITIVE_INFINITY) < staleBefore;
};

const createClaimExpiresAt = (options: PartitionClaimOptions): Date | undefined => {
  return options.staleAfterMs === undefined
    ? undefined
    : new Date(options.now.getTime() + options.staleAfterMs);
};

const compareJobExecutionByCreatedAtAsc = (left: JobExecution, right: JobExecution): number => {
  const diff = left.createdAt.getTime() - right.createdAt.getTime();
  return diff === 0 ? left.id.localeCompare(right.id) : diff;
};

const compareJobExecutionByCreatedAtDesc = (left: JobExecution, right: JobExecution): number => {
  const diff = right.createdAt.getTime() - left.createdAt.getTime();
  return diff === 0 ? right.id.localeCompare(left.id) : diff;
};

const compareStepExecutionByCreatedAtAsc = (left: StepExecution, right: StepExecution): number => {
  const diff = left.createdAt.getTime() - right.createdAt.getTime();
  return diff === 0 ? left.id.localeCompare(right.id) : diff;
};

const comparePartitionExecutionByCreatedAtAsc = (
  left: PartitionExecution,
  right: PartitionExecution
): number => {
  const diff = left.createdAt.getTime() - right.createdAt.getTime();
  return diff === 0 ? left.id.localeCompare(right.id) : diff;
};
