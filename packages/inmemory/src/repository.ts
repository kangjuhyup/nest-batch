import type {
  BatchExecutionId,
  JobExecution,
  JobInstance,
  JobInstanceId,
  JobParametersHash,
  JobRepository,
  StepExecution
} from "@nest-batch/core";

export class InMemoryJobRepository implements JobRepository {
  private readonly executions = new Map<BatchExecutionId, JobExecution>();
  private readonly instances = new Map<string, JobInstance>();
  private readonly stepExecutions = new Map<BatchExecutionId, StepExecution[]>();

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

  private instanceKey(jobName: string, parametersHash: JobParametersHash): string {
    return `${jobName}:${parametersHash}`;
  }
}

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

const cloneJobInstance = (instance: JobInstance): JobInstance => ({
  ...instance,
  createdAt: new Date(instance.createdAt.getTime())
});

const cloneJobExecution = (execution: JobExecution): JobExecution => ({
  ...execution,
  createdAt: new Date(execution.createdAt.getTime()),
  startedAt: cloneOptionalDate(execution.startedAt),
  endedAt: cloneOptionalDate(execution.endedAt)
});

const cloneStepExecution = (execution: StepExecution): StepExecution => ({
  ...execution,
  createdAt: new Date(execution.createdAt.getTime()),
  startedAt: cloneOptionalDate(execution.startedAt),
  endedAt: cloneOptionalDate(execution.endedAt)
});

const cloneOptionalDate = (date?: Date): Date | undefined => {
  return date ? new Date(date.getTime()) : undefined;
};
