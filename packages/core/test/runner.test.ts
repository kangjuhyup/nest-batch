import { describe, expect, it } from "vitest";
import {
  DatabaseBatchStorage,
  DefaultBatchRunner,
  defineChunkStep,
  defineJob,
  defineStep,
  skipItem
} from "../src/index.js";
import type {
  BatchExecutionId,
  CheckpointStore,
  JobExecution,
  JobRepository,
  LockAcquireOptions,
  LockHandle,
  LockManager,
  StepExecution
} from "../src/index.js";

class RecordingJobRepository implements JobRepository {
  readonly createdJobs: JobExecution[] = [];
  readonly updatedJobs: JobExecution[] = [];
  readonly createdSteps: StepExecution[] = [];
  readonly updatedSteps: StepExecution[] = [];
  private readonly jobs = new Map<BatchExecutionId, JobExecution>();
  private readonly steps = new Map<BatchExecutionId, StepExecution[]>();

  async create(execution: JobExecution): Promise<void> {
    this.createdJobs.push(execution);
    this.jobs.set(execution.id, execution);
  }

  async update(execution: JobExecution): Promise<void> {
    this.updatedJobs.push(execution);
    this.jobs.set(execution.id, execution);
  }

  async findById(id: BatchExecutionId): Promise<JobExecution | undefined> {
    return this.jobs.get(id);
  }

  async createStepExecution(execution: StepExecution): Promise<void> {
    this.createdSteps.push(execution);
    this.steps.set(execution.jobExecutionId, [
      ...(this.steps.get(execution.jobExecutionId) ?? []),
      execution
    ]);
  }

  async updateStepExecution(execution: StepExecution): Promise<void> {
    this.updatedSteps.push(execution);
    const executions = this.steps.get(execution.jobExecutionId) ?? [];
    this.steps.set(
      execution.jobExecutionId,
      executions.map((candidate) => (candidate.id === execution.id ? execution : candidate))
    );
  }

  async findStepExecutions(jobExecutionId: BatchExecutionId): Promise<readonly StepExecution[]> {
    return this.steps.get(jobExecutionId) ?? [];
  }
}

class RecordingCheckpointStore implements CheckpointStore {
  readonly writes: Array<{
    readonly executionId: BatchExecutionId;
    readonly stepName: string;
    readonly checkpoint: unknown;
  }> = [];
  private readonly checkpoints = new Map<string, unknown>();

  set(executionId: BatchExecutionId, stepName: string, checkpoint: unknown): void {
    this.checkpoints.set(this.key(executionId, stepName), checkpoint);
  }

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
    this.writes.push({ executionId, stepName, checkpoint });
    this.set(executionId, stepName, checkpoint);
  }

  async delete(executionId: BatchExecutionId, stepName: string): Promise<void> {
    this.checkpoints.delete(this.key(executionId, stepName));
  }

  private key(executionId: BatchExecutionId, stepName: string): string {
    return `${executionId}:${stepName}`;
  }
}

class RecordingLockManager implements LockManager {
  readonly acquired: Array<{
    readonly resource: string;
    readonly ownerId: string;
    readonly options?: LockAcquireOptions;
  }> = [];
  readonly released: LockHandle[] = [];

  async acquire(
    resource: string,
    ownerId: string,
    options?: LockAcquireOptions
  ): Promise<LockHandle | undefined> {
    this.acquired.push({ resource, ownerId, options });
    return { resource, ownerId };
  }

  async release(handle: LockHandle): Promise<void> {
    this.released.push(handle);
  }
}

class RecordingStorage extends DatabaseBatchStorage {
  readonly repository = new RecordingJobRepository();
  readonly checkpointStore = new RecordingCheckpointStore();
  readonly lockManager = new RecordingLockManager();
}

describe("default batch runner / 기본 batch runner", () => {
  it("runs tasklet steps and records execution transitions / tasklet step 실행 상태 전이를 저장한다", async () => {
    const storage = new RecordingStorage();
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "execution-1",
      generateStepExecutionId: ({ stepName }) => `execution-1:${stepName}`,
      generateOwnerId: () => "worker-1",
      now: createClock([
        "2026-07-19T00:00:00.000Z",
        "2026-07-19T00:00:01.000Z",
        "2026-07-19T00:00:02.000Z",
        "2026-07-19T00:00:03.000Z",
        "2026-07-19T00:00:04.000Z",
        "2026-07-19T00:00:05.000Z",
        "2026-07-19T00:00:06.000Z",
        "2026-07-19T00:00:07.000Z"
      ])
    });
    const first = defineStep({
      name: "load-users",
      execute() {
        return "loaded";
      }
    });
    const second = defineStep<string, string>({
      name: "notify-users",
      execute({ input }) {
        return `${input}:notified`;
      }
    });
    const job = defineJob({
      name: "daily-user-import",
      steps: [first, second]
    });

    const execution = await runner.run(job, { tenant: "acme" });

    expect(execution).toMatchObject({
      id: "execution-1",
      jobName: "daily-user-import",
      status: "completed",
      parameters: { tenant: "acme" }
    });
    expect(storage.repository.createdJobs).toHaveLength(1);
    expect(storage.repository.updatedJobs.map((jobExecution) => jobExecution.status)).toEqual([
      "running",
      "completed"
    ]);
    expect(storage.repository.createdSteps.map((step) => step.stepName)).toEqual([
      "load-users",
      "notify-users"
    ]);
    expect(storage.repository.updatedSteps.map((step) => step.status)).toEqual([
      "running",
      "completed",
      "running",
      "completed"
    ]);
    expect(storage.lockManager.acquired).toEqual([
      {
        resource: "job-execution:execution-1",
        ownerId: "worker-1",
        options: { signal: undefined, ttlMs: undefined }
      }
    ]);
    expect(storage.lockManager.released).toEqual([
      { resource: "job-execution:execution-1", ownerId: "worker-1" }
    ]);
  });

  it("runs chunk steps and checkpoints after successful writes / chunk write 성공 후 checkpoint를 저장한다", async () => {
    const storage = new RecordingStorage();
    storage.checkpointStore.set("execution-2", "copy-users", { cursor: 2 });
    const written: string[][] = [];
    const seenCheckpoints: unknown[] = [];
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "execution-2",
      generateStepExecutionId: ({ stepName }) => `execution-2:${stepName}`,
      generateOwnerId: () => "worker-1"
    });
    const step = defineChunkStep<string, string, { readonly cursor: number }>({
      name: "copy-users",
      chunkSize: 2,
      reader: {
        *read({ checkpoint }) {
          seenCheckpoints.push(checkpoint);
          yield "user-1";
          yield "inactive-user";
          yield "user-2";
        }
      },
      processor: {
        process(item) {
          return item === "inactive-user" ? skipItem("inactive user") : item.toUpperCase();
        }
      },
      writer: {
        write(items) {
          written.push([...items]);
        }
      },
      checkpoint({ readCount }) {
        return { cursor: readCount };
      }
    });
    const job = defineJob({
      name: "copy-users-job",
      steps: [step]
    });

    const execution = await runner.run(job, {});

    expect(execution.status).toBe("completed");
    expect(seenCheckpoints).toEqual([{ cursor: 2 }]);
    expect(written).toEqual([["USER-1", "USER-2"]]);
    expect(storage.checkpointStore.writes).toEqual([
      {
        executionId: "execution-2",
        stepName: "copy-users",
        checkpoint: { cursor: 3 }
      }
    ]);
    expect(storage.repository.updatedSteps.at(-1)).toMatchObject({
      stepName: "copy-users",
      status: "completed",
      readCount: 3,
      writeCount: 2,
      skipCount: 1,
      retryCount: 0
    });
  });

  it("marks job and step failed when a step throws / step 실패 시 job과 step을 실패로 기록한다", async () => {
    const storage = new RecordingStorage();
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "execution-3",
      generateStepExecutionId: ({ stepName }) => `execution-3:${stepName}`,
      generateOwnerId: () => "worker-1"
    });
    const job = defineJob({
      name: "failing-job",
      steps: [
        defineStep({
          name: "fail-step",
          execute() {
            throw new Error("writer unavailable");
          }
        })
      ]
    });

    const execution = await runner.run(job, {});

    expect(execution).toMatchObject({
      id: "execution-3",
      status: "failed",
      failureReason: "writer unavailable"
    });
    expect(storage.repository.updatedSteps.at(-1)).toMatchObject({
      stepName: "fail-step",
      status: "failed",
      failureReason: "writer unavailable"
    });
    expect(storage.repository.updatedJobs.at(-1)).toMatchObject({
      status: "failed",
      failureReason: "writer unavailable"
    });
    expect(storage.lockManager.released).toEqual([
      { resource: "job-execution:execution-3", ownerId: "worker-1" }
    ]);
  });
});

const createClock = (isoDates: readonly string[]): (() => Date) => {
  let index = 0;

  return () => new Date(isoDates[Math.min(index++, isoDates.length - 1)]!);
};
