import { describe, expect, it } from "vitest";
import {
  DatabaseBatchStorage,
  DefaultBatchRunner,
  createJobInstanceId,
  defineChunkStep,
  defineJob,
  defineStep,
  hashJobParameters,
  skipItem
} from "../src/index.js";
import type {
  BatchExecutionId,
  CheckpointStore,
  JobExecution,
  JobInstance,
  JobRepository,
  LockAcquireOptions,
  LockHandle,
  LockManager,
  StepExecution
} from "../src/index.js";

class RecordingJobRepository implements JobRepository {
  readonly createdJobs: JobExecution[] = [];
  readonly updatedJobs: JobExecution[] = [];
  readonly createdInstances: JobInstance[] = [];
  readonly createdSteps: StepExecution[] = [];
  readonly updatedSteps: StepExecution[] = [];
  private readonly jobs = new Map<BatchExecutionId, JobExecution>();
  private readonly instances = new Map<string, JobInstance>();
  private readonly steps = new Map<BatchExecutionId, StepExecution[]>();

  async createJobInstance(instance: JobInstance): Promise<JobInstance> {
    this.createdInstances.push(instance);
    this.instances.set(this.instanceKey(instance.jobName, instance.parametersHash), instance);
    return instance;
  }

  async findJobInstance(jobName: string, parametersHash: string): Promise<JobInstance | undefined> {
    return this.instances.get(this.instanceKey(jobName, parametersHash));
  }

  async findActiveJobExecution(instanceId: string): Promise<JobExecution | undefined> {
    return [...this.jobs.values()].find(
      (execution) =>
        execution.instanceId === instanceId &&
        (execution.status === "created" || execution.status === "running")
    );
  }

  async findLatestFailedJobExecution(instanceId: string): Promise<JobExecution | undefined> {
    return [...this.jobs.values()]
      .filter((execution) => execution.instanceId === instanceId && execution.status === "failed")
      .sort(compareJobExecutionByCreatedAtDesc)[0];
  }

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

  private instanceKey(jobName: string, parametersHash: string): string {
    return `${jobName}:${parametersHash}`;
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
      instanceId: "sha256:58fccba6618851f33ee6c933a6a55154e9ffa280ae84f901695c5d430f7f9a8a",
      jobName: "daily-user-import",
      status: "completed",
      parameters: { tenant: "acme" }
    });
    expect(storage.repository.createdInstances).toEqual([
      {
        id: "sha256:58fccba6618851f33ee6c933a6a55154e9ffa280ae84f901695c5d430f7f9a8a",
        jobName: "daily-user-import",
        parameters: { tenant: "acme" },
        parametersHash: "sha256:b9510057a95822a002724d80c6956d174ce18252a8b40ef5820ae380888199f1",
        createdAt: new Date("2026-07-19T00:00:00.000Z")
      }
    ]);
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
        resource: "job-instance:sha256:58fccba6618851f33ee6c933a6a55154e9ffa280ae84f901695c5d430f7f9a8a",
        ownerId: "worker-1",
        options: { signal: undefined, ttlMs: undefined }
      }
    ]);
    expect(storage.lockManager.released).toEqual([
      {
        resource: "job-instance:sha256:58fccba6618851f33ee6c933a6a55154e9ffa280ae84f901695c5d430f7f9a8a",
        ownerId: "worker-1"
      }
    ]);
  });

  it("rejects duplicate active job instances / 실행 중인 같은 job instance를 거부한다", async () => {
    const storage = new RecordingStorage();
    const runningInstance: JobInstance = {
      id: "duplicate-instance",
      jobName: "daily-user-import",
      parameters: { tenant: "acme" },
      parametersHash: "sha256:b9510057a95822a002724d80c6956d174ce18252a8b40ef5820ae380888199f1",
      createdAt: new Date("2026-07-19T00:00:00.000Z")
    };
    await storage.repository.createJobInstance(runningInstance);
    await storage.repository.create({
      id: "running-execution",
      instanceId: runningInstance.id,
      jobName: "daily-user-import",
      status: "running",
      parameters: { tenant: "acme" },
      createdAt: new Date("2026-07-19T00:01:00.000Z"),
      startedAt: new Date("2026-07-19T00:02:00.000Z")
    });
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "duplicate-execution",
      generateOwnerId: () => "worker-1"
    });
    const job = defineJob({
      name: "daily-user-import",
      steps: [
        defineStep({
          name: "load-users",
          execute() {
            return "loaded";
          }
        })
      ]
    });

    await expect(runner.run(job, { tenant: "acme" })).rejects.toThrow(
      'Job instance "duplicate-instance" already has active execution "running-execution".'
    );
    expect(storage.repository.createdJobs).toHaveLength(1);
    expect(storage.repository.createdSteps).toHaveLength(0);
    expect(storage.lockManager.acquired).toEqual([
      {
        resource: "job-instance:sha256:58fccba6618851f33ee6c933a6a55154e9ffa280ae84f901695c5d430f7f9a8a",
        ownerId: "worker-1",
        options: { signal: undefined, ttlMs: undefined }
      }
    ]);
    expect(storage.lockManager.released).toEqual([
      {
        resource: "job-instance:sha256:58fccba6618851f33ee6c933a6a55154e9ffa280ae84f901695c5d430f7f9a8a",
        ownerId: "worker-1"
      }
    ]);
  });

  it("creates a new execution after a completed job instance / 완료된 job instance는 새 execution을 허용한다", async () => {
    const storage = new RecordingStorage();
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "second-execution",
      generateStepExecutionId: ({ stepName }) => `second-execution:${stepName}`,
      generateOwnerId: () => "worker-1"
    });
    const first = await runner.run(
      defineJob({
        name: "daily-user-import",
        steps: [
          defineStep({
            name: "load-users",
            execute() {
              return "loaded";
            }
          })
        ]
      }),
      { tenant: "acme" }
    );

    expect(first.status).toBe("completed");

    const second = await runner.run(
      defineJob({
        name: "daily-user-import",
        steps: [
          defineStep({
            name: "load-users-again",
            execute() {
              return "loaded-again";
            }
          })
        ]
      }),
      { tenant: "acme" }
    );

    expect(second).toMatchObject({
      id: "second-execution",
      instanceId: first.instanceId,
      status: "completed"
    });
    expect(storage.repository.createdInstances).toHaveLength(1);
    expect(storage.repository.createdJobs).toHaveLength(2);
  });

  it("uses stable parameter hashes for job instances / parameter 순서와 무관하게 같은 job instance를 사용한다", async () => {
    const storage = new RecordingStorage();
    const executionIds = ["ordered-execution-1", "ordered-execution-2"];
    let executionIndex = 0;
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => executionIds[executionIndex++]!,
      generateStepExecutionId: ({ jobExecutionId, stepName }) => `${jobExecutionId}:${stepName}`,
      generateOwnerId: () => "worker-1"
    });
    const job = defineJob({
      name: "ordered-parameters-job",
      steps: [
        defineStep({
          name: "load-users",
          execute() {
            return "loaded";
          }
        })
      ]
    });

    const first = await runner.run(job, { tenant: "acme", run: 1 });
    const second = await runner.run(job, { run: 1, tenant: "acme" });

    expect(second.instanceId).toBe(first.instanceId);
    expect(storage.repository.createdInstances).toHaveLength(1);
    expect(storage.repository.createdJobs.map((execution) => execution.id)).toEqual([
      "ordered-execution-1",
      "ordered-execution-2"
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

  it("restarts chunk steps from a failed execution checkpoint / 실패 execution checkpoint부터 chunk step을 재시작한다", async () => {
    const storage = new RecordingStorage();
    const parameters = { tenant: "acme" };
    const instance = createJobInstance("restartable-copy-job", parameters);
    await storage.repository.createJobInstance(instance);
    await storage.repository.create({
      id: "failed-execution",
      instanceId: instance.id,
      jobName: "restartable-copy-job",
      status: "failed",
      parameters,
      createdAt: new Date("2026-07-19T00:00:00.000Z"),
      startedAt: new Date("2026-07-19T00:01:00.000Z"),
      endedAt: new Date("2026-07-19T00:02:00.000Z"),
      failureReason: "writer unavailable"
    });
    storage.checkpointStore.set("failed-execution", "copy-users", { cursor: 2 });
    const written: number[][] = [];
    const seenCheckpoints: unknown[] = [];
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "restart-execution",
      generateStepExecutionId: ({ stepName }) => `restart-execution:${stepName}`,
      generateOwnerId: () => "worker-1"
    });
    const step = defineChunkStep<number, number, { readonly cursor: number }>({
      name: "copy-users",
      chunkSize: 2,
      reader: {
        *read({ checkpoint }) {
          seenCheckpoints.push(checkpoint);
          const start = checkpoint?.cursor ?? 0;
          for (let index = start; index < 4; index += 1) {
            yield index + 1;
          }
        }
      },
      writer: {
        write(items) {
          written.push([...items]);
        }
      },
      checkpoint({ checkpoint, readCount }) {
        return { cursor: (checkpoint?.cursor ?? 0) + readCount };
      }
    });
    const job = defineJob({
      name: "restartable-copy-job",
      steps: [step]
    });

    const execution = await runner.run(job, parameters, { restart: true });

    expect(execution).toMatchObject({
      id: "restart-execution",
      instanceId: instance.id,
      status: "completed"
    });
    expect(seenCheckpoints).toEqual([{ cursor: 2 }]);
    expect(written).toEqual([[3, 4]]);
    expect(storage.checkpointStore.writes).toEqual([
      {
        executionId: "restart-execution",
        stepName: "copy-users",
        checkpoint: { cursor: 4 }
      }
    ]);
    expect(storage.repository.createdJobs.map((jobExecution) => jobExecution.id)).toEqual([
      "failed-execution",
      "restart-execution"
    ]);
    expect(storage.repository.createdInstances).toHaveLength(1);
  });

  it("rejects restart without a failed execution / 실패 execution이 없으면 restart를 거부한다", async () => {
    const storage = new RecordingStorage();
    const parameters = { tenant: "acme" };
    const instance = createJobInstance("restartable-copy-job", parameters);
    await storage.repository.createJobInstance(instance);
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "restart-execution",
      generateOwnerId: () => "worker-1"
    });
    const job = defineJob({
      name: "restartable-copy-job",
      steps: [
        defineStep({
          name: "load-users",
          execute() {
            return "loaded";
          }
        })
      ]
    });

    await expect(runner.run(job, parameters, { restart: true })).rejects.toThrow(
      `Job instance "${instance.id}" has no failed execution to restart.`
    );
    expect(storage.repository.createdJobs).toHaveLength(0);
    expect(storage.repository.createdSteps).toHaveLength(0);
    expect(storage.lockManager.released).toEqual([
      {
        resource: `job-instance:${instance.id}`,
        ownerId: "worker-1"
      }
    ]);
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
      {
        resource: "job-instance:sha256:840f8890e088b18097462898ae8436efc978a098a1d669c9ae02021fb490700e",
        ownerId: "worker-1"
      }
    ]);
  });
});

const createClock = (isoDates: readonly string[]): (() => Date) => {
  let index = 0;

  return () => new Date(isoDates[Math.min(index++, isoDates.length - 1)]!);
};

const createJobInstance = (jobName: string, parameters: Record<string, unknown>): JobInstance => {
  const parametersHash = hashJobParameters(parameters);

  return {
    id: createJobInstanceId(jobName, parametersHash),
    jobName,
    parametersHash,
    parameters,
    createdAt: new Date("2026-07-19T00:00:00.000Z")
  };
};

const compareJobExecutionByCreatedAtDesc = (left: JobExecution, right: JobExecution): number => {
  const diff = right.createdAt.getTime() - left.createdAt.getTime();
  return diff === 0 ? right.id.localeCompare(left.id) : diff;
};
