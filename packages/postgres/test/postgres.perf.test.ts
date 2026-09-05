import type { JobExecution, JobInstance } from "@rvkang/batch-core";
import { performance } from "node:perf_hooks";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresBatchStorage } from "../src/index.js";

const { Pool } = pg;

const DEFAULT_POSTGRES_URL = "postgresql://nest_batch:nest_batch@127.0.0.1:15432/nest_batch";
const connectionString =
  process.env.NEST_BATCH_PERF_POSTGRES_URL ??
  process.env.NEST_BATCH_E2E_POSTGRES_URL ??
  process.env.NEST_BATCH_POSTGRES_URL ??
  DEFAULT_POSTGRES_URL;
const schema = validatePerfSchema(process.env.NEST_BATCH_PERF_POSTGRES_SCHEMA ?? "batch_perf");
const tablePrefix = validateIdentifier(process.env.NEST_BATCH_PERF_POSTGRES_TABLE_PREFIX ?? "nb_perf", "table prefix");
const iterations = readPositiveInteger(process.env.NEST_BATCH_PERF_ITERATIONS, 200, "NEST_BATCH_PERF_ITERATIONS");
const warmupIterations = readNonNegativeInteger(
  process.env.NEST_BATCH_PERF_WARMUP_ITERATIONS,
  Math.min(20, iterations),
  "NEST_BATCH_PERF_WARMUP_ITERATIONS"
);
const quotedSchema = quoteIdentifier(schema);
const adminPool = new Pool({ connectionString });
const storage = new PostgresBatchStorage({ connectionString, schema, tablePrefix });
let postgresAvailable = false;

interface BenchmarkResult {
  readonly scenario: string;
  readonly operations: number;
  readonly durationMs: number;
  readonly averageMs: number;
  readonly operationsPerSecond: number;
}

const createExecution = (id: string, overrides: Partial<JobExecution> = {}): JobExecution => ({
  id,
  instanceId: `${id}-instance`,
  jobName: "postgres-perf-job",
  status: "created",
  parameters: { tenant: "acme", id },
  createdAt: new Date("2026-07-19T00:00:00.000Z"),
  ...overrides
});

const createInstance = (id: string): JobInstance => ({
  id: `${id}-instance`,
  jobName: "postgres-perf-job",
  parametersHash: `sha256:${id}`,
  parameters: { tenant: "acme", id },
  createdAt: new Date("2026-07-19T00:00:00.000Z")
});

describe("postgres perf adapter / postgres adapter 성능 기준을 측정한다", () => {
  beforeAll(async () => {
    await assertPostgresAvailable();
    postgresAvailable = true;
    await resetSchema();
    await storage.initialize();
  }, 60_000);

  afterAll(async () => {
    await storage.close();
    if (postgresAvailable) {
      await resetSchema();
    }
    await adminPool.end();
  }, 60_000);

  it("measures single worker storage operations / 단일 worker storage 작업 성능을 측정한다", async () => {
    await seedInstances("perf-create", iterations + warmupIterations);
    await seedExecutions("perf-find", iterations + warmupIterations);
    await seedExecutions("perf-update", iterations + warmupIterations);

    const results = [
      await measure("repository.create", async (index) => {
        await storage.repository.create(createExecution(`perf-create-${index}`));
      }),
      await measure("repository.update", async (index) => {
        await storage.repository.update(
          createExecution(`perf-update-${index}`, {
            status: "completed",
            startedAt: new Date("2026-07-19T00:01:00.000Z"),
            endedAt: new Date("2026-07-19T00:02:00.000Z")
          })
        );
      }),
      await measure("repository.findById", async (index) => {
        const execution = await storage.repository.findById(`perf-find-${index}`);
        expect(execution?.id).toBe(`perf-find-${index}`);
      }),
      await measure("checkpoint.write", async (index) => {
        await storage.checkpointStore.write(`perf-checkpoint-${index}`, "load-users", { cursor: index });
      }),
      await measure("checkpoint.read", async (index) => {
        const checkpoint = await storage.checkpointStore.read<{ readonly cursor: number }>(
          `perf-checkpoint-${index}`,
          "load-users"
        );
        expect(checkpoint?.cursor).toBe(index);
      }),
      await measure("lock.acquire.release", async (index) => {
        const handle = await storage.lockManager.acquire(`perf-lock-${index}`, "worker-1", { ttlMs: 30_000 });
        expect(handle).toMatchObject({ resource: `perf-lock-${index}`, ownerId: "worker-1" });
        await storage.lockManager.release(handle!);
      })
    ];

    expect(results).toHaveLength(6);
    for (const result of results) {
      expect(result.operations).toBe(iterations);
      expect(Number.isFinite(result.durationMs)).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.operationsPerSecond).toBeGreaterThan(0);
    }

    console.table(results.map(formatBenchmarkResult));
  }, 120_000);
});

async function seedExecutions(prefix: string, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const id = `${prefix}-${index}`;
    await storage.repository.createJobInstance(createInstance(id));
    await storage.repository.create(createExecution(id));
  }
}

async function seedInstances(prefix: string, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await storage.repository.createJobInstance(createInstance(`${prefix}-${index}`));
  }
}

async function measure(
  scenario: string,
  operation: (index: number) => Promise<void>
): Promise<BenchmarkResult> {
  for (let index = 0; index < warmupIterations; index += 1) {
    await operation(iterations + index);
  }

  const startedAt = performance.now();

  for (let index = 0; index < iterations; index += 1) {
    await operation(index);
  }

  const durationMs = performance.now() - startedAt;
  return {
    scenario,
    operations: iterations,
    durationMs,
    averageMs: durationMs / iterations,
    operationsPerSecond: (iterations / durationMs) * 1000
  };
}

async function assertPostgresAvailable(): Promise<void> {
  try {
    await adminPool.query("SELECT 1");
  } catch (cause) {
    throw new Error(
      `Postgres perf database is not reachable. Run "docker compose up -d postgres" or set NEST_BATCH_PERF_POSTGRES_URL. Cause: ${formatCause(cause)}`
    );
  }
}

async function resetSchema(): Promise<void> {
  await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
}

function validatePerfSchema(value: string): string {
  const identifier = validateIdentifier(value, "schema");

  if (!identifier.startsWith("batch_perf")) {
    throw new Error("Postgres perf schema must start with batch_perf so cleanup cannot drop shared schemas.");
  }

  return identifier;
}

function validateIdentifier(value: string, optionName: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid Postgres perf ${optionName} identifier.`);
  }

  return value;
}

function quoteIdentifier(value: string): string {
  return `"${value}"`;
}

function readPositiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = readInteger(value, fallback, name);

  if (parsed <= 0) {
    throw new Error(`${name} must be greater than 0.`);
  }

  return parsed;
}

function readNonNegativeInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = readInteger(value, fallback, name);

  if (parsed < 0) {
    throw new Error(`${name} must be greater than or equal to 0.`);
  }

  return parsed;
}

function readInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed) || String(parsed) !== value) {
    throw new Error(`${name} must be a safe integer.`);
  }

  return parsed;
}

function formatBenchmarkResult(result: BenchmarkResult): Record<string, string | number> {
  return {
    scenario: result.scenario,
    operations: result.operations,
    durationMs: Number(result.durationMs.toFixed(2)),
    averageMs: Number(result.averageMs.toFixed(3)),
    operationsPerSecond: Number(result.operationsPerSecond.toFixed(2))
  };
}

function formatCause(cause: unknown): string {
  if (cause instanceof AggregateError) {
    return cause.errors.map(formatCause).join("; ");
  }

  if (cause instanceof Error) {
    const code = "code" in cause ? String(cause.code) : undefined;
    return code ? `${code}: ${cause.message}` : cause.message;
  }

  return String(cause);
}
