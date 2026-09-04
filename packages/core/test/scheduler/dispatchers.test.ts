import { describe, expect, it } from "vitest";
import type { BatchRunner, JobDefinition } from "@nest-batch/core";
import type { WorkQueue, WorkUnit } from "@nest-batch/core/queue";
import {
  createQueueScheduleDispatcher,
  createRunnerScheduleDispatcher,
  defineSchedule
} from "@nest-batch/core/scheduler";

describe("schedule dispatchers / schedule dispatcher를 검증한다", () => {
  it("runs jobs through BatchRunner / BatchRunner로 job을 실행한다", async () => {
    const job = { name: "billing", steps: [] } as unknown as JobDefinition;
    const runs: unknown[] = [];
    const runner: BatchRunner = {
      async run(receivedJob, parameters, options) {
        runs.push({ receivedJob, parameters, options });
        return {
          id: options?.executionId ?? "execution",
          instanceId: "instance",
          jobName: receivedJob.name,
          status: "completed",
          parameters,
          createdAt: new Date()
        };
      }
    };
    const dispatcher = createRunnerScheduleDispatcher({
      jobs: [job],
      runner,
      ownerId: "scheduler-runner"
    });
    const schedule = defineSchedule({
      name: "billing.daily",
      jobName: "billing",
      trigger: { getDueOccurrences: () => [] },
      parameters: { tenant: "acme" },
      runOptions: { lockTtlMs: 30_000 }
    });

    await dispatcher({
      schedule,
      occurrence: {
        scheduleName: schedule.name,
        occurrenceId: "schedule:billing.daily:2026-01-01T00:00:00.000Z",
        scheduledAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "claimed",
        ownerId: "scheduler-1"
      },
      signal: new AbortController().signal
    });

    expect(runs).toMatchObject([
      {
        receivedJob: job,
        parameters: { tenant: "acme" },
        options: {
          executionId: "schedule:billing.daily:2026-01-01T00:00:00.000Z",
          ownerId: "scheduler-runner",
          lockTtlMs: 30_000
        }
      }
    ]);
  });

  it("enqueues work using occurrence id / occurrence id로 work를 enqueue한다", async () => {
    const enqueued: WorkUnit[] = [];
    const queue: WorkQueue = {
      async enqueue(work) {
        enqueued.push(work);
      },
      async claim() {
        return undefined;
      },
      async complete() {
        return undefined;
      },
      async fail() {
        return undefined;
      }
    };
    const dispatcher = createQueueScheduleDispatcher({ queue, workType: "scheduled-job" });
    const schedule = defineSchedule({
      name: "billing.daily",
      jobName: "billing",
      trigger: { getDueOccurrences: () => [] },
      parameters: ({ scheduledAt }) => ({
        billingDate: scheduledAt.toISOString().slice(0, 10)
      }),
      runOptions: { ownerId: "worker-owner", lockTtlMs: 10_000 }
    });

    await dispatcher({
      schedule,
      occurrence: {
        scheduleName: schedule.name,
        occurrenceId: "schedule:billing.daily:2026-01-02T00:00:00.000Z",
        scheduledAt: new Date("2026-01-02T00:00:00.000Z"),
        status: "claimed"
      },
      signal: new AbortController().signal
    });

    expect(enqueued).toEqual([
      {
        id: "schedule:billing.daily:2026-01-02T00:00:00.000Z",
        type: "scheduled-job",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        payload: {
          jobName: "billing",
          parameters: { billingDate: "2026-01-02" },
          executionId: "schedule:billing.daily:2026-01-02T00:00:00.000Z",
          ownerId: "worker-owner",
          lockTtlMs: 10_000,
          restart: false
        }
      }
    ]);
  });
});
