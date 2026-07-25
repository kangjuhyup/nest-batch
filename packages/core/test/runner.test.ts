import { describe, expect, it } from "vitest";
import {
  DatabaseBatchStorage,
  DefaultBatchRunner,
  createJobInstanceId,
  defineChunkStep,
  defineJob,
  definePartitionedStep,
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
  PartitionClaimOptions,
  PartitionExecution,
  StepExecution
} from "../src/index.js";

class RecordingJobRepository implements JobRepository {
  readonly createdJobs: JobExecution[] = [];
  readonly updatedJobs: JobExecution[] = [];
  readonly createdInstances: JobInstance[] = [];
  readonly executionAttempts: Array<{
    readonly instance: JobInstance;
    readonly execution: JobExecution;
  }> = [];
  readonly createdSteps: StepExecution[] = [];
  readonly updatedSteps: StepExecution[] = [];
  readonly createdPartitions: PartitionExecution[] = [];
  readonly updatedPartitions: PartitionExecution[] = [];
  private readonly jobs = new Map<BatchExecutionId, JobExecution>();
  private readonly instances = new Map<string, JobInstance>();
  private readonly steps = new Map<BatchExecutionId, StepExecution[]>();
  private readonly partitions = new Map<string, PartitionExecution[]>();

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

  async createExecutionAttempt(
    instance: JobInstance,
    execution: JobExecution
  ): Promise<{ readonly instance: JobInstance; readonly activeExecution?: JobExecution }> {
    this.executionAttempts.push({ instance, execution });
    const existingInstance =
      (await this.findJobInstance(instance.jobName, instance.parametersHash)) ??
      (await this.createJobInstance(instance));
    const activeExecution = await this.findActiveJobExecution(existingInstance.id);

    if (activeExecution) {
      return { instance: existingInstance, activeExecution };
    }

    await this.create(execution);

    return { instance: existingInstance };
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

  async createPartitionExecution(execution: PartitionExecution): Promise<void> {
    this.createdPartitions.push(execution);
    this.partitions.set(execution.stepExecutionId, [
      ...(this.partitions.get(execution.stepExecutionId) ?? []),
      execution
    ]);
  }

  async updatePartitionExecution(execution: PartitionExecution): Promise<void> {
    this.updatedPartitions.push(execution);
    this.partitions.set(
      execution.stepExecutionId,
      (this.partitions.get(execution.stepExecutionId) ?? []).map((candidate) =>
        candidate.id === execution.id ? execution : candidate
      )
    );
  }

  async findPartitionExecutions(stepExecutionId: string): Promise<readonly PartitionExecution[]> {
    return this.partitions.get(stepExecutionId) ?? [];
  }

  async claimPartitionExecution(options: PartitionClaimOptions): Promise<PartitionExecution | undefined> {
    const executions = this.partitions.get(options.stepExecutionId) ?? [];
    const index = executions.findIndex((execution) => execution.status === "created");

    if (index < 0) {
      return undefined;
    }

    const execution = executions[index]!;
    const claimed: PartitionExecution = {
      ...execution,
      status: "running",
      ownerId: options.ownerId,
      heartbeatAt: options.now,
      claimExpiresAt: options.staleAfterMs
        ? new Date(options.now.getTime() + options.staleAfterMs)
        : undefined,
      startedAt: execution.startedAt ?? options.now
    };
    this.updatedPartitions.push(claimed);
    this.partitions.set(execution.stepExecutionId, [
      ...executions.slice(0, index),
      claimed,
      ...executions.slice(index + 1)
    ]);

    return claimed;
  }

  async heartbeatPartitionExecution(): Promise<boolean> {
    return false;
  }

  async completePartitionExecution(execution: PartitionExecution, ownerId: string): Promise<boolean> {
    return this.updateOwnedPartitionExecution(execution, ownerId);
  }

  async failPartitionExecution(execution: PartitionExecution, ownerId: string): Promise<boolean> {
    return this.updateOwnedPartitionExecution(execution, ownerId);
  }

  private instanceKey(jobName: string, parametersHash: string): string {
    return `${jobName}:${parametersHash}`;
  }

  private async updateOwnedPartitionExecution(
    execution: PartitionExecution,
    ownerId: string
  ): Promise<boolean> {
    const stored = (this.partitions.get(execution.stepExecutionId) ?? []).find(
      (candidate) => candidate.id === execution.id
    );

    if (!stored || stored.ownerId !== ownerId) {
      return false;
    }

    await this.updatePartitionExecution(execution);

    return true;
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
    expect(storage.repository.executionAttempts).toHaveLength(1);
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

  it("emits job and step lifecycle events / job과 step lifecycle event를 발행한다", async () => {
    const storage = new RecordingStorage();
    const events: string[] = [];
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "observed-execution",
      generateStepExecutionId: ({ stepName }) => `observed-execution:${stepName}`,
      generateOwnerId: () => "worker-1",
      observer: {
        onBatchEvent(event) {
          events.push(event.type);
        }
      }
    });
    const job = defineJob({
      name: "observed-job",
      steps: [
        defineStep({
          name: "load-users",
          execute() {
            return "loaded";
          }
        })
      ]
    });

    await runner.run(job, {});

    expect(events).toEqual(["job.started", "step.started", "step.completed", "job.completed"]);
  });

  it("forwards current step callback contexts / 현재 step callback context를 전달한다", async () => {
    const storage = new RecordingStorage();
    storage.checkpointStore.set("context-execution", "load-context", { tasklet: true });
    storage.checkpointStore.set("context-execution", "copy-context", { cursor: 1 });
    const controller = new AbortController();
    const contexts: Record<string, unknown[]> = {
      tasklet: [],
      reader: [],
      processor: [],
      retry: [],
      skip: [],
      writer: [],
      checkpoint: [],
      partition: []
    };
    let retryAttempts = 0;
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "context-execution",
      generateStepExecutionId: ({ stepName }) => `context-execution:${stepName}`,
      generateOwnerId: () => "worker-1"
    });
    const job = defineJob({
      name: "context-job",
      steps: [
        defineStep({
          name: "load-context",
          execute(context) {
            contexts.tasklet.push(context);
            return "tasklet-output";
          }
        }),
        defineChunkStep<string, string, { readonly cursor: number }>({
          name: "copy-context",
          chunkSize: 2,
          reader: {
            read(context) {
              contexts.reader.push(context);
              return ["retry", "skip", "ok"];
            }
          },
          processor: {
            process(item, context) {
              contexts.processor.push(context);

              if (item === "retry" && retryAttempts === 0) {
                retryAttempts += 1;
                throw new Error("retry once");
              }

              if (item === "skip") {
                throw new Error("skip once");
              }

              return item.toUpperCase();
            }
          },
          retryPolicy: {
            canRetry(context) {
              contexts.retry.push(context);
              return context.item === "retry" && context.attempt === 1;
            }
          },
          skipPolicy: {
            canSkip(context) {
              contexts.skip.push(context);
              return context.item === "skip";
            }
          },
          writer: {
            write(_items, context) {
              contexts.writer.push(context);
            }
          },
          checkpoint(context) {
            contexts.checkpoint.push(context);
            return { cursor: context.readCount };
          }
        }),
        definePartitionedStep({
          name: "partition-context",
          partitions: () => [{ shard: 0 }],
          execute(_partition, context) {
            contexts.partition.push(context);
            return { readCount: 1, writeCount: 1 };
          }
        })
      ]
    });

    const execution = await runner.run(job, { tenant: "acme" }, { signal: controller.signal });

    expect(execution.status).toBe("completed");
    expect(contexts.tasklet).toEqual([
      expect.objectContaining({
        input: undefined,
        signal: controller.signal,
        checkpoint: { tasklet: true },
        jobName: "context-job",
        jobExecutionId: "context-execution",
        stepName: "load-context",
        stepExecutionId: "context-execution:load-context",
        parameters: { tenant: "acme" },
        restart: false
      })
    ]);
    expect(contexts.reader).toEqual([
      expect.objectContaining({
        signal: controller.signal,
        checkpoint: { cursor: 1 },
        jobName: "context-job",
        jobExecutionId: "context-execution",
        stepName: "copy-context",
        stepExecutionId: "context-execution:copy-context",
        parameters: { tenant: "acme" },
        restart: false
      })
    ]);
    expect(contexts.processor).toEqual([
      expect.objectContaining({
        item: "retry",
        index: 0,
        signal: controller.signal,
        checkpoint: { cursor: 1 },
        parameters: { tenant: "acme" }
      }),
      expect.objectContaining({
        item: "retry",
        index: 0,
        signal: controller.signal,
        checkpoint: { cursor: 1 },
        parameters: { tenant: "acme" }
      }),
      expect.objectContaining({
        item: "skip",
        index: 1,
        signal: controller.signal,
        checkpoint: { cursor: 1 },
        parameters: { tenant: "acme" }
      }),
      expect.objectContaining({
        item: "ok",
        index: 2,
        signal: controller.signal,
        checkpoint: { cursor: 1 },
        parameters: { tenant: "acme" }
      })
    ]);
    expect(contexts.retry).toEqual([
      expect.objectContaining({
        phase: "process",
        item: "retry",
        attempt: 1,
        readCount: 1,
        writeCount: 0,
        skipCount: 0,
        signal: controller.signal,
        checkpoint: { cursor: 1 }
      }),
      expect.objectContaining({
        phase: "process",
        item: "skip",
        attempt: 1,
        readCount: 2,
        writeCount: 0,
        skipCount: 0,
        signal: controller.signal,
        checkpoint: { cursor: 1 }
      })
    ]);
    expect(contexts.skip).toEqual([
      expect.objectContaining({
        phase: "process",
        item: "skip",
        readCount: 2,
        writeCount: 0,
        skipCount: 0,
        signal: controller.signal,
        checkpoint: { cursor: 1 }
      })
    ]);
    expect(contexts.writer).toEqual([
      expect.objectContaining({
        attempt: 1,
        chunkIndex: 0,
        signal: controller.signal,
        checkpoint: { cursor: 1 },
        parameters: { tenant: "acme" }
      })
    ]);
    expect(contexts.checkpoint).toEqual([
      expect.objectContaining({
        executionId: "context-execution",
        stepName: "copy-context",
        chunkIndex: 0,
        readCount: 3,
        writeCount: 2,
        skipCount: 1,
        signal: controller.signal,
        checkpoint: { cursor: 1 }
      })
    ]);
    expect(contexts.partition).toEqual([
      expect.objectContaining({
        jobName: "context-job",
        jobExecutionId: "context-execution",
        stepExecutionId: "context-execution:partition-context",
        partitionExecutionId: "context-execution:partition-context:partition:000000",
        stepName: "partition-context",
        partition: { shard: 0 },
        signal: controller.signal,
        parameters: { tenant: "acme" },
        restart: false
      })
    ]);

    for (const context of Object.values(contexts).flat()) {
      expect(context).toMatchObject({
        jobName: "context-job",
        jobExecutionId: "context-execution",
        parameters: { tenant: "acme" },
        restart: false
      });
    }
  });

  it("runs chained listeners on successful jobs / 성공한 job에서 chained listener를 실행한다", async () => {
    const storage = new RecordingStorage();
    const events: string[] = [];
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "listener-success-execution",
      generateStepExecutionId: ({ stepName }) => `listener-success-execution:${stepName}`,
      generateOwnerId: () => "worker-1"
    });
    const job = defineJob({
      name: "listener-success-job",
      steps: [
        defineStep({
          name: "load-users",
          execute() {
            return "loaded";
          }
        })
      ]
    })
      .onEvent("step.completed", (event) => {
        events.push(`${event.type}:${event.execution.stepName}`);
      })
      .onSuccess((event) => {
        events.push(`${event.type}:${event.execution.status}`);
      });

    const execution = await runner.run(job, {});

    expect(execution.status).toBe("completed");
    expect(events).toEqual(["step.completed:load-users", "job.completed:completed"]);
  });

  it("runs chained listeners on failed jobs / 실패한 job에서 chained listener를 실행한다", async () => {
    const storage = new RecordingStorage();
    const events: string[] = [];
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "listener-failure-execution",
      generateStepExecutionId: ({ stepName }) => `listener-failure-execution:${stepName}`,
      generateOwnerId: () => "worker-1"
    });
    const job = defineJob({
      name: "listener-failure-job",
      steps: [
        defineStep({
          name: "fail-step",
          execute() {
            throw new Error("writer unavailable");
          }
        })
      ]
    })
      .onStepFailure((event) => {
        events.push(`${event.type}:${event.execution.stepName}`);
      })
      .onFailure((event) => {
        events.push(`${event.type}:${event.execution.status}`);
      })
      .onFailure(() => {
        throw new Error("listener unavailable");
      });

    const execution = await runner.run(job, {});

    expect(execution.status).toBe("failed");
    expect(events).toEqual(["step.failed:fail-step", "job.failed:failed"]);
  });

  it("ignores observer failures during job execution / observer 실패가 job 실행을 실패시키지 않는다", async () => {
    const storage = new RecordingStorage();
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "observer-failure-execution",
      generateStepExecutionId: ({ stepName }) => `observer-failure-execution:${stepName}`,
      generateOwnerId: () => "worker-1",
      observer: {
        onBatchEvent() {
          throw new Error("observer unavailable");
        }
      }
    });
    const job = defineJob({
      name: "observed-job",
      steps: [
        defineStep({
          name: "load-users",
          execute() {
            return "loaded";
          }
        })
      ]
    });

    const execution = await runner.run(job, {});

    expect(execution.status).toBe("completed");
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
    const seenRestartContexts: unknown[] = [];
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "restart-execution",
      generateStepExecutionId: ({ stepName }) => `restart-execution:${stepName}`,
      generateOwnerId: () => "worker-1"
    });
    const step = defineChunkStep<number, number, { readonly cursor: number }>({
      name: "copy-users",
      chunkSize: 2,
      reader: {
        *read(context) {
          const { checkpoint } = context;
          seenCheckpoints.push(checkpoint);
          seenRestartContexts.push(context);
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
    expect(seenRestartContexts).toEqual([
      expect.objectContaining({
        jobName: "restartable-copy-job",
        jobExecutionId: "restart-execution",
        stepName: "copy-users",
        stepExecutionId: "restart-execution:copy-users",
        parameters,
        restart: true,
        restartFromExecutionId: "failed-execution",
        checkpoint: { cursor: 2 }
      })
    ]);
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

  it("skips previously completed steps on restart / restart 시 이전에 완료된 step은 다시 실행하지 않는다", async () => {
    const storage = new RecordingStorage();
    const parameters = { tenant: "acme" };
    const instance = createJobInstance("step-aware-restart-job", parameters);
    await storage.repository.createJobInstance(instance);
    await storage.repository.create({
      id: "failed-execution",
      instanceId: instance.id,
      jobName: "step-aware-restart-job",
      status: "failed",
      parameters,
      createdAt: new Date("2026-07-19T00:00:00.000Z"),
      startedAt: new Date("2026-07-19T00:01:00.000Z"),
      endedAt: new Date("2026-07-19T00:02:00.000Z"),
      failureReason: "writer unavailable"
    });
    await storage.repository.createStepExecution({
      id: "failed-execution:load-users",
      jobExecutionId: "failed-execution",
      stepName: "load-users",
      status: "completed",
      readCount: 10,
      writeCount: 10,
      skipCount: 0,
      retryCount: 0,
      createdAt: new Date("2026-07-19T00:00:10.000Z"),
      startedAt: new Date("2026-07-19T00:00:11.000Z"),
      endedAt: new Date("2026-07-19T00:00:12.000Z")
    });
    await storage.repository.createStepExecution({
      id: "failed-execution:copy-users",
      jobExecutionId: "failed-execution",
      stepName: "copy-users",
      status: "failed",
      readCount: 1,
      writeCount: 0,
      skipCount: 0,
      retryCount: 0,
      createdAt: new Date("2026-07-19T00:00:20.000Z"),
      startedAt: new Date("2026-07-19T00:00:21.000Z"),
      endedAt: new Date("2026-07-19T00:00:22.000Z"),
      failureReason: "writer unavailable"
    });
    storage.checkpointStore.set("failed-execution", "copy-users", { cursor: 1 });
    let skippedStepRuns = 0;
    const written: number[][] = [];
    const seenCheckpoints: unknown[] = [];
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "restart-execution",
      generateStepExecutionId: ({ stepName }) => `restart-execution:${stepName}`,
      generateOwnerId: () => "worker-1"
    });
    const job = defineJob({
      name: "step-aware-restart-job",
      steps: [
        defineStep({
          name: "load-users",
          execute() {
            skippedStepRuns += 1;
            return "loaded";
          }
        }),
        defineChunkStep<number, number, { readonly cursor: number }>({
          name: "copy-users",
          chunkSize: 2,
          reader: {
            *read({ checkpoint }) {
              seenCheckpoints.push(checkpoint);
              const start = checkpoint?.cursor ?? 0;
              for (let index = start; index < 3; index += 1) {
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
        })
      ]
    });

    const execution = await runner.run(job, parameters, { restart: true });

    expect(execution.status).toBe("completed");
    expect(skippedStepRuns).toBe(0);
    expect(seenCheckpoints).toEqual([{ cursor: 1 }]);
    expect(written).toEqual([[2, 3]]);
    await expect(storage.repository.findStepExecutions("restart-execution")).resolves.toEqual([
      expect.objectContaining({
        stepName: "load-users",
        status: "completed",
        readCount: 10,
        writeCount: 10,
        skipCount: 0,
        retryCount: 0
      }),
      expect.objectContaining({
        stepName: "copy-users",
        status: "completed",
        readCount: 2,
        writeCount: 2,
        skipCount: 0,
        retryCount: 0
      })
    ]);
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

  it("marks reader failures with read phase context / reader 실패를 read phase 문맥으로 기록한다", async () => {
    const storage = new RecordingStorage();
    const stepFailureReasons: Array<string | undefined> = [];
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "reader-failure-execution",
      generateStepExecutionId: ({ stepName }) => `reader-failure-execution:${stepName}`,
      generateOwnerId: () => "worker-1",
      observer: {
        onBatchEvent(event) {
          if (event.type === "step.failed") {
            stepFailureReasons.push(event.execution.failureReason);
          }
        }
      }
    });
    const job = defineJob({
      name: "reader-failure-job",
      steps: [
        defineChunkStep<string>({
          name: "read-users",
          chunkSize: 2,
          reader: {
            async *read() {
              throw new Error("source unavailable");
            }
          },
          writer: {
            write() {
              return undefined;
            }
          }
        })
      ]
    });

    const execution = await runner.run(job, {});

    expect(execution).toMatchObject({
      id: "reader-failure-execution",
      status: "failed",
      failureReason: "Reader failed during read phase: source unavailable"
    });
    expect(storage.repository.updatedSteps.at(-1)).toMatchObject({
      stepName: "read-users",
      status: "failed",
      failureReason: "Reader failed during read phase: source unavailable"
    });
    expect(stepFailureReasons).toEqual(["Reader failed during read phase: source unavailable"]);
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
