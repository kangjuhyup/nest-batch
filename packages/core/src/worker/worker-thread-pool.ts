import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type { WorkerPool, WorkerTask } from "../types/index.js";
import { workerEntrySource } from "./worker-entry.js";

export interface WorkerThreadPoolOptions {
  readonly capacity?: number;
}

export interface WorkerThreadTask<TPayload = unknown> {
  readonly moduleUrl: string;
  readonly payload?: TPayload;
}

interface QueuedWorkerThreadTask {
  readonly task: WorkerThreadTask;
  readonly signal?: AbortSignal;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: unknown) => void;
  cleanupAbortListener?: () => void;
  worker?: Worker;
  settled: boolean;
}

interface WorkerThreadSuccessMessage {
  readonly ok: true;
  readonly result: unknown;
}

interface WorkerThreadFailureMessage {
  readonly ok: false;
  readonly error: {
    readonly name: string;
    readonly message: string;
    readonly stack?: string;
  };
}

type WorkerThreadMessage = WorkerThreadSuccessMessage | WorkerThreadFailureMessage;

export class WorkerThreadPool implements WorkerPool {
  readonly capacity: number;
  private readonly queue: QueuedWorkerThreadTask[] = [];
  private readonly idleResolvers: Array<() => void> = [];
  private activeCount = 0;
  private closed = false;

  constructor(options: WorkerThreadPoolOptions = {}) {
    const capacity = options.capacity ?? Math.max(1, availableParallelism() - 1);
    assertCapacity(capacity);
    this.capacity = capacity;
  }

  run<TPayload = unknown, TResult = unknown>(
    task: WorkerThreadTask<TPayload>,
    signal?: AbortSignal
  ): Promise<TResult>;

  run<T>(
    task: WorkerTask<T> | ((signal: AbortSignal) => Promise<T> | T),
    signal?: AbortSignal
  ): Promise<T>;

  run<TPayload = unknown, TResult = unknown>(
    task: WorkerThreadTask<TPayload> | WorkerTask<TResult> | ((signal: AbortSignal) => Promise<TResult> | TResult),
    signal?: AbortSignal
  ): Promise<TResult> {
    if (!isWorkerThreadTask(task)) {
      return Promise.reject(new TypeError("WorkerThreadPool requires a worker thread task."));
    }

    if (this.closed) {
      return Promise.reject(new Error("WorkerThreadPool is closed."));
    }

    if (signal?.aborted) {
      return Promise.reject(createAbortError());
    }

    return new Promise<TResult>((resolve, reject) => {
      const queued: QueuedWorkerThreadTask = {
        task,
        signal,
        resolve: (result) => resolve(result as TResult),
        reject,
        settled: false
      };

      if (signal) {
        const abort = (): void => {
          if (queued.worker) {
            void this.abortRunningTask(queued);
            return;
          }

          const removed = this.removeQueuedTask(queued);

          if (removed) {
            queued.cleanupAbortListener?.();
            queued.settled = true;
            queued.reject(createAbortError());
            this.resolveIdleWaiters();
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
      task.settled = true;
      task.reject(new Error("WorkerThreadPool is closed."));
    }

    const terminating = this.queue
      .map((task) => task.worker?.terminate())
      .filter((promise): promise is Promise<number> => Boolean(promise));

    await Promise.allSettled(terminating);

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
      this.activeCount += 1;
      this.startWorker(task);
    }
  }

  private startWorker(task: QueuedWorkerThreadTask): void {
    const worker = new Worker(workerEntrySource, {
      eval: true,
      workerData: {
        moduleUrl: task.task.moduleUrl,
        payload: task.task.payload
      }
    });
    task.worker = worker;

    const settle = (callback: () => void): void => {
      if (task.settled) {
        return;
      }

      task.settled = true;
      task.cleanupAbortListener?.();
      worker.removeAllListeners();
      this.activeCount -= 1;
      callback();
      this.resolveIdleWaiters();
      this.drain();
    };

    worker.once("message", (message: WorkerThreadMessage) => {
      settle(() => {
        if (message.ok) {
          task.resolve(message.result);
          return;
        }

        task.reject(deserializeError(message.error));
      });
    });
    worker.once("error", (error) => {
      settle(() => task.reject(error));
    });
    worker.once("exit", (code) => {
      if (code === 0 || task.settled) {
        return;
      }

      settle(() => task.reject(new Error(`Worker thread exited with code ${code}.`)));
    });
  }

  private async abortRunningTask(task: QueuedWorkerThreadTask): Promise<void> {
    if (task.settled) {
      return;
    }

    task.settled = true;
    task.cleanupAbortListener?.();
    task.worker?.removeAllListeners();

    try {
      await task.worker?.terminate();
    } finally {
      this.activeCount -= 1;
      task.reject(createAbortError());
      this.resolveIdleWaiters();
      this.drain();
    }
  }

  private removeQueuedTask(task: QueuedWorkerThreadTask): boolean {
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

const isWorkerThreadTask = (task: unknown): task is WorkerThreadTask => {
  return Boolean(
    task &&
      typeof task === "object" &&
      "moduleUrl" in task &&
      typeof (task as { readonly moduleUrl?: unknown }).moduleUrl === "string"
  );
};

const assertCapacity = (capacity: number): void => {
  if (!Number.isSafeInteger(capacity) || capacity <= 0) {
    throw new TypeError("WorkerThreadPool capacity must be a positive safe integer.");
  }
};

const createAbortError = (): Error => {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
};

const deserializeError = (error: WorkerThreadFailureMessage["error"]): Error => {
  const deserialized = new Error(error.message);
  deserialized.name = error.name;
  deserialized.stack = error.stack;

  return deserialized;
};
