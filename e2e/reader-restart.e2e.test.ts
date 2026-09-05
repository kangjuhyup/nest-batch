import { DefaultBatchRunner, defineChunkStep, defineJob } from "@rvkang/batch-core";
import type {
  ChunkReader,
  FileReaderDefinition,
  HttpReaderDefinition,
  SqlReaderDefinition
} from "@rvkang/batch-core";
import { InMemoryBatchStorage } from "@rvkang/batch-inmemory";
import { describe, expect, it } from "vitest";

interface SourceUser {
  readonly id: string;
}

interface PageCheckpoint {
  readonly page: number;
  readonly offset?: number;
}

interface HttpCheckpoint {
  readonly page?: number;
  readonly offset?: number;
}

interface FileCheckpoint {
  readonly offset?: number;
}

const users: readonly SourceUser[] = [
  { id: "user-1" },
  { id: "user-2" },
  { id: "user-3" },
  { id: "user-4" }
];

describe("reader restart e2e / reader restart e2e를 검증한다", () => {
  it("restarts SQL readers after writer failure / writer 실패 후 SQL reader를 재시작한다", async () => {
    const reader: SqlReaderDefinition<SourceUser, PageCheckpoint> = {
      kind: "sql",
      pageSize: 2,
      query({ offset, pageSize, signal }) {
        signal.throwIfAborted();

        return users.slice(offset, offset + pageSize);
      }
    };

    await expectRestartFromCheckpoint(
      "sql-reader-restart",
      reader,
      { page: 1, offset: 0 },
      { page: 2, offset: 0 }
    );
  });

  it("restarts HTTP readers after writer failure / writer 실패 후 HTTP reader를 재시작한다", async () => {
    const reader: HttpReaderDefinition<SourceUser, number, HttpCheckpoint> = {
      kind: "http",
      pageSize: 2,
      initialPage: 0,
      request({ page = 0, pageSize, signal }) {
        signal.throwIfAborted();
        const start = page * pageSize;
        const items = users.slice(start, start + pageSize);
        const nextPage = start + pageSize < users.length ? page + 1 : undefined;

        return nextPage === undefined ? { items } : { items, nextPage };
      }
    };

    await expectRestartFromCheckpoint(
      "http-reader-restart",
      reader,
      { page: 1, offset: 0 },
      { page: 1, offset: 2 }
    );
  });

  it("restarts file readers after writer failure / writer 실패 후 file reader를 재시작한다", async () => {
    const reader: FileReaderDefinition<SourceUser, FileCheckpoint> = {
      kind: "file",
      async *open({ signal }) {
        for (const user of users) {
          signal.throwIfAborted();
          yield user;
        }
      }
    };

    await expectRestartFromCheckpoint(
      "file-reader-restart",
      reader,
      { offset: 2 },
      { offset: 4 }
    );
  });
});

const expectRestartFromCheckpoint = async <TCheckpoint>(
  jobName: string,
  reader: ChunkReader<SourceUser, TCheckpoint>,
  expectedFailedCheckpoint: TCheckpoint,
  expectedRestartCheckpoint: TCheckpoint
): Promise<void> => {
  const storage = new InMemoryBatchStorage();
  const executionIds = [`${jobName}-failed`, `${jobName}-restart`];
  let executionIndex = 0;
  let writeCalls = 0;
  const writtenUserIds: string[] = [];
  const runner = new DefaultBatchRunner(storage, {
    generateExecutionId: () => executionIds[executionIndex++]!,
    generateStepExecutionId: ({ jobExecutionId, stepName }) => `${jobExecutionId}:${stepName}`,
    generateOwnerId: () => `${jobName}-worker`,
    now: () => new Date("2026-07-20T00:00:00.000Z")
  });
  const job = defineJob({
    name: jobName,
    steps: [
      defineChunkStep<SourceUser, SourceUser, TCheckpoint>({
        name: "copy-users",
        chunkSize: 2,
        reader,
        writer: {
          write(items) {
            writeCalls += 1;

            if (writeCalls === 2) {
              throw new Error("writer unavailable");
            }

            writtenUserIds.push(...items.map((item) => item.id));
          }
        }
      })
    ]
  });
  const parameters = { tenant: "acme" };

  const failed = await runner.run(job, parameters);
  const restarted = await runner.run(job, parameters, { restart: true });

  expect(failed).toMatchObject({
    id: `${jobName}-failed`,
    status: "failed",
    failureReason: "writer unavailable"
  });
  await expect(storage.checkpointStore.read(failed.id, "copy-users")).resolves.toEqual(
    expectedFailedCheckpoint
  );
  expect(restarted).toMatchObject({
    id: `${jobName}-restart`,
    status: "completed"
  });
  await expect(storage.checkpointStore.read(restarted.id, "copy-users")).resolves.toEqual(
    expectedRestartCheckpoint
  );
  await expect(storage.repository.findStepExecutions(failed.id)).resolves.toEqual([
    expect.objectContaining({
      stepName: "copy-users",
      status: "failed",
      failureReason: "writer unavailable"
    })
  ]);
  await expect(storage.repository.findStepExecutions(restarted.id)).resolves.toEqual([
    expect.objectContaining({
      stepName: "copy-users",
      status: "completed",
      readCount: 2,
      writeCount: 2
    })
  ]);
  expect(writtenUserIds).toEqual(["user-1", "user-2", "user-3", "user-4"]);
};
