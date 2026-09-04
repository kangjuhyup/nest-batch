import { describe, expect, it, vi, afterEach } from "vitest";
import {
  ContinuousPollingLoop,
  type PollingEvent,
  type PollingTaskContext
} from "@nest-batch/core/polling";

describe("continuous polling loop / continuous polling loop를 검증한다", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes worker id and abort signal to runOnce / runOnce에 worker id와 abort signal을 전달한다", async () => {
    const controller = new AbortController();
    let context: PollingTaskContext | undefined;
    const loop = new ContinuousPollingLoop({
      workerId: "outbox-worker-1",
      pollIntervalMs: 1_000,
      task: (nextContext) => {
        context = nextContext;
        return 7;
      }
    });

    const result = await loop.runOnce({ signal: controller.signal });

    expect(result.processedCount).toBe(7);
    expect(result.busy).toBe(true);
    expect(context?.workerId).toBe("outbox-worker-1");
    expect(context?.signal).toBe(controller.signal);
  });

  it("drains busy iterations without sleeping / 처리 건수가 있으면 sleep 없이 다음 iteration을 실행한다", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let calls = 0;
    const loop = new ContinuousPollingLoop({
      workerId: "outbox-worker-1",
      pollIntervalMs: 1_000,
      task: () => {
        calls += 1;
        if (calls === 3) {
          controller.abort();
        }
        return calls < 3 ? 1 : 0;
      }
    });

    const running = loop.runUntilStopped({ signal: controller.signal });
    await flushMicrotasks(4);
    await running;

    expect(calls).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits only when an iteration is idle / idle iteration에서만 poll interval만큼 대기한다", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const task = vi.fn(() => 0);
    const loop = new ContinuousPollingLoop({
      workerId: "outbox-worker-1",
      pollIntervalMs: 1_000,
      task
    });

    const running = loop.runUntilStopped({ signal: controller.signal });
    await flushMicrotasks();

    expect(task).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(task).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);

    controller.abort();
    await running;
  });

  it("retries system errors after bounded exponential backoff / 시스템 오류를 bounded exponential backoff 후 재시도한다", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const events: PollingEvent[] = [];
    const task = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(0);
    const loop = new ContinuousPollingLoop({
      workerId: "outbox-worker-1",
      pollIntervalMs: 1_000,
      task,
      errorBackoff: {
        initialMs: 100,
        maxMs: 1_000,
        multiplier: 2,
        jitterRatio: 0
      },
      observer: {
        onPollingEvent: (event) => events.push(event)
      }
    });

    const running = loop.runUntilStopped({ signal: controller.signal });
    await flushMicrotasks();

    expect(task).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      expect.objectContaining({
        type: "polling.iteration.error_backoff",
        attempt: 1,
        backoffMs: 100
      })
    ]);

    await vi.advanceTimersByTimeAsync(99);
    expect(task).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);

    controller.abort();
    await running;
  });

  it("retries task AbortError when worker signal is not aborted / worker signal 취소가 아닌 task AbortError는 재시도한다", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const events: PollingEvent[] = [];
    const abortError = new Error("task-level timeout");
    abortError.name = "AbortError";
    const task = vi.fn().mockRejectedValueOnce(abortError).mockImplementationOnce(() => {
      controller.abort();
      return 0;
    });
    const loop = new ContinuousPollingLoop({
      workerId: "outbox-worker-1",
      pollIntervalMs: 1_000,
      task,
      errorBackoff: {
        initialMs: 100,
        maxMs: 1_000,
        multiplier: 2,
        jitterRatio: 0
      },
      observer: {
        onPollingEvent: (event) => events.push(event)
      }
    });

    const running = loop.runUntilStopped({ signal: controller.signal });
    await flushMicrotasks();

    expect(task).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      expect.objectContaining({
        type: "polling.iteration.error_backoff",
        error: abortError,
        backoffMs: 100
      })
    ]);

    await vi.advanceTimersByTimeAsync(100);
    await running;

    expect(task).toHaveBeenCalledTimes(2);
  });

  it("keeps jittered backoff inside configured bounds / jitter backoff를 설정 범위 안에 둔다", async () => {
    vi.useFakeTimers();
    const observedBackoffs: number[] = [];

    for (const random of [() => 0, () => 1]) {
      const controller = new AbortController();
      const loop = new ContinuousPollingLoop({
        workerId: "outbox-worker-1",
        pollIntervalMs: 1_000,
        task: () => {
          throw new Error("network partition");
        },
        random,
        errorBackoff: {
          initialMs: 100,
          maxMs: 120,
          multiplier: 2,
          jitterRatio: 0.5
        },
        observer: {
          onPollingEvent: (event) => {
            if (event.type === "polling.iteration.error_backoff") {
              observedBackoffs.push(event.backoffMs);
              controller.abort();
            }
          }
        }
      });

      await loop.runUntilStopped({ signal: controller.signal });
    }

    expect(observedBackoffs).toEqual([50, 120]);
  });

  it("rejects non-positive error backoff delays / 0 이하 error backoff 지연을 거부한다", () => {
    expect(
      () =>
        new ContinuousPollingLoop({
          workerId: "outbox-worker-1",
          pollIntervalMs: 0,
          task: () => 0,
          errorBackoff: {
            initialMs: 0
          }
        })
    ).toThrow("ContinuousPollingLoop errorBackoff.initialMs must be a positive safe integer.");

    expect(
      () =>
        new ContinuousPollingLoop({
          workerId: "outbox-worker-1",
          pollIntervalMs: 0,
          task: () => 0,
          errorBackoff: {
            maxMs: 0
          }
        })
    ).toThrow("ContinuousPollingLoop errorBackoff.maxMs must be a positive safe integer.");
  });

  it("stops immediately when aborted during idle sleep / idle sleep 중 abort되면 즉시 멈춘다", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const task = vi.fn(() => 0);
    const loop = new ContinuousPollingLoop({
      workerId: "outbox-worker-1",
      pollIntervalMs: 60_000,
      task
    });

    const running = loop.runUntilStopped({ signal: controller.signal });
    await flushMicrotasks();

    controller.abort();
    await running;

    expect(task).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for in-flight runOnce during shutdown / shutdown 중 진행 중인 runOnce 정리를 기다린다", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let resolveTask: ((value: number) => void) | undefined;
    let observedSignal: AbortSignal | undefined;
    let stopped = false;
    const loop = new ContinuousPollingLoop({
      workerId: "outbox-worker-1",
      pollIntervalMs: 1_000,
      task: ({ signal }) => {
        observedSignal = signal;
        return new Promise<number>((resolve) => {
          resolveTask = resolve;
        });
      }
    });

    const running = loop.runUntilStopped({ signal: controller.signal }).then(() => {
      stopped = true;
    });
    await flushMicrotasks();

    controller.abort();
    await flushMicrotasks();

    expect(observedSignal?.aborted).toBe(true);
    expect(stopped).toBe(false);

    resolveTask?.(0);
    await running;

    expect(stopped).toBe(true);
  });

  it("isolates observer failures from loop semantics / observer 실패를 loop 실행 의미에서 격리한다", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let calls = 0;
    const loop = new ContinuousPollingLoop({
      workerId: "outbox-worker-1",
      pollIntervalMs: 1_000,
      task: () => {
        calls += 1;
        if (calls === 2) {
          controller.abort();
          return 0;
        }
        return 1;
      },
      observer: {
        onPollingEvent: () => {
          throw new Error("observer unavailable");
        }
      }
    });

    await loop.runUntilStopped({ signal: controller.signal });

    expect(calls).toBe(2);
  });

  it("does not expose batch metadata context for polling ticks / polling tick에 batch metadata context를 노출하지 않는다", async () => {
    const observedKeys: string[][] = [];
    const loop = new ContinuousPollingLoop({
      workerId: "outbox-worker-1",
      pollIntervalMs: 1_000,
      task: (context) => {
        observedKeys.push(Object.keys(context).sort());
        return false;
      }
    });

    await loop.runOnce();

    expect(observedKeys).toEqual([["iteration", "signal", "startedAt", "workerId"]]);
  });
});

const flushMicrotasks = async (times = 1): Promise<void> => {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
};
