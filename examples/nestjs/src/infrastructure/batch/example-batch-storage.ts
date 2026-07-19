import { DatabaseBatchStorage } from "@nest-batch/core";
import type {
  BatchExecutionId,
  CheckpointStore,
  JobExecution,
  JobRepository,
  LockAcquireOptions,
  LockHandle,
  LockManager,
  StepExecution
} from "@nest-batch/core";

class InMemoryJobRepository implements JobRepository {
  private readonly executions = new Map<BatchExecutionId, JobExecution>();
  private readonly stepExecutions = new Map<BatchExecutionId, StepExecution[]>();

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

class ExampleBatchStorage extends DatabaseBatchStorage {
  readonly repository = new InMemoryJobRepository();
  readonly checkpointStore = new InMemoryCheckpointStore();
  readonly lockManager = new InMemoryLockManager();
}

export const exampleBatchStorage = new ExampleBatchStorage();
