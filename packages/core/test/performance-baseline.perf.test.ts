import { performance } from "node:perf_hooks";
import {
  DefaultBatchRunner,
  defineChunkStep,
  defineJob,
  skipItem
} from "@nest-batch/core";
import type { StepExecution } from "@nest-batch/core";
import { InMemoryBatchStorage } from "@nest-batch/inmemory";
import { describe, expect, it } from "vitest";

const itemCount = readPositiveInteger(process.env.NEST_BATCH_PERF_ITEMS, 10_000, "NEST_BATCH_PERF_ITEMS");
const chunkSize = readPositiveInteger(process.env.NEST_BATCH_PERF_CHUNK_SIZE, 100, "NEST_BATCH_PERF_CHUNK_SIZE");

interface RuntimeCheckpoint {
  readonly cursor: number;
}

interface BenchmarkScenario {
  readonly name: string;
  readonly checkpoint: boolean;
  readonly retrySkip: boolean;
}

interface BenchmarkResult {
  readonly scenario: string;
  readonly items: number;
  readonly chunkSize: number;
  readonly chunks: number;
  readonly durationMs: number;
  readonly itemsPerSecond: number;
  readonly readCount: number;
  readonly writeCount: number;
  readonly skipCount: number;
  readonly retryCount: number;
  readonly checkpointWrites: number;
}

const scenarios: readonly BenchmarkScenario[] = [
  { name: "chunk-throughput", checkpoint: false, retrySkip: false },
  { name: "checkpoint-overhead", checkpoint: true, retrySkip: false },
  { name: "retry-skip-overhead", checkpoint: true, retrySkip: true }
];

describe("core runtime perf baseline / core runtime 성능 기준을 측정한다", () => {
  it("measures chunk runtime scenarios / chunk runtime scenario 성능을 측정한다", async () => {
    const results: BenchmarkResult[] = [];

    for (const scenario of scenarios) {
      results.push(await measureScenario(scenario));
    }

    expect(results).toHaveLength(scenarios.length);

    for (const result of results) {
      expect(result.items).toBe(itemCount);
      expect(result.chunkSize).toBe(chunkSize);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(result.itemsPerSecond)).toBe(true);
      expect(result.itemsPerSecond).toBeGreaterThan(0);
      expect(result.readCount).toBe(itemCount);
      expect(result.writeCount + result.skipCount).toBe(itemCount);
      expect(result.chunks).toBeGreaterThan(0);
    }

    console.table(results.map(formatBenchmarkResult));
  }, 120_000);
});

async function measureScenario(scenario: BenchmarkScenario): Promise<BenchmarkResult> {
  const storage = new InMemoryBatchStorage();
  const executionId = `core-perf-${scenario.name}`;
  const stepName = `process-${scenario.name}`;
  const writtenItems: number[] = [];
  let processorFailures = 0;
  let checkpointWrites = 0;
  const retryItem = Math.min(3, Math.max(0, itemCount - 1));
  const skipEvery = Math.max(2, Math.floor(itemCount / 10));
  const runner = new DefaultBatchRunner(storage, {
    generateExecutionId: () => executionId,
    generateOwnerId: () => "core-perf-worker",
    now: () => new Date("2026-07-20T00:00:00.000Z")
  });
  const job = defineJob({
    name: `core-perf-${scenario.name}`,
    steps: [
      defineChunkStep<number, number, RuntimeCheckpoint>({
        name: stepName,
        chunkSize,
        reader: {
          async *read({ signal }) {
            for (let index = 0; index < itemCount; index += 1) {
              signal.throwIfAborted();
              yield index;
            }
          }
        },
        processor: scenario.retrySkip
          ? {
              async process(item) {
                if (item === retryItem && processorFailures === 0) {
                  processorFailures += 1;
                  throw new Error("temporary processor failure");
                }

                if (item !== retryItem && item > 0 && item % skipEvery === 0) {
                  return skipItem("sample skipped item");
                }

                return item;
              }
            }
          : undefined,
        writer: {
          async write(items) {
            writtenItems.push(...items);
          }
        },
        retryPolicy: scenario.retrySkip
          ? {
              canRetry({ attempt, error, phase }) {
                return phase === "process" && attempt < 2 && isTemporaryProcessorFailure(error);
              }
            }
          : undefined,
        checkpoint: scenario.checkpoint
          ? ({ readCount }) => {
              checkpointWrites += 1;
              return { cursor: readCount };
            }
          : undefined
      })
    ]
  });

  const startedAt = performance.now();
  const execution = await runner.run(job, { itemCount, scenario: scenario.name });
  const durationMs = performance.now() - startedAt;
  const [stepExecution] = await storage.repository.findStepExecutions(execution.id);

  expect(execution.status).toBe("completed");
  expect(stepExecution).toMatchObject<Partial<StepExecution>>({
    jobExecutionId: execution.id,
    stepName,
    status: "completed"
  });

  if (scenario.retrySkip) {
    expect(stepExecution.retryCount).toBe(1);
    expect(stepExecution.skipCount).toBeGreaterThan(0);
  }

  if (scenario.checkpoint) {
    const checkpoint = await storage.checkpointStore.read<RuntimeCheckpoint>(execution.id, stepName);
    expect(checkpoint?.cursor).toBe(itemCount);
    expect(checkpointWrites).toBeGreaterThan(0);
  }

  return {
    scenario: scenario.name,
    items: itemCount,
    chunkSize,
    chunks: Math.ceil(stepExecution.writeCount / chunkSize),
    durationMs,
    itemsPerSecond: (itemCount / Math.max(durationMs, 0.001)) * 1000,
    readCount: stepExecution.readCount,
    writeCount: stepExecution.writeCount,
    skipCount: stepExecution.skipCount,
    retryCount: stepExecution.retryCount,
    checkpointWrites
  };
}

function isTemporaryProcessorFailure(error: unknown): boolean {
  return error instanceof Error && error.message === "temporary processor failure";
}

function formatBenchmarkResult(result: BenchmarkResult): Record<string, string | number> {
  return {
    scenario: result.scenario,
    items: result.items,
    chunkSize: result.chunkSize,
    chunks: result.chunks,
    durationMs: result.durationMs.toFixed(2),
    itemsPerSecond: result.itemsPerSecond.toFixed(2),
    readCount: result.readCount,
    writeCount: result.writeCount,
    skipCount: result.skipCount,
    retryCount: result.retryCount,
    checkpointWrites: result.checkpointWrites
  };
}

function readPositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}
