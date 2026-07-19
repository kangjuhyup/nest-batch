import { describe, expect, it } from "vitest";
import { defineChunkStep, defineStep, skipItem } from "../src/index.js";
import { runChunkStep } from "../src/runner/chunk-step-runner.js";
import { runTaskletStep } from "../src/runner/tasklet-step-runner.js";
import type { BatchExecutionId, CheckpointStore } from "../src/index.js";
import type { StepRunContext } from "../src/runner/step-run-context.js";

class RecordingCheckpointStore implements CheckpointStore {
  readonly writes: Array<{
    readonly executionId: BatchExecutionId;
    readonly stepName: string;
    readonly checkpoint: unknown;
  }> = [];
  private readonly checkpoints = new Map<string, unknown>();

  set(executionId: BatchExecutionId, stepName: string, checkpoint: unknown): void {
    this.checkpoints.set(this.key(executionId, stepName), checkpoint);
  }

  async read<TCheckpoint = unknown>(
    executionId: BatchExecutionId,
    stepName: string
  ): Promise<TCheckpoint | undefined> {
    return this.checkpoints.get(this.key(executionId, stepName)) as TCheckpoint | undefined;
  }

  async write<TCheckpoint = unknown>(
    executionId: BatchExecutionId,
    stepName: string,
    checkpoint: TCheckpoint
  ): Promise<void> {
    this.writes.push({ executionId, stepName, checkpoint });
    this.set(executionId, stepName, checkpoint);
  }

  async delete(executionId: BatchExecutionId, stepName: string): Promise<void> {
    this.checkpoints.delete(this.key(executionId, stepName));
  }

  private key(executionId: BatchExecutionId, stepName: string): string {
    return `${executionId}:${stepName}`;
  }
}

const createContext = (overrides: Partial<StepRunContext> = {}): StepRunContext => ({
  jobExecutionId: "execution-1",
  checkpointExecutionId: "execution-1",
  stepIndex: 0,
  input: undefined,
  ...overrides
});

describe("step runners / step runner", () => {
  it("runs tasklet steps with checkpoint and input / checkpoint와 input으로 tasklet step을 실행한다", async () => {
    const checkpointStore = new RecordingCheckpointStore();
    checkpointStore.set("failed-execution", "load-users", { cursor: 10 });
    const signal = new AbortController().signal;
    const step = defineStep<string, string>({
      name: "load-users",
      execute({ checkpoint, input, signal: stepSignal }) {
        expect(checkpoint).toEqual({ cursor: 10 });
        expect(stepSignal).toBe(signal);

        return `${input}:loaded`;
      }
    });

    const result = await runTaskletStep(
      step,
      createContext({
        checkpointExecutionId: "failed-execution",
        input: "tenant-acme",
        signal
      }),
      checkpointStore
    );

    expect(result).toEqual({
      output: "tenant-acme:loaded",
      readCount: 0,
      writeCount: 0,
      skipCount: 0,
      retryCount: 0
    });
  });

  it("runs chunk steps and writes checkpoints / chunk step을 실행하고 checkpoint를 저장한다", async () => {
    const checkpointStore = new RecordingCheckpointStore();
    checkpointStore.set("failed-execution", "copy-users", { cursor: 1 });
    const written: string[][] = [];
    const seenCheckpoints: unknown[] = [];
    const step = defineChunkStep<string, string, { readonly cursor: number }>({
      name: "copy-users",
      chunkSize: 2,
      reader: {
        *read({ checkpoint }) {
          seenCheckpoints.push(checkpoint);
          yield "user-1";
          yield "inactive-user";
          yield "user-2";
        }
      },
      processor: {
        process(item) {
          return item === "inactive-user" ? skipItem("inactive user") : item.toUpperCase();
        }
      },
      writer: {
        write(items) {
          written.push([...items]);
        }
      },
      checkpoint({ checkpoint, readCount }) {
        return { cursor: (checkpoint?.cursor ?? 0) + readCount };
      }
    });

    const result = await runChunkStep(
      step,
      createContext({
        checkpointExecutionId: "failed-execution"
      }),
      checkpointStore
    );

    expect(result).toEqual({
      readCount: 3,
      writeCount: 2,
      skipCount: 1,
      retryCount: 0
    });
    expect(seenCheckpoints).toEqual([{ cursor: 1 }]);
    expect(written).toEqual([["USER-1", "USER-2"]]);
    expect(checkpointStore.writes).toEqual([
      {
        executionId: "execution-1",
        stepName: "copy-users",
        checkpoint: { cursor: 4 }
      }
    ]);
  });

  it("retries processor failures and records retry count / processor 실패를 재시도하고 retry count를 기록한다", async () => {
    const checkpointStore = new RecordingCheckpointStore();
    const written: string[][] = [];
    const retryAttempts: number[] = [];
    let processAttempts = 0;
    const step = defineChunkStep<string, string>({
      name: "retry-users",
      chunkSize: 1,
      reader: {
        *read() {
          yield "user-1";
        }
      },
      processor: {
        process(item) {
          processAttempts += 1;

          if (processAttempts === 1) {
            throw new Error("temporary processor failure");
          }

          return item.toUpperCase();
        }
      },
      writer: {
        write(items) {
          written.push([...items]);
        }
      },
      retryPolicy: {
        canRetry({ attempt, phase }) {
          retryAttempts.push(attempt);
          return phase === "process" && attempt < 2;
        }
      }
    });

    const result = await runChunkStep(step, createContext(), checkpointStore);

    expect(result).toMatchObject({
      readCount: 1,
      writeCount: 1,
      skipCount: 0,
      retryCount: 1
    });
    expect(retryAttempts).toEqual([1]);
    expect(written).toEqual([["USER-1"]]);
  });

  it("skips processor failures with skip policy / skip policy로 processor 실패 item을 건너뛴다", async () => {
    const checkpointStore = new RecordingCheckpointStore();
    const written: string[][] = [];
    const skipped: unknown[] = [];
    const step = defineChunkStep<string, string>({
      name: "skip-users",
      chunkSize: 2,
      reader: {
        *read() {
          yield "user-1";
          yield "inactive-user";
          yield "user-2";
        }
      },
      processor: {
        process(item) {
          if (item === "inactive-user") {
            throw new Error("inactive user");
          }

          return item.toUpperCase();
        }
      },
      writer: {
        write(items) {
          written.push([...items]);
        }
      },
      skipPolicy: {
        canSkip({ error, item }) {
          skipped.push({ error, item });
          return error instanceof Error && error.message === "inactive user";
        }
      }
    });

    const result = await runChunkStep(step, createContext(), checkpointStore);

    expect(result).toMatchObject({
      readCount: 3,
      writeCount: 2,
      skipCount: 1,
      retryCount: 0
    });
    expect(skipped).toHaveLength(1);
    expect(written).toEqual([["USER-1", "USER-2"]]);
  });

  it("retries writer failures and passes increasing attempts / writer 실패를 재시도하고 증가하는 attempt를 전달한다", async () => {
    const checkpointStore = new RecordingCheckpointStore();
    const writerAttempts: number[] = [];
    const step = defineChunkStep<string>({
      name: "retry-writer",
      chunkSize: 2,
      reader: {
        *read() {
          yield "user-1";
          yield "user-2";
        }
      },
      writer: {
        write(_items, { attempt }) {
          writerAttempts.push(attempt);

          if (attempt === 1) {
            throw new Error("temporary writer failure");
          }
        }
      },
      retryPolicy: {
        canRetry({ attempt, phase }) {
          return phase === "write" && attempt < 2;
        }
      }
    });

    const result = await runChunkStep(step, createContext(), checkpointStore);

    expect(result).toMatchObject({
      readCount: 2,
      writeCount: 2,
      skipCount: 0,
      retryCount: 1
    });
    expect(writerAttempts).toEqual([1, 2]);
  });
});
