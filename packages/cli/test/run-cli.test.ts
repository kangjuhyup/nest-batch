import { describe, expect, it } from "vitest";
import { defineJob, defineStep } from "@rv-nest-batch/core";
import { InMemoryBatchStorage } from "@rv-nest-batch/inmemory";
import type { WorkClaimOptions, WorkQueue, WorkUnit } from "@rv-nest-batch/core/queue";
import type { ScheduleDefinition, ScheduleOccurrence } from "@rv-nest-batch/core/scheduler";
import { runCli } from "../src/index.js";

class InMemoryWorkQueue implements WorkQueue {
  readonly completed: string[] = [];
  readonly failed: string[] = [];
  private readonly pending: WorkUnit[];

  constructor(work: readonly WorkUnit[]) {
    this.pending = [...work];
  }

  async enqueue(work: WorkUnit): Promise<void> {
    this.pending.push(work);
  }

  async claim(_options: WorkClaimOptions): Promise<WorkUnit | undefined> {
    return this.pending.shift();
  }

  async complete(work: WorkUnit): Promise<void> {
    this.completed.push(work.id);
  }

  async fail(work: WorkUnit): Promise<void> {
    this.failed.push(work.id);
  }
}

class RecordingScheduleStore {
  readonly latestCalls: Array<{ readonly scheduleName: string; readonly options: unknown }> = [];
  readonly listCalls: unknown[] = [];

  constructor(
    private readonly latestOccurrence?: ScheduleOccurrence,
    private readonly occurrences: readonly ScheduleOccurrence[] = []
  ) {}

  async findLatestOccurrence(
    scheduleName: string,
    options?: unknown
  ): Promise<ScheduleOccurrence | undefined> {
    this.latestCalls.push({ scheduleName, options });

    return this.latestOccurrence;
  }

  async listOccurrences(options?: unknown): Promise<readonly ScheduleOccurrence[]> {
    this.listCalls.push(options);

    return this.occurrences;
  }

  async claimOccurrence(): Promise<ScheduleOccurrence | undefined> {
    return undefined;
  }

  async markDispatched(): Promise<boolean> {
    return false;
  }

  async markFailed(): Promise<boolean> {
    return false;
  }
}

describe("runCli / runCli 동작을 검증한다", () => {
  it("prints help for empty args / 빈 인자에 대해 help를 출력한다", async () => {
    await expect(runCli([])).resolves.toEqual({
      exitCode: 0,
      output: "nest-batch commands: run, status, retry, list, worker, schedule"
    });
  });

  it("rejects unknown commands / 알 수 없는 command를 거부한다", async () => {
    await expect(runCli(["unknown"])).resolves.toEqual({
      exitCode: 1,
      output: 'Unknown command "unknown".'
    });
  });

  it("lists registered jobs / 등록된 job 목록을 출력한다", async () => {
    const jobs = [
      defineJob({
        name: "daily-user-import",
        steps: [noopStep("daily-user-import")]
      }),
      defineJob({
        name: "billing-export",
        steps: [noopStep("billing-export")]
      })
    ];

    const result = await runCli(["list"], { jobs });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output)).toEqual({
      jobs: ["billing-export", "daily-user-import"]
    });
  });

  it("runs a registered job with storage / storage를 사용해 등록된 job을 실행한다", async () => {
    const storage = new InMemoryBatchStorage();
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

    const result = await runCli(
      [
        "run",
        "--job",
        "daily-user-import",
        "--parameters",
        '{"tenant":"acme"}',
        "--execution-id",
        "cli-execution-1"
      ],
      { storage, jobs: [job] }
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output)).toMatchObject({
      command: "run",
      execution: {
        id: "cli-execution-1",
        jobName: "daily-user-import",
        status: "completed",
        parameters: { tenant: "acme" }
      },
      steps: [
        {
          stepName: "load-users",
          status: "completed"
        }
      ]
    });
    await expect(storage.repository.findById("cli-execution-1")).resolves.toMatchObject({
      id: "cli-execution-1",
      status: "completed"
    });
  });

  it("prints execution status from storage / storage에서 execution 상태를 출력한다", async () => {
    const storage = new InMemoryBatchStorage();
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
    await runCli(
      ["run", "--job", "daily-user-import", "--execution-id", "cli-execution-2"],
      { storage, jobs: [job] }
    );

    const result = await runCli(["status", "--execution-id", "cli-execution-2"], { storage });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output)).toMatchObject({
      command: "status",
      execution: {
        id: "cli-execution-2",
        status: "completed"
      },
      steps: [
        {
          stepName: "load-users",
          status: "completed"
        }
      ]
    });
  });

  it("retries a failed job execution / 실패한 job execution을 재시도한다", async () => {
    const storage = new InMemoryBatchStorage();
    let attempts = 0;
    const job = defineJob({
      name: "flaky-import",
      steps: [
        defineStep({
          name: "load-users",
          execute() {
            attempts += 1;

            if (attempts === 1) {
              throw new Error("temporary failure");
            }

            return "loaded";
          }
        })
      ]
    });

    const failed = await runCli(
      [
        "run",
        "--job",
        "flaky-import",
        "--parameters",
        '{"tenant":"acme"}',
        "--execution-id",
        "failed-execution"
      ],
      { storage, jobs: [job] }
    );
    const retried = await runCli(
      [
        "retry",
        "--job",
        "flaky-import",
        "--parameters",
        '{"tenant":"acme"}',
        "--execution-id",
        "retry-execution"
      ],
      { storage, jobs: [job] }
    );

    expect(failed.exitCode).toBe(1);
    expect(JSON.parse(failed.output).execution.status).toBe("failed");
    expect(retried.exitCode).toBe(0);
    expect(JSON.parse(retried.output)).toMatchObject({
      command: "retry",
      execution: {
        id: "retry-execution",
        status: "completed"
      }
    });
  });

  it("runs worker loop once from CLI / CLI에서 worker loop를 한 번 실행한다", async () => {
    const storage = new InMemoryBatchStorage();
    const queue = new InMemoryWorkQueue([
      {
        id: "work-1",
        payload: {
          jobName: "queued-import",
          parameters: { tenant: "acme" },
          executionId: "queued-execution-1",
          ownerId: "worker-1"
        }
      }
    ]);
    const job = defineJob({
      name: "queued-import",
      steps: [
        defineStep({
          name: "load-users",
          execute() {
            return "loaded";
          }
        })
      ]
    });

    const result = await runCli(["worker", "--once", "--worker-id", "worker-1"], {
      storage,
      jobs: [job],
      queue
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output)).toEqual({
      command: "worker",
      workerId: "worker-1",
      handled: true
    });
    expect(queue.completed).toEqual(["work-1"]);
    expect(queue.failed).toEqual([]);
    await expect(storage.repository.findById("queued-execution-1")).resolves.toMatchObject({
      id: "queued-execution-1",
      status: "completed"
    });
  });

  it("runs scheduler once from CLI / CLI에서 scheduler를 한 번 실행한다", async () => {
    const loop = {
      async tick() {
        return {
          scannedSchedules: 1,
          claimedOccurrences: 1,
          dispatchedOccurrences: 1,
          failedOccurrences: 0
        };
      }
    };

    const result = await runCli(["schedule", "--once", "--scheduler-id", "scheduler-1"], {
      schedulerLoop: loop as any
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output)).toEqual({
      command: "schedule",
      schedulerId: "scheduler-1",
      result: {
        scannedSchedules: 1,
        claimedOccurrences: 1,
        dispatchedOccurrences: 1,
        failedOccurrences: 0
      }
    });
  });

  it("lists configured schedules / 설정된 schedule 목록을 출력한다", async () => {
    const schedules = [
      scheduleDefinition({
        name: "reports.hourly",
        jobName: "reports-job"
      }),
      scheduleDefinition({
        name: "billing.daily",
        jobName: "billing-job",
        misfirePolicy: "fire-all",
        maxCatchUpOccurrences: 3,
        parameters: { tenant: "acme" },
        runOptions: { ownerId: "billing-owner", lockTtlMs: 5_000 }
      })
    ];

    const result = await runCli(["schedule", "--list"], { schedules });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output)).toEqual({
      command: "schedule",
      schedules: [
        {
          name: "billing.daily",
          jobName: "billing-job",
          misfirePolicy: "fire-all",
          maxCatchUpOccurrences: 3,
          hasParameters: true,
          runOptions: { ownerId: "billing-owner", lockTtlMs: 5_000 }
        },
        {
          name: "reports.hourly",
          jobName: "reports-job",
          hasParameters: false
        }
      ]
    });
  });

  it("prints schedule status with latest occurrence / 최신 occurrence와 schedule 상태를 출력한다", async () => {
    const latest = scheduleOccurrence({
      scheduleName: "billing.daily",
      occurrenceId: "schedule:billing.daily:2026-01-02T00:00:00.000Z",
      scheduledAt: new Date("2026-01-02T00:00:00.000Z"),
      status: "failed",
      ownerId: "scheduler-1",
      claimedAt: new Date("2026-01-02T00:00:01.000Z"),
      failedAt: new Date("2026-01-02T00:00:05.000Z"),
      failureReason: "queue unavailable"
    });
    const store = new RecordingScheduleStore(latest);

    const result = await runCli(["schedule", "--status", "--schedule", "billing.daily"], {
      schedules: [
        scheduleDefinition({
          name: "billing.daily",
          jobName: "billing-job",
          maxCatchUpOccurrences: 1
        })
      ],
      scheduleStore: store
    });

    expect(result.exitCode).toBe(0);
    expect(store.latestCalls).toEqual([{ scheduleName: "billing.daily", options: undefined }]);
    expect(JSON.parse(result.output)).toEqual({
      command: "schedule",
      schedule: {
        name: "billing.daily",
        jobName: "billing-job",
        maxCatchUpOccurrences: 1,
        hasParameters: false
      },
      latestOccurrence: {
        scheduleName: "billing.daily",
        occurrenceId: "schedule:billing.daily:2026-01-02T00:00:00.000Z",
        scheduledAt: "2026-01-02T00:00:00.000Z",
        status: "failed",
        ownerId: "scheduler-1",
        claimedAt: "2026-01-02T00:00:01.000Z",
        failedAt: "2026-01-02T00:00:05.000Z",
        failureReason: "queue unavailable"
      }
    });
  });

  it("rejects schedule status without schedule name / schedule 이름 없는 status 조회를 거부한다", async () => {
    const result = await runCli(["schedule", "--status"], {
      scheduleStore: new RecordingScheduleStore()
    });

    expect(result).toEqual({
      exitCode: 1,
      output: "--schedule is required for schedule --status."
    });
  });

  it("requires schedule store for schedule status / schedule status에 schedule store가 필요하다", async () => {
    const result = await runCli(["schedule", "--status", "--schedule", "billing.daily"], {
      schedules: [scheduleDefinition({ name: "billing.daily", jobName: "billing-job" })]
    });

    expect(result).toEqual({
      exitCode: 1,
      output: "ScheduleStore is required for the schedule command."
    });
  });

  it("lists failed schedule occurrences / 실패한 schedule occurrence를 조회한다", async () => {
    const failed = scheduleOccurrence({
      scheduleName: "billing.daily",
      occurrenceId: "schedule:billing.daily:2026-01-03T00:00:00.000Z",
      scheduledAt: new Date("2026-01-03T00:00:00.000Z"),
      status: "failed",
      ownerId: "scheduler-1",
      failedAt: new Date("2026-01-03T00:00:04.000Z"),
      failureReason: "dispatch failed"
    });
    const store = new RecordingScheduleStore(undefined, [failed]);

    const result = await runCli(
      ["schedule", "--failed", "--schedule", "billing.daily", "--limit", "2"],
      { scheduleStore: store }
    );

    expect(result.exitCode).toBe(0);
    expect(store.listCalls).toEqual([
      { status: "failed", scheduleName: "billing.daily", limit: 2 }
    ]);
    expect(JSON.parse(result.output)).toEqual({
      command: "schedule",
      status: "failed",
      scheduleName: "billing.daily",
      limit: 2,
      occurrences: [
        {
          scheduleName: "billing.daily",
          occurrenceId: "schedule:billing.daily:2026-01-03T00:00:00.000Z",
          scheduledAt: "2026-01-03T00:00:00.000Z",
          status: "failed",
          ownerId: "scheduler-1",
          failedAt: "2026-01-03T00:00:04.000Z",
          failureReason: "dispatch failed"
        }
      ]
    });
  });

  it("rejects invalid failed occurrence limits / 유효하지 않은 failed occurrence limit을 거부한다", async () => {
    for (const limit of ["0", "-1", "1.5", "abc"]) {
      await expect(runCli(["schedule", "--failed", "--limit", limit])).resolves.toEqual({
        exitCode: 1,
        output: "--limit must be a positive integer."
      });
    }
  });
});

const noopStep = (name: string) =>
  defineStep({
    name: `${name}-step`,
    execute() {
      return undefined;
    }
  });

const scheduleDefinition = (
  definition: Omit<ScheduleDefinition, "trigger"> & {
    readonly trigger?: ScheduleDefinition["trigger"];
  }
): ScheduleDefinition => ({
  trigger: {
    getDueOccurrences() {
      return [];
    }
  },
  ...definition
});

const scheduleOccurrence = (occurrence: ScheduleOccurrence): ScheduleOccurrence => occurrence;
