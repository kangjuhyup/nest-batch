import { DatabaseBatchStorage } from "@nest-batch/core";
import type {
  BatchExecutionId,
  CheckpointStore,
  JobExecution,
  JobInstance,
  JobInstanceId,
  JobParametersHash,
  JobRepository,
  LockAcquireOptions,
  LockHandle,
  LockManager,
  StepExecution
} from "@nest-batch/core";

class InMemoryJobRepository implements JobRepository {
  private readonly executions = new Map<BatchExecutionId, JobExecution>();
  private readonly instances = new Map<string, JobInstance>();
  private readonly stepExecutions = new Map<BatchExecutionId, StepExecution[]>();

  async createJobInstance(instance: JobInstance): Promise<JobInstance> {
    this.instances.set(this.instanceKey(instance.jobName, instance.parametersHash), instance);
    return instance;
  }

  async findJobInstance(
    jobName: string,
    parametersHash: JobParametersHash
  ): Promise<JobInstance | undefined> {
    return this.instances.get(this.instanceKey(jobName, parametersHash));
  }

  async findActiveJobExecution(instanceId: JobInstanceId): Promise<JobExecution | undefined> {
    return [...this.executions.values()].find(
      (execution) =>
        execution.instanceId === instanceId &&
        (execution.status === "created" || execution.status === "running")
    );
  }

  async findLatestFailedJobExecution(instanceId: JobInstanceId): Promise<JobExecution | undefined> {
    return [...this.executions.values()]
      .filter((execution) => execution.instanceId === instanceId && execution.status === "failed")
      .sort(compareJobExecutionByCreatedAtDesc)[0];
  }

  async create(execution: JobExecution): Promise<void> {
    this.executions.set(execution.id, execution);
  }

  async update(execution: JobExecution): Promise<void> {
    this.executions.set(execution.id, execution);
  }

  async findById(id: BatchExecutionId): Promise<JobExecution | undefined> {
    return this.executions.get(id);
  }

  async createStepExecution(execution: StepExecution): Promise<void> {
    this.stepExecutions.set(execution.jobExecutionId, [
      ...(this.stepExecutions.get(execution.jobExecutionId) ?? []),
      execution
    ]);
  }

  async updateStepExecution(execution: StepExecution): Promise<void> {
    const executions = this.stepExecutions.get(execution.jobExecutionId) ?? [];
    this.stepExecutions.set(
      execution.jobExecutionId,
      executions.map((candidate) => (candidate.id === execution.id ? execution : candidate))
    );
  }

  async findStepExecutions(jobExecutionId: BatchExecutionId): Promise<readonly StepExecution[]> {
    return this.stepExecutions.get(jobExecutionId) ?? [];
  }

  private instanceKey(jobName: string, parametersHash: JobParametersHash): string {
    return `${jobName}:${parametersHash}`;
  }
}

class InMemoryCheckpointStore implements CheckpointStore {
  private readonly checkpoints = new Map<string, unknown>();

  async read<TCheckpoint = unknown>(
    executionId: BatchExecutionId,
    stepName: string
  ): Promise<TCheckpoint | undefined> {
    return this.checkpoints.get(this.key(executionId, stepName)) as TCheckpoint | undefined;
  }

  async write<TCheckpoint = unknown>(
    executionId: BatchExecutionId,
    stepName: string,
    checkpoint: TCheckpoint
  ): Promise<void> {
    this.checkpoints.set(this.key(executionId, stepName), checkpoint);
  }

  async delete(executionId: BatchExecutionId, stepName: string): Promise<void> {
    this.checkpoints.delete(this.key(executionId, stepName));
  }

  private key(executionId: BatchExecutionId, stepName: string): string {
    return `${executionId}:${stepName}`;
  }
}

class InMemoryLockManager implements LockManager {
  private readonly locks = new Map<string, LockHandle>();

  async acquire(
    resource: string,
    ownerId: string,
    options: LockAcquireOptions = {}
  ): Promise<LockHandle | undefined> {
    options.signal?.throwIfAborted();

    const existing = this.locks.get(resource);
    if (existing && (!existing.expiresAt || existing.expiresAt.getTime() > Date.now())) {
      return undefined;
    }

    const handle: LockHandle = {
      resource,
      ownerId,
      expiresAt: options.ttlMs === undefined ? undefined : new Date(Date.now() + options.ttlMs)
    };
    this.locks.set(resource, handle);

    return handle;
  }

  async release(handle: LockHandle): Promise<void> {
    const current = this.locks.get(handle.resource);
    if (current?.ownerId === handle.ownerId) {
      this.locks.delete(handle.resource);
    }
  }
}

export class InMemoryBatchStorage extends DatabaseBatchStorage {
  readonly repository = new InMemoryJobRepository();
  readonly checkpointStore = new InMemoryCheckpointStore();
  readonly lockManager = new InMemoryLockManager();
}

const compareJobExecutionByCreatedAtDesc = (left: JobExecution, right: JobExecution): number => {
  const diff = right.createdAt.getTime() - left.createdAt.getTime();
  return diff === 0 ? right.id.localeCompare(left.id) : diff;
};
