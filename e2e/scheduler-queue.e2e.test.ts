import { createRequire } from "node:module";
import { runCli } from "@nest-batch/cli";
import { DefaultBatchRunner, defineJob, defineStep } from "@nest-batch/core";
import { PostgresBatchStorage, PostgresScheduleStore } from "@nest-batch/postgres";
import { BullMqWorkQueue, type BullMqWorkerLike } from "@nest-batch/bullmq";
import type { WorkUnit } from "@nest-batch/core/queue";
import {
  SchedulerLoop,
  createIntervalTrigger,
  createQueueScheduleDispatcher,
  defineSchedule
} from "@nest-batch/core/scheduler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresE2eDatabase } from "./support/postgres.js";

interface ScheduledImportParameters {
  readonly billingDate: string;
}

interface BullMqConnectionOptions {
  readonly db?: number;
  readonly host: string;
  readonly maxRetriesPerRequest: null;
  readonly password?: string;
  readonly port: number;
  readonly username?: string;
}

interface BullMqQueue<TWork extends WorkUnit> {
  waitUntilReady(): Promise<unknown>;
  getJob(id: string): Promise<{ getState(): Promise<string> } | undefined>;
  obliterate(options: { readonly force: true }): Promise<unknown>;
  close(): Promise<unknown>;
}

interface BullMqWorker<TWork extends WorkUnit> {
  waitUntilReady(): Promise<unknown>;
  getNextJob(
    token: string,
    options: { readonly block: false }
  ): Promise<{ readonly data: TWork } | null | undefined>;
  close(force: true): Promise<unknown>;
}

interface BullMqModule {
  Queue: new <TWork extends WorkUnit>(
    name: string,
    options: { readonly connection: BullMqConnectionOptions }
  ) => BullMqQueue<TWork>;
  Worker: new <TWork extends WorkUnit>(
    name: string,
    processor: null,
    options: {
      readonly autorun: false;
      readonly connection: BullMqConnectionOptions;
      readonly skipStalledCheck: true;
    }
  ) => BullMqWorker<TWork>;
}

type ScheduledWorkUnit = WorkUnit;

const queueBullMqRequire = createRequire(
  new URL("../packages/queue-bullmq/package.json", import.meta.url)
);
const { Queue, Worker } = queueBullMqRequire("bullmq") as BullMqModule;
const DEFAULT_POSTGRES_URL = "postgresql://nest_batch:nest_batch@127.0.0.1:15432/nest_batch";
const DEFAULT_REDIS_URL = "redis://127.0.0.1:16379";
const redisUrl = process.env.NEST_BATCH_SCHEDULER_E2E_REDIS_URL ??
  process.env.NEST_BATCH_E2E_REDIS_URL ??
  DEFAULT_REDIS_URL;
const database = createPostgresE2eDatabase({
  label: "Postgres scheduler queue e2e database",
  urlEnv: "NEST_BATCH_SCHEDULER_E2E_POSTGRES_URL",
  fallbackUrlEnvs: [
    "NEST_BATCH_SYSTEM_E2E_POSTGRES_URL",
    "NEST_BATCH_E2E_POSTGRES_URL",
    "NEST_BATCH_POSTGRES_URL"
  ],
  defaultUrl: DEFAULT_POSTGRES_URL,
  schemaEnv: "NEST_BATCH_SCHEDULER_E2E_POSTGRES_SCHEMA",
  defaultSchema: "batch_scheduler_e2e",
  schemaPrefix: "batch_scheduler_e2e",
  tablePrefixEnv: "NEST_BATCH_SCHEDULER_E2E_POSTGRES_TABLE_PREFIX",
  defaultTablePrefix: "nb_scheduler_e2e"
});
const storage = new PostgresBatchStorage({
  connectionString: database.connectionString,
  schema: database.schema,
  tablePrefix: database.tablePrefix
});
const scheduleStore = new PostgresScheduleStore({
  connectionString: database.connectionString,
  schema: database.schema,
  tablePrefix: database.tablePrefix
});
let queue: BullMqQueue<ScheduledWorkUnit>;
let worker: BullMqWorker<ScheduledWorkUnit>;
let postgresAvailable = false;

describe("scheduler queue e2e / scheduler queue e2e를 검증한다", () => {
  beforeAll(async () => {
    await database.assertAvailable();
    postgresAvailable = true;
    await database.resetSchema();
    await storage.initialize();
    await scheduleStore.initialize();

    const connection = parseRedisConnection(redisUrl);
    const queueName = `nest-batch-scheduler-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    queue = new Queue<ScheduledWorkUnit>(queueName, { connection });
    worker = new Worker<ScheduledWorkUnit>(queueName, null, {
      autorun: false,
      connection,
      skipStalledCheck: true
    });
    await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
  }, 30_000);

  afterAll(async () => {
    await worker?.close(true);
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await queue?.close();
    await storage.close();
    if (postgresAvailable) {
      await database.resetSchema();
    }
    await database.close();
  }, 30_000);

  it("enqueues scheduled work and worker runs the job / schedule work를 enqueue하고 worker가 job을 실행한다", async () => {
    const written: string[] = [];
    const workQueue = createBullMqWorkQueue(queue, worker);
    const job = defineJob<ScheduledImportParameters>({
      name: "billing",
      steps: [
        defineStep({
          name: "charge",
          execute({ parameters }) {
            written.push(parameters.billingDate);
          }
        })
      ]
    });
    const schedule = defineSchedule<ScheduledImportParameters>({
      name: "billing.daily",
      jobName: "billing",
      trigger: createIntervalTrigger({
        everyMs: 86_400_000,
        startAt: new Date("2026-01-01T00:00:00.000Z")
      }),
      parameters: ({ scheduledAt }) => ({
        billingDate: scheduledAt.toISOString().slice(0, 10)
      })
    });
    const occurrenceId = "schedule:billing.daily:2026-01-01T00:00:00.000Z";
    const scheduler = new SchedulerLoop({
      schedules: [schedule],
      store: scheduleStore,
      lockManager: storage.lockManager,
      dispatcher: createQueueScheduleDispatcher({ queue: workQueue }),
      ownerId: "scheduler-1",
      now: () => new Date("2026-01-01T00:00:00.000Z")
    });

    const scheduleResult = await scheduler.tick();
    const workerResult = await runCli(["worker", "--once", "--worker-id", "worker-1"], {
      storage,
      jobs: [job],
      queue: workQueue,
      runner: new DefaultBatchRunner(storage, {
        generateOwnerId: () => "worker-1",
        now: () => new Date("2026-01-01T00:00:01.000Z")
      })
    });

    expect(scheduleResult).toEqual({
      scannedSchedules: 1,
      claimedOccurrences: 1,
      dispatchedOccurrences: 1,
      failedOccurrences: 0
    });
    expect(workerResult.exitCode).toBe(0);
    expect(JSON.parse(workerResult.output)).toMatchObject({
      command: "worker",
      workerId: "worker-1",
      handled: true
    });
    expect(written).toEqual(["2026-01-01"]);
    await expect(scheduleStore.findLatestOccurrence("billing.daily")).resolves.toMatchObject({
      occurrenceId,
      status: "dispatched"
    });
    await expect(storage.repository.findById(occurrenceId)).resolves.toMatchObject({
      id: occurrenceId,
      jobName: "billing",
      status: "completed",
      parameters: { billingDate: "2026-01-01" }
    });
    const queuedJob = await queue.getJob(encodeURIComponent(occurrenceId));
    await expect(queuedJob?.getState()).resolves.toBe("completed");
  });
});

const createBullMqWorkQueue = (
  queue: BullMqQueue<ScheduledWorkUnit>,
  worker: BullMqWorker<ScheduledWorkUnit>
): BullMqWorkQueue<ScheduledWorkUnit> => {
  const pullWorker: BullMqWorkerLike<ScheduledWorkUnit> = {
    getNextJob: (token) => worker.getNextJob(token, { block: false }) as any
  };

  return new BullMqWorkQueue({
    queue: queue as any,
    worker: pullWorker,
    tokenFactory: ({ workerId, now }) => `${workerId}:${now.getTime()}`
  });
};

const parseRedisConnection = (value: string): BullMqConnectionOptions => {
  const url = new URL(value);

  return {
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
    host: url.hostname,
    maxRetriesPerRequest: null,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined
  };
};
