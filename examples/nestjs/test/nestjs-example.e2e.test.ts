import "reflect-metadata";
import {
  getReaderCheckpoint,
  openReader
} from "@nest-batch/core";
import type { ChunkReader } from "@nest-batch/core";
import { NestFactory } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { NestBatchRegistry, NestBatchRunner } from "@nest-batch/nest";
import { AppModule } from "../src/app.module.js";
import { writtenCharges } from "../src/jobs/billing/billing.step.js";
import {
  CursorReaderExample,
  FileReaderExample,
  FunctionReaderExample,
  HttpReaderExample,
  IterableReaderExample,
  PageReaderExample,
  SqlReaderExample,
  type ReaderExampleUser
} from "../src/jobs/reader-examples/reader-examples.reader.js";

describe("nestjs example e2e / nestjs example e2e를 검증한다", () => {
  it("boots the app context and runs the billing job / app context를 부팅하고 billing job을 실행한다", async () => {
    const executionId = "nestjs-example-e2e-execution-1";
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    writtenCharges.length = 0;

    try {
      expect(app.get(NestBatchRegistry).getJob("daily-billing")).toBeDefined();
      const execution = await app.get(NestBatchRunner).run(
        "daily-billing",
        { tenant: "acme", run: executionId },
        { executionId, ownerId: "nestjs-example-worker-1" }
      );

      expect(execution).toMatchObject({
        id: executionId,
        jobName: "daily-billing",
        status: "completed"
      });
      expect(writtenCharges).toEqual([{ tenant: "acme", accountId: "acme-account-1", amount: 1200 }]);
    } finally {
      await app.close();
    }
  });

  it("opens Nest reader helper providers / Nest reader helper provider를 연다", async () => {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

    try {
      await expect(readUserIds(app.get(IterableReaderExample))).resolves.toMatchObject({
        ids: ["user-1", "user-2", "user-3", "user-4"],
        checkpoint: undefined
      });
      await expect(readUserIds(app.get(FunctionReaderExample))).resolves.toMatchObject({
        ids: ["user-1", "user-2", "user-3", "user-4"],
        checkpoint: undefined
      });
      await expect(readUserIds(app.get(CursorReaderExample))).resolves.toEqual({
        ids: ["user-1", "user-2", "user-3", "user-4"],
        checkpoint: { cursor: "user-4" }
      });
      await expect(readUserIds(app.get(PageReaderExample))).resolves.toEqual({
        ids: ["user-1", "user-2", "user-3", "user-4"],
        checkpoint: { page: 2, offset: 0 }
      });
      await expect(readUserIds(app.get(SqlReaderExample))).resolves.toEqual({
        ids: ["user-1", "user-2", "user-3", "user-4"],
        checkpoint: { page: 2, offset: 0 }
      });
      await expect(readUserIds(app.get(HttpReaderExample))).resolves.toEqual({
        ids: ["user-1", "user-2", "user-3", "user-4"],
        checkpoint: { page: 1, offset: 2 }
      });
      await expect(readUserIds(app.get(FileReaderExample))).resolves.toEqual({
        ids: ["user-1", "user-2", "user-3", "user-4"],
        checkpoint: { offset: 4 }
      });
    } finally {
      await app.close();
    }
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
