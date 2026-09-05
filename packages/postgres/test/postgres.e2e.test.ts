import type { JobExecution, JobInstance } from "@rv-nest-batch/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresBatchStorage } from "../src/index.js";

const { Pool } = pg;

const DEFAULT_POSTGRES_URL = "postgresql://nest_batch:nest_batch@127.0.0.1:15432/nest_batch";
const connectionString =
  process.env.NEST_BATCH_E2E_POSTGRES_URL ?? process.env.NEST_BATCH_POSTGRES_URL ?? DEFAULT_POSTGRES_URL;
const schema = validateE2eSchema(process.env.NEST_BATCH_E2E_POSTGRES_SCHEMA ?? "batch_e2e");
const tablePrefix = validateIdentifier(process.env.NEST_BATCH_E2E_POSTGRES_TABLE_PREFIX ?? "nb_e2e", "table prefix");
const quotedSchema = quoteIdentifier(schema);
const adminPool = new Pool({ connectionString });
const storage = new PostgresBatchStorage({ connectionString, schema, tablePrefix });
let postgresAvailable = false;

const createExecution = (overrides: Partial<JobExecution> = {}): JobExecution => ({
  id: "postgres-e2e-execution-1",
  instanceId: "postgres-e2e-instance-1",
  jobName: "daily-user-import",
  status: "created",
  parameters: { tenant: "acme", run: 1 },
  createdAt: new Date("2026-07-19T00:00:00.000Z"),
  ...overrides
});

const createInstance = (overrides: Partial<JobInstance> = {}): JobInstance => ({
  id: "postgres-e2e-instance-1",
  jobName: "daily-user-import",
  parametersHash: "sha256:e2e-parameters",
  parameters: { tenant: "acme", run: 1 },
  createdAt: new Date("2026-07-19T00:00:00.000Z"),
  ...overrides
});

describe("postgres e2e adapter / postgres e2e adapter를 검증한다", () => {
  beforeAll(async () => {
    await assertPostgresAvailable();
    postgresAvailable = true;
    await resetSchema();
    await storage.initialize();
  }, 30_000);

  afterAll(async () => {
    await storage.close();
    if (postgresAvailable) {
      await resetSchema();
    }
    await adminPool.end();
  }, 30_000);

  it("persists job executions in postgres / postgres에 job execution을 저장하고 조회한다", async () => {
    const instance = createInstance();
    const created = createExecution();
    const completed = createExecution({
      status: "completed",
      startedAt: new Date("2026-07-19T00:01:00.000Z"),
      endedAt: new Date("2026-07-19T00:02:00.000Z")
    });
    const failed = createExecution({
      id: "postgres-e2e-execution-2",
      status: "failed",
      createdAt: new Date("2026-07-19T00:03:00.000Z"),
      startedAt: new Date("2026-07-19T00:04:00.000Z"),
      endedAt: new Date("2026-07-19T00:05:00.000Z"),
      failureReason: "writer unavailable"
    });

    await expect(storage.repository.createJobInstance(instance)).resolves.toEqual(instance);
    await expect(
      storage.repository.findJobInstance(instance.jobName, instance.parametersHash)
    ).resolves.toEqual(instance);

    await storage.repository.create(created);
    await expect(storage.repository.findById(created.id)).resolves.toEqual(created);
    await expect(storage.repository.findActiveJobExecution(instance.id)).resolves.toEqual(created);

    await storage.repository.update(completed);
    await expect(storage.repository.findById(completed.id)).resolves.toEqual(completed);
    await expect(storage.repository.findActiveJobExecution(instance.id)).resolves.toBeUndefined();

    await storage.repository.create(failed);
    await expect(storage.repository.findLatestFailedJobExecution(instance.id)).resolves.toEqual(failed);
  });

  it("upserts and deletes checkpoints in postgres / postgres에서 checkpoint를 갱신하고 삭제한다", async () => {
    await storage.checkpointStore.write("postgres-e2e-execution-1", "load-users", { cursor: 20 });
    await expect(storage.checkpointStore.read("postgres-e2e-execution-1", "load-users")).resolves.toEqual({
      cursor: 20
    });

    await storage.checkpointStore.write("postgres-e2e-execution-1", "load-users", { cursor: 40 });
    await expect(storage.checkpointStore.read("postgres-e2e-execution-1", "load-users")).resolves.toEqual({
      cursor: 40
    });

    await storage.checkpointStore.delete("postgres-e2e-execution-1", "load-users");
    await expect(storage.checkpointStore.read("postgres-e2e-execution-1", "load-users")).resolves.toBeUndefined();
  });

  it("rejects busy locks and recovers stale locks in postgres / postgres에서 lock 충돌과 만료 회수를 처리한다", async () => {
    const resource = "job:postgres-e2e";
    const first = await storage.lockManager.acquire(resource, "worker-1", { ttlMs: 30_000 });

    expect(first).toMatchObject({ resource, ownerId: "worker-1" });
    await expect(storage.lockManager.acquire(resource, "worker-2", { ttlMs: 30_000 })).resolves.toBeUndefined();

    await storage.lockManager.release(first!);
    const second = await storage.lockManager.acquire(resource, "worker-2", { ttlMs: 30_000 });

    expect(second).toMatchObject({ resource, ownerId: "worker-2" });
    await storage.lockManager.release(second!);

    const stale = await storage.lockManager.acquire(resource, "worker-1", { ttlMs: 5 });
    expect(stale).toMatchObject({ resource, ownerId: "worker-1" });

    await wait(100);
    const recovered = await storage.lockManager.acquire(resource, "worker-2", { ttlMs: 30_000 });

    expect(recovered).toMatchObject({ resource, ownerId: "worker-2" });
    await storage.lockManager.release(recovered!);
  });
});

async function assertPostgresAvailable(): Promise<void> {
  try {
    await adminPool.query("SELECT 1");
  } catch (cause) {
    throw new Error(
      `Postgres e2e database is not reachable. Run "docker compose up -d postgres" or set NEST_BATCH_E2E_POSTGRES_URL. Cause: ${formatCause(cause)}`
    );
  }
}

async function resetSchema(): Promise<void> {
  await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
}

function validateE2eSchema(value: string): string {
  const identifier = validateIdentifier(value, "schema");

  if (!identifier.startsWith("batch_e2e")) {
    throw new Error("Postgres e2e schema must start with batch_e2e so cleanup cannot drop shared schemas.");
  }

  return identifier;
}

function validateIdentifier(value: string, optionName: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid Postgres e2e ${optionName} identifier.`);
  }

  return value;
}

function quoteIdentifier(value: string): string {
  return `"${value}"`;
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

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
