import { DefaultBatchRunner, defineChunkStep, defineJob, skipItem } from "@nest-batch/core";
import type { ChunkStepExecutionContext, Processor, Reader, Writer } from "@nest-batch/core";
import { PostgresBatchStorage } from "@nest-batch/postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresE2eDatabase } from "./support/postgres.js";

interface SourceUser {
  readonly id: string;
  readonly active: boolean;
}

interface ImportedUser {
  readonly id: string;
}

const DEFAULT_POSTGRES_URL = "postgresql://nest_batch:nest_batch@127.0.0.1:15432/nest_batch";
const database = createPostgresE2eDatabase({
  label: "Postgres system e2e database",
  urlEnv: "NEST_BATCH_SYSTEM_E2E_POSTGRES_URL",
  fallbackUrlEnvs: ["NEST_BATCH_E2E_POSTGRES_URL", "NEST_BATCH_POSTGRES_URL"],
  defaultUrl: DEFAULT_POSTGRES_URL,
  schemaEnv: "NEST_BATCH_SYSTEM_E2E_POSTGRES_SCHEMA",
  defaultSchema: "batch_system_e2e",
  schemaPrefix: "batch_system_e2e",
  tablePrefixEnv: "NEST_BATCH_SYSTEM_E2E_POSTGRES_TABLE_PREFIX",
  defaultTablePrefix: "nb_system_e2e"
});
const storage = new PostgresBatchStorage({
  connectionString: database.connectionString,
  schema: database.schema,
  tablePrefix: database.tablePrefix
});

describe("default runner postgres e2e / 기본 runner postgres e2e", () => {
  beforeAll(async () => {
    await database.assertAvailable();
    await database.resetSchema();
    await storage.initialize();
  }, 30_000);

  afterAll(async () => {
    await storage.close();
    if (database.available) {
      await database.resetSchema();
    }
    await database.close();
  }, 30_000);

  it("runs a chunk job with durable postgres storage / postgres storage로 chunk job 전체 흐름을 실행한다", async () => {
    const writtenUsers: ImportedUser[] = [];
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "system-e2e-execution-1",
      generateOwnerId: () => "system-e2e-worker-1",
      now: () => new Date("2026-07-19T00:00:00.000Z")
    });
    const job = defineJob({
      name: "system-user-import",
      steps: [
        defineChunkStep<SourceUser, ImportedUser, { readonly readCount: number }>({
          name: "import-users",
          chunkSize: 2,
          reader: new SystemUserReader(),
          processor: new SystemUserProcessor(),
          writer: new SystemUserWriter(writtenUsers),
          checkpoint({ readCount }) {
            return { readCount };
          }
        })
      ]
    });

    const execution = await runner.run(job, { tenant: "acme" });

    expect(execution).toMatchObject({
      id: "system-e2e-execution-1",
      jobName: "system-user-import",
      status: "completed",
      parameters: { tenant: "acme" }
    });
    await expect(storage.repository.findById(execution.id)).resolves.toMatchObject({
      id: execution.id,
      status: "completed"
    });
    await expect(storage.checkpointStore.read(execution.id, "import-users")).resolves.toEqual({
      readCount: 3
    });
    await expect(storage.repository.findStepExecutions(execution.id)).resolves.toEqual([
      expect.objectContaining({
        stepName: "import-users",
        status: "completed",
        readCount: 3,
        writeCount: 2,
        skipCount: 1,
        retryCount: 0
      })
    ]);
    expect(writtenUsers).toEqual([{ id: "user-1" }, { id: "user-3" }]);
  });
});

class SystemUserReader implements Reader<SourceUser> {
  async *read({ signal }: ChunkStepExecutionContext): AsyncIterable<SourceUser> {
    signal.throwIfAborted();
    yield { id: "user-1", active: true };
    yield { id: "user-2", active: false };
    yield { id: "user-3", active: true };
  }
}

class SystemUserProcessor implements Processor<SourceUser, ImportedUser> {
  process(user: SourceUser) {
    if (!user.active) {
      return skipItem("inactive user");
    }

    return { id: user.id };
  }
}

class SystemUserWriter implements Writer<ImportedUser> {
  constructor(private readonly writtenUsers: ImportedUser[]) {}

  write(users: readonly ImportedUser[]) {
    this.writtenUsers.push(...users);
  }
}
