import type { WorkerPool, WorkerTask } from "@nest-batch/core";

export interface LocalWorkerPoolOptions {
  readonly capacity: number;
}

interface QueuedTask<T> {
  readonly task: WorkerTask<T> | ((signal: AbortSignal) => Promise<T> | T);
  readonly signal?: AbortSignal;
  readonly controller: AbortController;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
  cleanupAbortListener?: () => void;
}

export class LocalWorkerPool implements WorkerPool {
  readonly capacity: number;
  private readonly queue: QueuedTask<any>[] = [];
  private readonly idleResolvers: Array<() => void> = [];
  private activeCount = 0;
  private closed = false;

  constructor(options: LocalWorkerPoolOptions) {
    assertCapacity(options.capacity);
    this.capacity = options.capacity;
  }

  run<T>(
    task: WorkerTask<T> | ((signal: AbortSignal) => Promise<T> | T),
    signal?: AbortSignal
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("LocalWorkerPool is closed."));
    }

    if (signal?.aborted) {
      return Promise.reject(createAbortError());
    }

    return new Promise<T>((resolve, reject) => {
      const queued: QueuedTask<T> = {
        task,
        signal,
        controller: new AbortController(),
        resolve,
        reject
      };

      if (signal) {
        const abort = (): void => {
          const removed = this.removeQueuedTask(queued);

          if (removed) {
            queued.cleanupAbortListener?.();
            queued.reject(createAbortError());
            this.drain();
          }
        };

        signal.addEventListener("abort", abort, { once: true });
        queued.cleanupAbortListener = () => signal.removeEventListener("abort", abort);
      }

      this.queue.push(queued);
      this.drain();
    });
  }

  async close(): Promise<void> {
    this.closed = true;

    for (const task of this.queue.splice(0)) {
      task.cleanupAbortListener?.();
      task.reject(new Error("LocalWorkerPool is closed."));
    }

    if (this.activeCount === 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private drain(): void {
    while (!this.closed && this.activeCount < this.capacity && this.queue.length > 0) {
      const task = this.queue.shift()!;
      task.cleanupAbortListener?.();
      this.activeCount += 1;

      void this.execute(task).finally(() => {
        this.activeCount -= 1;
        this.resolveIdleWaiters();
        this.drain();
      });
    }
  }

  private async execute<T>(task: QueuedTask<T>): Promise<void> {
    try {
      const result = await runWorkerTask(task.task, task.controller.signal);
      task.resolve(result);
    } catch (error) {
      task.reject(error);
    }
  }

  private removeQueuedTask(task: QueuedTask<any>): boolean {
    const index = this.queue.indexOf(task);

    if (index < 0) {
      return false;
    }

    this.queue.splice(index, 1);
    return true;
  }

  private resolveIdleWaiters(): void {
    if (this.activeCount > 0 || this.queue.length > 0) {
      return;
    }

    for (const resolve of this.idleResolvers.splice(0)) {
      resolve();
    }
  }
}

const runWorkerTask = async <T>(
  task: WorkerTask<T> | ((signal: AbortSignal) => Promise<T> | T),
  signal: AbortSignal
): Promise<T> => {
  signal.throwIfAborted();

  if (typeof task === "function") {
    return task(signal);
  }

  return task.run(signal);
};

const assertCapacity = (capacity: number): void => {
  if (!Number.isSafeInteger(capacity) || capacity <= 0) {
    throw new TypeError("LocalWorkerPool capacity must be a positive safe integer.");
  }
};

const createAbortError = (): Error => {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
};
