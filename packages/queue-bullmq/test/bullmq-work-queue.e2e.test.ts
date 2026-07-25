import { Queue, Worker } from "bullmq";
import type { ConnectionOptions, Job } from "bullmq";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkUnit } from "@nest-batch/queue-core";
import { BullMqWorkQueue } from "../src/index.js";
import type { BullMqWorkerLike } from "../src/index.js";

interface TestWorkPayload {
  readonly shard: number;
}

type TestWorkUnit = WorkUnit<TestWorkPayload>;
type TestJob = Job<TestWorkUnit, unknown, string>;

const DEFAULT_REDIS_URL = "redis://127.0.0.1:16379";
const redisUrl = process.env.NEST_BATCH_E2E_REDIS_URL ?? DEFAULT_REDIS_URL;

describe("bullmq work queue e2e / BullMQ work queue e2e", () => {
  let queue: Queue<TestWorkUnit, unknown, string>;
  let worker: Worker<TestWorkUnit, unknown, string>;
  let queueName: string;

  beforeEach(async () => {
    queueName = `nest-batch-bullmq-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const connection = parseRedisConnection(redisUrl);

    queue = new Queue<TestWorkUnit, unknown, string>(queueName, { connection });
    worker = new Worker<TestWorkUnit, unknown, string>(queueName, null, {
      autorun: false,
      connection,
      skipStalledCheck: true
    });

    await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
  }, 30_000);

  afterEach(async () => {
    await worker?.close(true);
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await queue?.close();
  }, 30_000);

  it("claims and completes work through Redis / Redis를 통해 work를 claim하고 완료한다", async () => {
    const work = createWork("work-complete");
    const workQueue = createBullMqWorkQueue(queue, worker);

    await workQueue.enqueue(work);
    const claimed = await workQueue.claim({
      workerId: "worker-1",
      now: new Date("2026-07-25T00:00:00.000Z")
    });

    expect(claimed).toEqual(work);
    await workQueue.complete(work);

    const job = await queue.getJob(work.id);
    await expect(job?.getState()).resolves.toBe("completed");
  });

  it("moves failed work to BullMQ failed set / 실패 work를 BullMQ failed set으로 이동한다", async () => {
    const work = createWork("work-failed");
    const workQueue = createBullMqWorkQueue(queue, worker);

    await workQueue.enqueue(work);
    const claimed = await workQueue.claim({
      workerId: "worker-1",
      now: new Date("2026-07-25T00:00:00.000Z")
    });

    expect(claimed).toEqual(work);
    await workQueue.fail(work, new Error("handler failed"));

    const job = await queue.getJob(work.id);
    await expect(job?.getState()).resolves.toBe("failed");
    expect(job?.failedReason).toBe("handler failed");
  });
});

const createBullMqWorkQueue = (
  queue: Queue<TestWorkUnit, unknown, string>,
  worker: Worker<TestWorkUnit, unknown, string>
): BullMqWorkQueue<TestWorkUnit> => {
  const pullWorker: BullMqWorkerLike<TestWorkUnit> = {
    getNextJob: (token) => worker.getNextJob(token, { block: false })
  };

  return new BullMqWorkQueue({
    queue,
    worker: pullWorker,
    tokenFactory: ({ workerId, now }) => `${workerId}:${now.getTime()}`
  });
};

const createWork = (id: string): TestWorkUnit => ({
  id,
  type: "partition",
  payload: { shard: 1 }
});

const parseRedisConnection = (value: string): ConnectionOptions => {
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
