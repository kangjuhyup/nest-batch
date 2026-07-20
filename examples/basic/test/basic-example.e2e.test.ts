import { DefaultBatchRunner, getReaderCheckpoint, openReader } from "@nest-batch/core";
import type { ChunkReader } from "@nest-batch/core";
import { InMemoryBatchStorage } from "@nest-batch/inmemory";
import { describe, expect, it } from "vitest";
import {
  cursorReaderExample,
  dailyUserImport,
  fileReaderExample,
  functionReaderExample,
  httpReaderExample,
  iterableReaderExample,
  jsonHttpReaderExample,
  jsonlFileReaderExample,
  lineFileReaderExample,
  pageReaderExample,
  sqlReaderExample,
  writtenUsers,
  type ReaderExampleUser
} from "../src/index.js";

describe("basic example e2e / basic example e2e를 검증한다", () => {
  it("runs the exported import job / export된 import job을 실행한다", async () => {
    const storage = new InMemoryBatchStorage();
    const runner = new DefaultBatchRunner(storage, {
      generateExecutionId: () => "basic-example-e2e-execution-1",
      generateOwnerId: () => "basic-example-worker-1",
      now: () => new Date("2026-07-19T00:00:00.000Z")
    });
    writtenUsers.length = 0;

    const execution = await runner.run(dailyUserImport, { tenant: "acme" });

    expect(execution).toMatchObject({
      id: "basic-example-e2e-execution-1",
      jobName: "daily-user-import",
      status: "completed"
    });
    expect(writtenUsers).toEqual([{ id: "user-1" }]);
    await expect(storage.repository.findStepExecutions(execution.id)).resolves.toEqual([
      expect.objectContaining({
        stepName: "import-users",
        status: "completed",
        readCount: 2,
        writeCount: 1,
        skipCount: 1
      })
    ]);
  });

  it("opens exported reader helper examples / export된 reader helper 예제를 연다", async () => {
    await expect(readUserIds(iterableReaderExample)).resolves.toMatchObject({
      ids: ["user-1", "user-2", "user-3", "user-4"],
      checkpoint: undefined
    });
    await expect(readUserIds(functionReaderExample)).resolves.toMatchObject({
      ids: ["user-1", "user-2", "user-3", "user-4"],
      checkpoint: undefined
    });
    await expect(readUserIds(cursorReaderExample)).resolves.toEqual({
      ids: ["user-1", "user-2", "user-3", "user-4"],
      checkpoint: { cursor: "user-4" }
    });
    await expect(readUserIds(pageReaderExample)).resolves.toEqual({
      ids: ["user-1", "user-2", "user-3", "user-4"],
      checkpoint: { page: 2, offset: 0 }
    });
    await expect(readUserIds(sqlReaderExample)).resolves.toEqual({
      ids: ["user-1", "user-2", "user-3", "user-4"],
      checkpoint: { page: 2, offset: 0 }
    });
    await expect(readUserIds(httpReaderExample)).resolves.toEqual({
      ids: ["user-1", "user-2", "user-3", "user-4"],
      checkpoint: { page: 1, offset: 2 }
    });
    await expect(readUserIds(fileReaderExample)).resolves.toEqual({
      ids: ["user-1", "user-2", "user-3", "user-4"],
      checkpoint: { offset: 4 }
    });
    await expect(readUserIds(lineFileReaderExample)).resolves.toEqual({
      ids: ["user-1", "user-2", "user-3", "user-4"],
      checkpoint: { offset: 4 }
    });
    await expect(readUserIds(jsonlFileReaderExample)).resolves.toEqual({
      ids: ["user-1", "user-2", "user-3", "user-4"],
      checkpoint: { offset: 4 }
    });
    await expect(readUserIds(jsonHttpReaderExample)).resolves.toEqual({
      ids: ["user-1", "user-2", "user-3", "user-4"],
      checkpoint: { page: 1, offset: 2 }
    });
  });
});

const readUserIds = async <TCheckpoint>(
  reader: ChunkReader<ReaderExampleUser, TCheckpoint>,
  checkpoint?: TCheckpoint
): Promise<{ readonly ids: readonly string[]; readonly checkpoint: TCheckpoint | undefined }> => {
  const session = await openReader(reader, {
    signal: new AbortController().signal,
    checkpoint
  });
  const ids: string[] = [];

  for await (const user of session) {
    ids.push(user.id);
  }

  return {
    ids,
    checkpoint: await getReaderCheckpoint(session)
  };
};
