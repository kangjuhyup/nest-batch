import { defineChunkStep, skipItem } from "@nest-batch/core";
import type { ChunkProcessor, ChunkReader, ChunkWriter } from "@nest-batch/core";
import type { ImportedUser, SourceUser } from "./import-users.types.js";

export const writtenUsers: ImportedUser[] = [];

const importUsersReader: ChunkReader<SourceUser> = async function* ({ signal }) {
  signal.throwIfAborted();
  yield { id: "user-1", active: true };
  yield { id: "user-2", active: false };
};

const importUsersProcessor: ChunkProcessor<SourceUser, ImportedUser> = (user) => {
  if (!user.active) {
    return skipItem("inactive user");
  }

  return { id: user.id };
};

const importUsersWriter: ChunkWriter<ImportedUser> = (users) => {
  writtenUsers.push(...users);
};

export const importUsersStep = defineChunkStep<SourceUser, ImportedUser>({
  name: "import-users",
  chunkSize: 100,
  reader: importUsersReader,
  processor: importUsersProcessor,
  writer: importUsersWriter
});
