import type { WorkClaimOptions, WorkQueue, WorkUnit } from "@nest-batch/core/queue";

export interface BullMqJobOptions {
  readonly jobId?: string;
  readonly attempts?: number;
  readonly removeOnComplete?: boolean;
  readonly removeOnFail?: boolean;
  readonly delay?: number;
  readonly priority?: number;
}

export interface BullMqQueueLike<TWork extends WorkUnit = WorkUnit> {
  add(name: string, data: TWork, options: BullMqJobOptions): Promise<unknown>;
}

export interface BullMqClaimedJob<TWork extends WorkUnit = WorkUnit> {
  readonly id?: string | number;
  readonly data: TWork;
  moveToCompleted(returnValue: unknown, token: string, fetchNext?: boolean): Promise<unknown>;
  moveToFailed(error: Error, token: string, fetchNext?: boolean): Promise<unknown>;
}

export interface BullMqWorkerLike<TWork extends WorkUnit = WorkUnit> {
  getNextJob(token: string): Promise<BullMqClaimedJob<TWork> | null | undefined>;
}

export interface BullMqWorkQueueOptions<TWork extends WorkUnit = WorkUnit> {
  readonly queue: BullMqQueueLike<TWork>;
  readonly worker: BullMqWorkerLike<TWork>;
  readonly jobName?: string;
  readonly jobOptions?: BullMqJobOptions;
  readonly tokenFactory?: (options: WorkClaimOptions) => string;
}

interface ClaimedBullMqJob<TWork extends WorkUnit> {
  readonly job: BullMqClaimedJob<TWork>;
  readonly token: string;
}

export class BullMqWorkQueue<TWork extends WorkUnit = WorkUnit> implements WorkQueue<TWork> {
  private readonly queue: BullMqQueueLike<TWork>;
  private readonly worker: BullMqWorkerLike<TWork>;
  private readonly jobName: string;
  private readonly jobOptions: BullMqJobOptions;
  private readonly tokenFactory: (options: WorkClaimOptions) => string;
  private readonly claimed = new Map<string, ClaimedBullMqJob<TWork>>();

  constructor(options: BullMqWorkQueueOptions<TWork>) {
    this.queue = options.queue;
    this.worker = options.worker;
    this.jobName = options.jobName ?? "nest-batch.work";
    this.jobOptions = options.jobOptions ?? {};
    this.tokenFactory = options.tokenFactory ?? defaultTokenFactory;
  }

  async enqueue(work: TWork): Promise<void> {
    await this.queue.add(work.type ?? this.jobName, work, {
      ...this.jobOptions,
      jobId: createBullMqJobId(work.id),
      attempts: this.jobOptions.attempts ?? 1
    });
  }

  async claim(options: WorkClaimOptions): Promise<TWork | undefined> {
    options.signal?.throwIfAborted();
    const token = this.tokenFactory(options);
    const job = await this.worker.getNextJob(token);
    options.signal?.throwIfAborted();

    if (!job) {
      return undefined;
    }

    this.claimed.set(job.data.id, { job, token });

    return job.data;
  }

  async complete(work: TWork): Promise<void> {
    const claimed = this.takeClaimedJob(work);
    await claimed.job.moveToCompleted(null, claimed.token, false);
  }

  async fail(work: TWork, error: unknown): Promise<void> {
    const claimed = this.takeClaimedJob(work);
    await claimed.job.moveToFailed(toError(error), claimed.token, false);
  }

  private takeClaimedJob(work: TWork): ClaimedBullMqJob<TWork> {
    const claimed = this.claimed.get(work.id);

    if (!claimed) {
      throw new Error(`BullMQ work "${work.id}" has not been claimed by this queue instance.`);
    }

    this.claimed.delete(work.id);

    return claimed;
  }
}

const defaultTokenFactory = (options: WorkClaimOptions): string => {
  return `${options.workerId}:${options.now.getTime()}`;
};

const createBullMqJobId = (workId: string): string => {
  return workId.includes(":") ? encodeURIComponent(workId) : workId;
};

const toError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
};
