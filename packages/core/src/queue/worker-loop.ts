import type { WorkClaimOptions, WorkQueue, WorkUnit } from "./work-queue.js";

export interface WorkerLoopContext {
  readonly workerId: string;
  readonly signal: AbortSignal;
}

export type WorkHandler<TWork extends WorkUnit = WorkUnit> = (
  work: TWork,
  context: WorkerLoopContext
) => Promise<void> | void;

export interface WorkerLoopOptions<TWork extends WorkUnit = WorkUnit> {
  readonly queue: WorkQueue<TWork>;
  readonly workerId: string;
  readonly handler: WorkHandler<TWork>;
  readonly pollIntervalMs?: number;
  readonly now?: () => Date;
}

export interface WorkerRunOnceOptions {
  readonly signal?: AbortSignal;
}

export class WorkerLoop<TWork extends WorkUnit = WorkUnit> {
  private readonly queue: WorkQueue<TWork>;
  private readonly workerId: string;
  private readonly handler: WorkHandler<TWork>;
  private readonly pollIntervalMs: number;
  private readonly now: () => Date;

  constructor(options: WorkerLoopOptions<TWork>) {
    assertWorkerId(options.workerId);
    assertPollInterval(options.pollIntervalMs ?? 1_000);

    this.queue = options.queue;
    this.workerId = options.workerId;
    this.handler = options.handler;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.now = options.now ?? (() => new Date());
  }

  async runOnce(options: WorkerRunOnceOptions = {}): Promise<boolean> {
    const controller = createRunController(options.signal);

    try {
      controller.signal.throwIfAborted();
      const work = await this.queue.claim(this.createClaimOptions(controller.signal));

      if (!work) {
        return false;
      }

      try {
        controller.signal.throwIfAborted();
        await this.handler(work, {
          workerId: this.workerId,
          signal: controller.signal
        });
        await this.queue.complete(work);
        return true;
      } catch (error) {
        await this.queue.fail(work, error);
        throw error;
      }
    } finally {
      controller.cleanup();
    }
  }

  async runUntilStopped(options: WorkerRunOnceOptions = {}): Promise<void> {
    const controller = createRunController(options.signal);

    try {
      while (!controller.signal.aborted) {
        const handled = await this.runOnce({ signal: controller.signal });

        if (!handled) {
          await delay(this.pollIntervalMs, controller.signal);
        }
      }
    } catch (error) {
      if (!isAbortError(error)) {
        throw error;
      }
    } finally {
      controller.cleanup();
    }
  }

  private createClaimOptions(signal: AbortSignal): WorkClaimOptions {
    return {
      workerId: this.workerId,
      now: this.now(),
      signal
    };
  }
}

const assertWorkerId = (workerId: string): void => {
  if (workerId.length === 0) {
    throw new TypeError("WorkerLoop workerId must not be empty.");
  }
};

const assertPollInterval = (pollIntervalMs: number): void => {
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0) {
    throw new TypeError("WorkerLoop pollIntervalMs must be a non-negative safe integer.");
  }
};

const createRunController = (
  parentSignal: AbortSignal | undefined
): AbortController & { cleanup(): void } => {
  const controller = new AbortController();

  if (!parentSignal) {
    return Object.assign(controller, { cleanup: () => undefined });
  }

  if (parentSignal.aborted) {
    controller.abort(parentSignal.reason);
    return Object.assign(controller, { cleanup: () => undefined });
  }

  const abort = (): void => {
    controller.abort(parentSignal.reason);
  };
  parentSignal.addEventListener("abort", abort, { once: true });

  return Object.assign(controller, {
    cleanup: () => parentSignal.removeEventListener("abort", abort)
  });
};

const delay = (ms: number, signal: AbortSignal): Promise<void> => {
  signal.throwIfAborted();

  if (ms === 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = (): void => {
      cleanup();
      reject(createAbortError(signal.reason));
    };

    signal.addEventListener("abort", abort, { once: true });
  });
};

const isAbortError = (error: unknown): boolean => {
  return error instanceof Error && error.name === "AbortError";
};

const createAbortError = (reason: unknown): Error => {
  if (reason instanceof Error) {
    return reason;
  }

  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
};
