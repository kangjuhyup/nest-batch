export interface PollingTaskContext {
  readonly workerId: string;
  readonly signal: AbortSignal;
  readonly iteration: number;
  readonly startedAt: Date;
}

export type PollingTaskResult =
  | number
  | boolean
  | void
  | {
      readonly processedCount?: number;
      readonly processed?: boolean;
    };

export type PollingTask = (
  context: PollingTaskContext
) => Promise<PollingTaskResult> | PollingTaskResult;

export interface PollingRunOnceOptions {
  readonly signal?: AbortSignal;
}

export interface PollingRunOnceResult {
  readonly workerId: string;
  readonly iteration: number;
  readonly processedCount: number;
  readonly busy: boolean;
  readonly startedAt: Date;
  readonly endedAt: Date;
}

export interface PollingErrorBackoffOptions {
  readonly initialMs?: number;
  readonly maxMs?: number;
  readonly multiplier?: number;
  readonly jitterRatio?: number;
}

export interface ContinuousPollingLoopOptions {
  readonly workerId: string;
  readonly task: PollingTask;
  readonly pollIntervalMs?: number;
  readonly errorBackoff?: PollingErrorBackoffOptions;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly observer?: PollingObserver;
}

export interface PollingIterationSucceededEvent {
  readonly type: "polling.iteration.succeeded";
  readonly workerId: string;
  readonly iteration: number;
  readonly processedCount: number;
  readonly busy: boolean;
  readonly startedAt: Date;
  readonly endedAt: Date;
}

export interface PollingIterationIdleEvent {
  readonly type: "polling.iteration.idle";
  readonly workerId: string;
  readonly iteration: number;
  readonly pollIntervalMs: number;
  readonly observedAt: Date;
}

export interface PollingIterationErrorBackoffEvent {
  readonly type: "polling.iteration.error_backoff";
  readonly workerId: string;
  readonly iteration: number;
  readonly attempt: number;
  readonly error: unknown;
  readonly backoffMs: number;
  readonly observedAt: Date;
}

export type PollingStoppedReason = "aborted";

export interface PollingLoopStoppedEvent {
  readonly type: "polling.loop.stopped";
  readonly workerId: string;
  readonly reason: PollingStoppedReason;
  readonly iteration: number;
  readonly observedAt: Date;
}

export type PollingEvent =
  | PollingIterationSucceededEvent
  | PollingIterationIdleEvent
  | PollingIterationErrorBackoffEvent
  | PollingLoopStoppedEvent;

export interface PollingObserver {
  onPollingEvent(event: PollingEvent): Promise<void> | void;
}

export class ContinuousPollingLoop {
  private readonly workerId: string;
  private readonly task: PollingTask;
  private readonly pollIntervalMs: number;
  private readonly errorBackoff: Required<PollingErrorBackoffOptions>;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly observer?: PollingObserver;
  private iteration = 0;

  constructor(options: ContinuousPollingLoopOptions) {
    assertWorkerId(options.workerId);
    assertPollInterval(options.pollIntervalMs ?? 1_000);

    const errorBackoff = resolveErrorBackoff(options.errorBackoff);
    assertErrorBackoff(errorBackoff);

    this.workerId = options.workerId;
    this.task = options.task;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.errorBackoff = errorBackoff;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.observer = options.observer;
  }

  async runOnce(options: PollingRunOnceOptions = {}): Promise<PollingRunOnceResult> {
    const signal = options.signal ?? new AbortController().signal;
    const result = await this.executeIteration(this.nextIteration(), signal);
    await this.emitSuccessEvents(result);
    return result;
  }

  async runUntilStopped(options: PollingRunOnceOptions = {}): Promise<void> {
    const signal = options.signal ?? new AbortController().signal;
    let errorAttempt = 0;

    try {
      while (!signal.aborted) {
        const iteration = this.nextIteration();

        try {
          const result = await this.executeIteration(iteration, signal);
          await this.emitSuccessEvents(result);
          errorAttempt = 0;

          if (signal.aborted) {
            break;
          }

          if (!result.busy) {
            await delay(this.pollIntervalMs, signal);
          }
        } catch (error) {
          if (signal.aborted) {
            break;
          }

          errorAttempt += 1;
          const backoffMs = calculateBackoffMs(this.errorBackoff, errorAttempt, this.random);
          await this.emit({
            type: "polling.iteration.error_backoff",
            workerId: this.workerId,
            iteration,
            attempt: errorAttempt,
            error,
            backoffMs,
            observedAt: this.now()
          });
          await delay(backoffMs, signal);
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        throw error;
      }
    } finally {
      await this.emit({
        type: "polling.loop.stopped",
        workerId: this.workerId,
        reason: "aborted",
        iteration: this.iteration,
        observedAt: this.now()
      });
    }
  }

  private async executeIteration(
    iteration: number,
    signal: AbortSignal
  ): Promise<PollingRunOnceResult> {
    signal.throwIfAborted();
    const startedAt = this.now();
    const result = await this.task({
      workerId: this.workerId,
      signal,
      iteration,
      startedAt
    });
    const processedCount = normalizeTaskResult(result);

    return {
      workerId: this.workerId,
      iteration,
      processedCount,
      busy: processedCount > 0,
      startedAt,
      endedAt: this.now()
    };
  }

  private async emitSuccessEvents(result: PollingRunOnceResult): Promise<void> {
    await this.emit({
      type: "polling.iteration.succeeded",
      workerId: result.workerId,
      iteration: result.iteration,
      processedCount: result.processedCount,
      busy: result.busy,
      startedAt: result.startedAt,
      endedAt: result.endedAt
    });

    if (!result.busy) {
      await this.emit({
        type: "polling.iteration.idle",
        workerId: result.workerId,
        iteration: result.iteration,
        pollIntervalMs: this.pollIntervalMs,
        observedAt: result.endedAt
      });
    }
  }

  private async emit(event: PollingEvent): Promise<void> {
    try {
      await this.observer?.onPollingEvent(event);
    } catch {
      // Observer failures must not change polling loop semantics.
    }
  }

  private nextIteration(): number {
    this.iteration += 1;
    return this.iteration;
  }
}

const DEFAULT_ERROR_BACKOFF: Required<PollingErrorBackoffOptions> = {
  initialMs: 1_000,
  maxMs: 30_000,
  multiplier: 2,
  jitterRatio: 0.2
};

const resolveErrorBackoff = (
  options: PollingErrorBackoffOptions | undefined
): Required<PollingErrorBackoffOptions> => ({
  initialMs: options?.initialMs ?? DEFAULT_ERROR_BACKOFF.initialMs,
  maxMs: options?.maxMs ?? DEFAULT_ERROR_BACKOFF.maxMs,
  multiplier: options?.multiplier ?? DEFAULT_ERROR_BACKOFF.multiplier,
  jitterRatio: options?.jitterRatio ?? DEFAULT_ERROR_BACKOFF.jitterRatio
});

const assertWorkerId = (workerId: string): void => {
  if (workerId.trim().length === 0) {
    throw new TypeError("ContinuousPollingLoop workerId is required.");
  }
};

const assertPollInterval = (pollIntervalMs: number): void => {
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0) {
    throw new TypeError("ContinuousPollingLoop pollIntervalMs must be a non-negative safe integer.");
  }
};

const assertErrorBackoff = (options: Required<PollingErrorBackoffOptions>): void => {
  if (!Number.isSafeInteger(options.initialMs) || options.initialMs <= 0) {
    throw new TypeError("ContinuousPollingLoop errorBackoff.initialMs must be a positive safe integer.");
  }

  if (!Number.isSafeInteger(options.maxMs) || options.maxMs <= 0) {
    throw new TypeError("ContinuousPollingLoop errorBackoff.maxMs must be a positive safe integer.");
  }

  if (!Number.isFinite(options.multiplier) || options.multiplier < 1) {
    throw new TypeError("ContinuousPollingLoop errorBackoff.multiplier must be greater than or equal to 1.");
  }

  if (!Number.isFinite(options.jitterRatio) || options.jitterRatio < 0 || options.jitterRatio > 1) {
    throw new TypeError("ContinuousPollingLoop errorBackoff.jitterRatio must be between 0 and 1.");
  }
};

const normalizeTaskResult = (result: PollingTaskResult): number => {
  if (result === undefined || result === false) {
    return 0;
  }

  if (result === true) {
    return 1;
  }

  if (typeof result === "number") {
    return assertProcessedCount(result);
  }

  if (result.processedCount !== undefined) {
    return assertProcessedCount(result.processedCount);
  }

  return result.processed === true ? 1 : 0;
};

const assertProcessedCount = (processedCount: number): number => {
  if (!Number.isSafeInteger(processedCount) || processedCount < 0) {
    throw new TypeError("Polling task processed count must be a non-negative safe integer.");
  }

  return processedCount;
};

const calculateBackoffMs = (
  options: Required<PollingErrorBackoffOptions>,
  attempt: number,
  random: () => number
): number => {
  const exponentialMs = options.initialMs * options.multiplier ** (attempt - 1);
  const cappedBaseMs = Math.min(options.maxMs, exponentialMs);
  const jitterMs = cappedBaseMs * options.jitterRatio;
  const rawRandom = random();
  const normalizedRandom = Number.isFinite(rawRandom) ? Math.min(1, Math.max(0, rawRandom)) : 0;
  const minMs = Math.max(0, cappedBaseMs - jitterMs);
  const maxMs = Math.min(options.maxMs, cappedBaseMs + jitterMs);

  return Math.round(minMs + (maxMs - minMs) * normalizedRandom);
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

const createAbortError = (reason: unknown): Error => {
  if (reason instanceof Error) {
    return reason;
  }

  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
};
