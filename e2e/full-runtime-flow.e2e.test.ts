import { runCli } from "@nest-batch/cli";
import {
  DatabaseBatchStorage,
  DefaultBatchRunner,
  defineChunkStep,
  defineJob,
  defineStep,
  skipItem
} from "@nest-batch/core";
import type { BatchEvent, ChunkStepExecutionContext } from "@nest-batch/core";
import { InMemoryBatchStorage } from "@nest-batch/inmemory";
import { MariaDbBatchStorage } from "@nest-batch/mariadb";
import { MySqlBatchStorage } from "@nest-batch/mysql";
import { PostgresBatchStorage } from "@nest-batch/postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMariaDbE2eDatabase } from "./support/mariadb.js";
import { createMySqlE2eDatabase } from "./support/mysql.js";
import { createPostgresE2eDatabase } from "./support/postgres.js";

interface SourceUser {
  readonly id: string;
  readonly active: boolean;
}

interface ImportedUser {
  readonly id: string;
}

interface UserCheckpoint {
  readonly cursor: number;
}

interface FullFlowStorageCase {
  readonly label: string;
  createStorage(): DatabaseBatchStorage;
  setup(storage: DatabaseBatchStorage): Promise<void>;
  cleanup(storage: DatabaseBatchStorage): Promise<void>;
}

const DEFAULT_POSTGRES_URL = "postgresql://nest_batch:nest_batch@127.0.0.1:15432/nest_batch";
const DEFAULT_MYSQL_URL = "mysql://nest_batch:nest_batch@127.0.0.1:13306/nest_batch";
const DEFAULT_MARIADB_URL = "mariadb://nest_batch:nest_batch@127.0.0.1:13307/nest_batch";

const postgresDatabase = createPostgresE2eDatabase({
  label: "Postgres full flow e2e database",
  urlEnv: "NEST_BATCH_FULL_E2E_POSTGRES_URL",
  fallbackUrlEnvs: ["NEST_BATCH_SYSTEM_E2E_POSTGRES_URL", "NEST_BATCH_E2E_POSTGRES_URL", "NEST_BATCH_POSTGRES_URL"],
  defaultUrl: DEFAULT_POSTGRES_URL,
  schemaEnv: "NEST_BATCH_FULL_E2E_POSTGRES_SCHEMA",
  defaultSchema: "batch_full_e2e",
  schemaPrefix: "batch_full_e2e",
  tablePrefixEnv: "NEST_BATCH_FULL_E2E_POSTGRES_TABLE_PREFIX",
  defaultTablePrefix: "nb_full_e2e"
});
const mysqlDatabase = createMySqlE2eDatabase({
  label: "MySQL full flow e2e database",
  urlEnv: "NEST_BATCH_FULL_E2E_MYSQL_URL",
  fallbackUrlEnvs: ["NEST_BATCH_E2E_MYSQL_URL", "NEST_BATCH_MYSQL_URL"],
  defaultUrl: DEFAULT_MYSQL_URL,
  databaseEnv: "NEST_BATCH_FULL_E2E_MYSQL_DATABASE",
  defaultDatabase: "nest_batch",
  tablePrefixEnv: "NEST_BATCH_FULL_E2E_MYSQL_TABLE_PREFIX",
  defaultTablePrefix: "nb_full_e2e_mysql",
  tablePrefixPrefix: "nb_full_e2e"
});
const mariaDbDatabase = createMariaDbE2eDatabase({
  label: "MariaDB full flow e2e database",
  urlEnv: "NEST_BATCH_FULL_E2E_MARIADB_URL",
  fallbackUrlEnvs: ["NEST_BATCH_E2E_MARIADB_URL", "NEST_BATCH_MARIADB_URL"],
  defaultUrl: DEFAULT_MARIADB_URL,
  databaseEnv: "NEST_BATCH_FULL_E2E_MARIADB_DATABASE",
  defaultDatabase: "nest_batch",
  tablePrefixEnv: "NEST_BATCH_FULL_E2E_MARIADB_TABLE_PREFIX",
  defaultTablePrefix: "nb_full_e2e_mariadb",
  tablePrefixPrefix: "nb_full_e2e"
});

const storageCases: readonly FullFlowStorageCase[] = [
  {
    label: "in-memory",
    createStorage: () => new InMemoryBatchStorage(),
    async setup(storage) {
      await storage.initialize();
    },
    async cleanup(storage) {
      await storage.close();
    }
  },
  {
    label: "postgres",
    createStorage: () =>
      new PostgresBatchStorage({
        connectionString: postgresDatabase.connectionString,
        schema: postgresDatabase.schema,
        tablePrefix: postgresDatabase.tablePrefix
      }),
    async setup(storage) {
      await postgresDatabase.assertAvailable();
      await postgresDatabase.resetSchema();
      await storage.initialize();
    },
    async cleanup(storage) {
      await storage.close();
      if (postgresDatabase.available) {
        await postgresDatabase.resetSchema();
      }
      await postgresDatabase.close();
    }
  },
  {
    label: "mysql",
    createStorage: () =>
      new MySqlBatchStorage({
        connectionString: mysqlDatabase.connectionString,
        database: mysqlDatabase.database,
        tablePrefix: mysqlDatabase.tablePrefix
      }),
    async setup(storage) {
      await mysqlDatabase.assertAvailable();
      await mysqlDatabase.resetTables();
      await storage.initialize();
    },
    async cleanup(storage) {
      await storage.close();
      if (mysqlDatabase.available) {
        await mysqlDatabase.resetTables();
      }
      await mysqlDatabase.close();
    }
  },
  {
    label: "mariadb",
    createStorage: () =>
      new MariaDbBatchStorage({
        connectionString: mariaDbDatabase.connectionString,
        database: mariaDbDatabase.database,
        tablePrefix: mariaDbDatabase.tablePrefix
      }),
    async setup(storage) {
      await mariaDbDatabase.assertAvailable();
      await mariaDbDatabase.resetTables();
      await storage.initialize();
    },
    async cleanup(storage) {
      await storage.close();
      if (mariaDbDatabase.available) {
        await mariaDbDatabase.resetTables();
      }
      await mariaDbDatabase.close();
    }
  }
];

describe.each(storageCases)("full runtime flow e2e with $label / $label 전체 runtime 흐름 e2e", (storageCase) => {
  let storage: DatabaseBatchStorage;

  beforeAll(async () => {
    storage = storageCase.createStorage();
    await storageCase.setup(storage);
  }, 30_000);

  afterAll(async () => {
    await storageCase.cleanup(storage);
  }, 30_000);

  it("runs, restarts, observes, and inspects a job through the CLI / CLI로 실행, 재시작, 관측, 상태 조회를 검증한다", async () => {
    const events: BatchEvent["type"][] = [];
    const writtenUsers: ImportedUser[] = [];
    const sourceUsers: readonly SourceUser[] = [
      { id: "user-1", active: true },
      { id: "inactive-user", active: false },
      { id: "invalid-user", active: true },
      { id: "retry-user", active: true },
      { id: "user-2", active: true }
    ];
    let prepareRuns = 0;
    let processorFailures = 0;
    let skipPolicyCalls = 0;
    let writerCalls = 0;
    let writerFailures = 0;
    const runner = new DefaultBatchRunner(storage, {
      generateOwnerId: () => "full-flow-worker",
      now: () => new Date("2026-07-20T00:00:00.000Z"),
      observer: {
        onBatchEvent(event) {
          events.push(event.type);
        }
      }
    });
    const job = defineJob({
      name: "full-feature-user-import",
      steps: [
        defineStep({
          name: "prepare-import",
          execute() {
            prepareRuns += 1;
            return { prepared: true };
          }
        }),
        defineChunkStep<SourceUser, ImportedUser, UserCheckpoint>({
          name: "copy-users",
          chunkSize: 2,
          reader: {
            async *read({ checkpoint, signal }: ChunkStepExecutionContext<UserCheckpoint>) {
              const start = checkpoint?.cursor ?? 0;

              for (let index = start; index < sourceUsers.length; index += 1) {
                signal.throwIfAborted();
                yield sourceUsers[index]!;
              }
            }
          },
          processor: {
            process(user) {
              if (!user.active) {
                return skipItem("inactive user");
              }

              if (user.id === "invalid-user") {
                throw new Error("invalid user");
              }

              if (user.id === "retry-user" && processorFailures === 0) {
                processorFailures += 1;
                throw new Error("temporary processor failure");
              }

              return { id: user.id };
            }
          },
          writer: {
            write(users) {
              writerCalls += 1;

              if (writerCalls === 2 && writerFailures === 0) {
                writerFailures += 1;
                throw new Error("writer unavailable");
              }

              writtenUsers.push(...users);
            }
          },
          checkpoint({ checkpoint, readCount }) {
            return { cursor: (checkpoint?.cursor ?? 0) + readCount };
          },
          retryPolicy: {
            canRetry({ attempt, error, phase }) {
              return (
                phase === "process" &&
                attempt < 2 &&
                error instanceof Error &&
                error.message === "temporary processor failure"
              );
            }
          },
          skipPolicy: {
            canSkip({ error }) {
              if (error instanceof Error && error.message === "invalid user") {
                skipPolicyCalls += 1;
                return true;
              }

              return false;
            }
          }
        })
      ]
    });
    const cliContext = { storage, jobs: [job], runner };

    const listResult = await runCli(["list"], cliContext);
    const failedResult = await runCli(
      [
        "run",
        "--job",
        "full-feature-user-import",
        "--parameters",
        '{"tenant":"acme","run":1}',
        "--execution-id",
        "full-flow-failed"
      ],
      cliContext
    );
    const retriedResult = await runCli(
      [
        "retry",
        "--job",
        "full-feature-user-import",
        "--parameters",
        '{"tenant":"acme","run":1}',
        "--execution-id",
        "full-flow-retry"
      ],
      cliContext
    );
    const statusResult = await runCli(
      ["status", "--execution-id", "full-flow-retry"],
      cliContext
    );

    expect(listResult.exitCode).toBe(0);
    expect(parseCliOutput(listResult.output)).toEqual({
      jobs: ["full-feature-user-import"]
    });
    expect(failedResult.exitCode).toBe(1);
    expect(parseCliOutput(failedResult.output)).toMatchObject({
      command: "run",
      execution: {
        id: "full-flow-failed",
        status: "failed",
        failureReason: "writer unavailable"
      },
      steps: [
        { stepName: "prepare-import", status: "completed" },
        { stepName: "copy-users", status: "failed" }
      ]
    });
    expect(retriedResult.exitCode).toBe(0);
    expect(parseCliOutput(retriedResult.output)).toMatchObject({
      command: "retry",
      execution: {
        id: "full-flow-retry",
        status: "completed"
      },
      steps: [
        { stepName: "prepare-import", status: "completed" },
        {
          stepName: "copy-users",
          status: "completed",
          readCount: 1,
          writeCount: 1,
          skipCount: 0,
          retryCount: 0
        }
      ]
    });
    expect(parseCliOutput(statusResult.output)).toMatchObject({
      command: "status",
      execution: {
        id: "full-flow-retry",
        status: "completed"
      }
    });
    expect(statusResult.exitCode).toBe(0);
    expect(prepareRuns).toBe(1);
    expect(processorFailures).toBe(1);
    expect(skipPolicyCalls).toBe(1);
    expect(writerFailures).toBe(1);
    expect(writtenUsers).toEqual([{ id: "user-1" }, { id: "retry-user" }, { id: "user-2" }]);
    await expect(storage.checkpointStore.read("full-flow-failed", "copy-users")).resolves.toEqual({
      cursor: 4
    });
    await expect(storage.checkpointStore.read("full-flow-retry", "copy-users")).resolves.toEqual({
      cursor: 5
    });
    expect(events).toEqual([
      "job.started",
      "step.started",
      "step.completed",
      "step.started",
      "item.skipped",
      "item.skipped",
      "retry",
      "chunk.written",
      "step.failed",
      "job.failed",
      "job.started",
      "step.completed",
      "step.started",
      "chunk.written",
      "step.completed",
      "job.completed"
    ]);
  });

  it("recovers stale running partitions / 오래된 running partition을 회수한다", async () => {
    const heartbeatAt = new Date("2026-07-20T00:00:00.000Z");
    const claimedAt = new Date("2026-07-20T00:01:00.000Z");
    const stepExecutionId = `stale-partition-step-${storageCase.label}`;
    const partitionId = `${stepExecutionId}:partition:000001`;

    await storage.repository.createPartitionExecution({
      id: partitionId,
      stepExecutionId,
      stepName: "partitioned-import",
      status: "running",
      partition: { shard: 0 },
      ownerId: "dead-worker",
      heartbeatAt,
      startedAt: heartbeatAt,
      readCount: 0,
      writeCount: 0,
      skipCount: 0,
      retryCount: 0,
      createdAt: heartbeatAt
    });

    const claimed = await storage.repository.claimPartitionExecution({
      stepExecutionId,
      ownerId: "worker-2",
      staleAfterMs: 30_000,
      now: claimedAt
    });

    expect(claimed).toMatchObject({
      id: partitionId,
      status: "running",
      ownerId: "worker-2",
      heartbeatAt: claimedAt,
      claimExpiresAt: new Date("2026-07-20T00:01:30.000Z")
    });

    if (!claimed) {
      throw new Error("Expected stale partition to be claimed.");
    }

    await expect(
      storage.repository.completePartitionExecution(
        {
          ...claimed,
          status: "completed",
          endedAt: new Date("2026-07-20T00:02:00.000Z")
        },
        "dead-worker"
      )
    ).resolves.toBe(false);
    await expect(
      storage.repository.completePartitionExecution(
        {
          ...claimed,
          status: "completed",
          endedAt: new Date("2026-07-20T00:02:00.000Z")
        },
        "worker-2"
      )
    ).resolves.toBe(true);
  });
});

const parseCliOutput = (output: string): unknown => JSON.parse(output) as unknown;
