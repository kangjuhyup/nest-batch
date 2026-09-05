import { describe, expect, it } from "vitest";
import { BullMqWorkQueue } from "../src/index.js";
import type {
  BullMqClaimedJob,
  BullMqJobOptions,
  BullMqQueueLike,
  BullMqWorkerLike
} from "../src/index.js";
import type { WorkUnit } from "@rv-nest-batch/core/queue";

class FakeBullMqQueue<TWork extends WorkUnit> implements BullMqQueueLike<TWork> {
  readonly added: Array<{
    readonly name: string;
    readonly data: TWork;
    readonly options: BullMqJobOptions;
  }> = [];

  async add(name: string, data: TWork, options: BullMqJobOptions): Promise<void> {
    this.added.push({ name, data, options });
  }
}

class FakeBullMqWorker<TWork extends WorkUnit> implements BullMqWorkerLike<TWork> {
  readonly tokens: string[] = [];
  private readonly jobs: BullMqClaimedJob<TWork>[];

  constructor(jobs: readonly BullMqClaimedJob<TWork>[]) {
    this.jobs = [...jobs];
  }

  async getNextJob(token: string): Promise<BullMqClaimedJob<TWork> | undefined> {
    this.tokens.push(token);
    return this.jobs.shift();
  }
}

class FakeBullMqJob<TWork extends WorkUnit> implements BullMqClaimedJob<TWork> {
  readonly completed: Array<{ readonly returnValue: unknown; readonly token: string; readonly fetchNext: boolean }> = [];
  readonly failed: Array<{ readonly error: Error; readonly token: string; readonly fetchNext: boolean }> = [];

  constructor(readonly data: TWork, readonly id: string = data.id) {}

  async moveToCompleted(returnValue: unknown, token: string, fetchNext = true): Promise<void> {
    this.completed.push({ returnValue, token, fetchNext });
  }

  async moveToFailed(error: Error, token: string, fetchNext = true): Promise<void> {
    this.failed.push({ error, token, fetchNext });
  }
}

const createWork = (id: string): WorkUnit<{ readonly shard: number }> => ({
  id,
  type: "partition",
  payload: { shard: 1 }
});

describe("bullmq work queue / BullMQ work queue", () => {
  it("enqueues work with work id as BullMQ job id / work id를 BullMQ job id로 enqueue한다", async () => {
    const queue = new FakeBullMqQueue<WorkUnit>();
    const worker = new FakeBullMqWorker<WorkUnit>([]);
    const workQueue = new BullMqWorkQueue({ queue, worker });
    const work = createWork("work-1");

    await workQueue.enqueue(work);

    expect(queue.added).toEqual([
      {
        name: "partition",
        data: work,
        options: {
          jobId: "work-1",
          attempts: 1
        }
      }
    ]);
  });

  it("encodes colon work ids for BullMQ job ids / colon이 포함된 work id를 BullMQ job id로 encode한다", async () => {
    const queue = new FakeBullMqQueue<WorkUnit>();
    const worker = new FakeBullMqWorker<WorkUnit>([]);
    const workQueue = new BullMqWorkQueue({ queue, worker });
    const work = createWork("schedule:billing.daily:2026-01-01T00:00:00.000Z");

    await workQueue.enqueue(work);

    expect(queue.added).toEqual([
      {
        name: "partition",
        data: work,
        options: {
          jobId: encodeURIComponent(work.id),
          attempts: 1
        }
      }
    ]);
  });

  it("claims and completes BullMQ jobs / BullMQ job을 claim하고 완료한다", async () => {
    const job = new FakeBullMqJob(createWork("work-1"));
    const queue = new FakeBullMqQueue<WorkUnit>();
    const worker = new FakeBullMqWorker<WorkUnit>([job]);
    const workQueue = new BullMqWorkQueue({
      queue,
      worker,
      tokenFactory: ({ workerId }) => `${workerId}:token`
    });

    const claimed = await workQueue.claim({
      workerId: "worker-1",
      now: new Date("2026-07-25T00:00:00.000Z")
    });

    expect(claimed).toEqual(job.data);
    await workQueue.complete(job.data);

    expect(worker.tokens).toEqual(["worker-1:token"]);
    expect(job.completed).toEqual([
      {
        returnValue: null,
        token: "worker-1:token",
        fetchNext: false
      }
    ]);
  });

  it("moves failed work to BullMQ failed state / 실패 work를 BullMQ failed 상태로 이동한다", async () => {
    const job = new FakeBullMqJob(createWork("work-1"));
    const queue = new FakeBullMqQueue<WorkUnit>();
    const worker = new FakeBullMqWorker<WorkUnit>([job]);
    const workQueue = new BullMqWorkQueue({
      queue,
      worker,
      tokenFactory: () => "token"
    });
    const error = new Error("handler failed");

    await workQueue.claim({
      workerId: "worker-1",
      now: new Date("2026-07-25T00:00:00.000Z")
    });
    await workQueue.fail(job.data, error);

    expect(job.failed).toEqual([
      {
        error,
        token: "token",
        fetchNext: false
      }
    ]);
  });

  it("rejects completing unclaimed work / claim하지 않은 work 완료를 거부한다", async () => {
    const queue = new FakeBullMqQueue<WorkUnit>();
    const worker = new FakeBullMqWorker<WorkUnit>([]);
    const workQueue = new BullMqWorkQueue({ queue, worker });

    await expect(workQueue.complete(createWork("missing"))).rejects.toThrow(
      'BullMQ work "missing" has not been claimed by this queue instance.'
    );
  });
});
