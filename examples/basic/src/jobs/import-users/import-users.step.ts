import { defineChunkStep, skipItem } from "@nest-batch/core";
import type { ChunkStepExecutionContext, Processor, Reader, Writer } from "@nest-batch/core";
import type { ImportedUser, SourceUser } from "./import-users.types.js";

export const writtenUsers: ImportedUser[] = [];

export class ImportUsersReader implements Reader<SourceUser> {
  async *read({ signal }: ChunkStepExecutionContext): AsyncIterable<SourceUser> {
    signal.throwIfAborted();
    yield { id: "user-1", active: true };
    yield { id: "user-2", active: false };
  }
}

export class ImportUsersProcessor implements Processor<SourceUser, ImportedUser> {
  process(user: SourceUser) {
    if (!user.active) {
      return skipItem("inactive user");
    }

    return { id: user.id };
  }
}

export class ImportUsersWriter implements Writer<ImportedUser> {
  write(users: readonly ImportedUser[]) {
    writtenUsers.push(...users);
  }
}

export const importUsersStep = defineChunkStep<SourceUser, ImportedUser>({
  name: "import-users",
  chunkSize: 100,
  reader: new ImportUsersReader(),
  processor: new ImportUsersProcessor(),
  writer: new ImportUsersWriter()
});
