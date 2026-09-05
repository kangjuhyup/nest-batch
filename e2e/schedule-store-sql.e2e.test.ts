import { MariaDbScheduleStore } from "@rvkang/batch-mariadb";
import { MySqlScheduleStore } from "@rvkang/batch-mysql";
import { PostgresScheduleStore } from "@rvkang/batch-postgres";
import type {
  ScheduleOccurrence,
  ScheduleOccurrenceCandidate,
  ScheduleStore
} from "@rvkang/batch-core/scheduler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMariaDbE2eDatabase } from "./support/mariadb.js";
import { createMySqlE2eDatabase } from "./support/mysql.js";
import { createPostgresE2eDatabase } from "./support/postgres.js";

interface SqlScheduleStoreE2eCase {
  readonly name: string;
  readonly store: ScheduleStore;
  assertAvailable(): Promise<void>;
  reset(): Promise<void>;
  initialize(): Promise<void>;
  close(): Promise<void>;
  isAvailable(): boolean;
}

const DEFAULT_POSTGRES_URL = "postgresql://nest_batch:nest_batch@127.0.0.1:15432/nest_batch";
const DEFAULT_MYSQL_URL = "mysql://nest_batch:nest_batch@127.0.0.1:13306/nest_batch";
const DEFAULT_MARIADB_URL = "mariadb://nest_batch:nest_batch@127.0.0.1:13307/nest_batch";

const postgresDatabase = createPostgresE2eDatabase({
  label: "Postgres schedule store e2e database",
  urlEnv: "NEST_BATCH_SCHEDULE_STORE_E2E_POSTGRES_URL",
  fallbackUrlEnvs: ["NEST_BATCH_E2E_POSTGRES_URL", "NEST_BATCH_POSTGRES_URL"],
  defaultUrl: DEFAULT_POSTGRES_URL,
  schemaEnv: "NEST_BATCH_SCHEDULE_STORE_E2E_POSTGRES_SCHEMA",
  defaultSchema: "batch_schedule_store_e2e",
  schemaPrefix: "batch_schedule_store_e2e",
  tablePrefixEnv: "NEST_BATCH_SCHEDULE_STORE_E2E_POSTGRES_TABLE_PREFIX",
  defaultTablePrefix: "nb_schedule_store_e2e"
});
const postgresStore = new PostgresScheduleStore({
  connectionString: postgresDatabase.connectionString,
  schema: postgresDatabase.schema,
  tablePrefix: postgresDatabase.tablePrefix
});

const mysqlDatabase = createMySqlE2eDatabase({
  label: "MySQL schedule store e2e database",
  urlEnv: "NEST_BATCH_SCHEDULE_STORE_E2E_MYSQL_URL",
  fallbackUrlEnvs: ["NEST_BATCH_E2E_MYSQL_URL", "NEST_BATCH_MYSQL_URL"],
  defaultUrl: DEFAULT_MYSQL_URL,
  databaseEnv: "NEST_BATCH_SCHEDULE_STORE_E2E_MYSQL_DATABASE",
  defaultDatabase: "nest_batch",
  tablePrefixEnv: "NEST_BATCH_SCHEDULE_STORE_E2E_MYSQL_TABLE_PREFIX",
  defaultTablePrefix: "nb_schedule_store_e2e_mysql",
  tablePrefixPrefix: "nb_schedule_store_e2e"
});
const mysqlStore = new MySqlScheduleStore({
  connectionString: mysqlDatabase.connectionString,
  database: mysqlDatabase.database,
  tablePrefix: mysqlDatabase.tablePrefix,
  poolOptions: { timezone: "Z" }
});

const mariaDbDatabase = createMariaDbE2eDatabase({
  label: "MariaDB schedule store e2e database",
  urlEnv: "NEST_BATCH_SCHEDULE_STORE_E2E_MARIADB_URL",
  fallbackUrlEnvs: ["NEST_BATCH_E2E_MARIADB_URL", "NEST_BATCH_MARIADB_URL"],
  defaultUrl: DEFAULT_MARIADB_URL,
  databaseEnv: "NEST_BATCH_SCHEDULE_STORE_E2E_MARIADB_DATABASE",
  defaultDatabase: "nest_batch",
  tablePrefixEnv: "NEST_BATCH_SCHEDULE_STORE_E2E_MARIADB_TABLE_PREFIX",
  defaultTablePrefix: "nb_schedule_store_e2e_mariadb",
  tablePrefixPrefix: "nb_schedule_store_e2e"
});
const mariaDbStore = new MariaDbScheduleStore({
  connectionString: mariaDbDatabase.connectionString,
  database: mariaDbDatabase.database,
  tablePrefix: mariaDbDatabase.tablePrefix,
  poolOptions: { timezone: "Z" }
});

const cases: readonly SqlScheduleStoreE2eCase[] = [
  {
    name: "Postgres",
    store: postgresStore,
    assertAvailable: () => postgresDatabase.assertAvailable(),
    reset: () => postgresDatabase.resetSchema(),
    initialize: () => postgresStore.initialize(),
    close: () => postgresDatabase.close(),
    isAvailable: () => postgresDatabase.available
  },
  {
    name: "MySQL",
    store: mysqlStore,
    assertAvailable: () => mysqlDatabase.assertAvailable(),
    reset: () => mysqlDatabase.resetTables(),
    initialize: () => mysqlStore.initialize(),
    close: () => mysqlDatabase.close(),
    isAvailable: () => mysqlDatabase.available
  },
  {
    name: "MariaDB",
    store: mariaDbStore,
    assertAvailable: () => mariaDbDatabase.assertAvailable(),
    reset: () => mariaDbDatabase.resetTables(),
    initialize: () => mariaDbStore.initialize(),
    close: () => mariaDbDatabase.close(),
    isAvailable: () => mariaDbDatabase.available
  }
];

describe.each(cases)("$name schedule store e2e / $name schedule store e2e를 검증한다", (testCase) => {
  beforeAll(async () => {
    await testCase.assertAvailable();
    await testCase.reset();
    await testCase.initialize();
  }, 30_000);

  afterAll(async () => {
    if (testCase.isAvailable()) {
      await testCase.reset();
    }
    await testCase.close();
  }, 30_000);

  it("preserves durable occurrence ownership and failure reason / schedule occurrence owner와 failure reason을 durable하게 보존한다", async () => {
    const dispatchedCandidate = createCandidate("billing.daily", "dispatch");
    const firstClaimedAt = new Date("2026-01-01T00:00:01.000Z");
    const duplicateClaimedAt = new Date("2026-01-01T00:00:30.000Z");
    const staleReclaimAt = new Date("2026-01-01T00:02:02.000Z");

    const freshClaim = await testCase.store.claimOccurrence(dispatchedCandidate, {
      ownerId: "scheduler-owner-1",
      claimedAt: firstClaimedAt,
      claimTtlMs: 60_000
    });

    expectOccurrence(freshClaim, {
      occurrenceId: dispatchedCandidate.occurrenceId,
      status: "claimed",
      ownerId: "scheduler-owner-1",
      claimedAt: firstClaimedAt,
      claimExpiresAt: new Date("2026-01-01T00:01:01.000Z")
    });

    await expect(
      testCase.store.claimOccurrence(dispatchedCandidate, {
        ownerId: "scheduler-owner-2",
        claimedAt: duplicateClaimedAt,
        claimTtlMs: 60_000
      })
    ).resolves.toBeUndefined();
    await expect(testCase.store.findLatestOccurrence("billing.daily")).resolves.toMatchObject({
      occurrenceId: dispatchedCandidate.occurrenceId,
      status: "claimed",
      ownerId: "scheduler-owner-1"
    });

    const reclaimed = await testCase.store.claimOccurrence(dispatchedCandidate, {
      ownerId: "scheduler-owner-2",
      claimedAt: staleReclaimAt,
      claimTtlMs: 60_000
    });

    expectOccurrence(reclaimed, {
      occurrenceId: dispatchedCandidate.occurrenceId,
      status: "claimed",
      ownerId: "scheduler-owner-2",
      claimedAt: staleReclaimAt,
      claimExpiresAt: new Date("2026-01-01T00:03:02.000Z")
    });

    if (!reclaimed) {
      throw new Error("Expected stale schedule occurrence to be reclaimed.");
    }

    await expect(
      testCase.store.markDispatched(reclaimed, {
        ownerId: "scheduler-owner-1",
        dispatchedAt: new Date("2026-01-01T00:02:03.000Z")
      })
    ).resolves.toBe(false);
    await expect(testCase.store.findLatestOccurrence("billing.daily")).resolves.toMatchObject({
      occurrenceId: dispatchedCandidate.occurrenceId,
      status: "claimed",
      ownerId: "scheduler-owner-2"
    });

    await expect(
      testCase.store.markDispatched(reclaimed, {
        ownerId: "scheduler-owner-2",
        dispatchedAt: new Date("2026-01-01T00:02:04.000Z")
      })
    ).resolves.toBe(true);
    await expect(testCase.store.findLatestOccurrence("billing.daily")).resolves.toMatchObject({
      occurrenceId: dispatchedCandidate.occurrenceId,
      status: "dispatched",
      ownerId: "scheduler-owner-2",
      dispatchedAt: new Date("2026-01-01T00:02:04.000Z")
    });
    await expect(
      testCase.store.findLatestOccurrence("billing.daily", { statuses: ["failed"] })
    ).resolves.toBeUndefined();

    const failedCandidate = createCandidate("billing.failed", "failed");
    const failedClaim = await testCase.store.claimOccurrence(failedCandidate, {
      ownerId: "scheduler-owner-failed",
      claimedAt: new Date("2026-01-01T00:03:00.000Z"),
      claimTtlMs: 60_000
    });

    if (!failedClaim) {
      throw new Error("Expected failure schedule occurrence to be claimed.");
    }

    await expect(
      testCase.store.markFailed(failedClaim, {
        ownerId: "scheduler-owner-failed",
        failedAt: new Date("2026-01-01T00:03:01.000Z"),
        failureReason: "queue unavailable: ECONNREFUSED"
      })
    ).resolves.toBe(true);
    await expect(testCase.store.findLatestOccurrence("billing.failed")).resolves.toMatchObject({
      occurrenceId: failedCandidate.occurrenceId,
      status: "failed",
      ownerId: "scheduler-owner-failed",
      failedAt: new Date("2026-01-01T00:03:01.000Z"),
      failureReason: "queue unavailable: ECONNREFUSED"
    });
    await expect(
      testCase.store.listOccurrences({
        scheduleName: "billing.failed",
        status: "failed",
        limit: 1
      })
    ).resolves.toMatchObject([
      {
        occurrenceId: failedCandidate.occurrenceId,
        status: "failed",
        failureReason: "queue unavailable: ECONNREFUSED"
      }
    ]);
  });
});

const createCandidate = (
  scheduleName: string,
  suffix: string
): ScheduleOccurrenceCandidate => ({
  scheduleName,
  occurrenceId: `schedule-store-e2e:${scheduleName}:${suffix}`,
  scheduledAt: new Date("2026-01-01T00:00:00.000Z")
});

const expectOccurrence = (
  occurrence: ScheduleOccurrence | undefined,
  expected: Partial<ScheduleOccurrence>
): void => {
  expect(occurrence).toMatchObject(expected);
};
