import { defineChunkStep, skipItem } from "@nest-batch/core";
import type { ImportedUser, SourceUser } from "./import-users.types.js";

export const writtenUsers: ImportedUser[] = [];

export const importUsersStep = defineChunkStep<SourceUser, ImportedUser>({
  name: "import-users",
  chunkSize: 100,
  reader: async function* ({ signal }) {
    signal.throwIfAborted();
    yield { id: "user-1", active: true };
    yield { id: "user-2", active: false };
  },
  processor(user) {
    if (!user.active) {
      return skipItem("inactive user");
    }

    return { id: user.id };
  },
  writer(users) {
    writtenUsers.push(...users);
  }
});
