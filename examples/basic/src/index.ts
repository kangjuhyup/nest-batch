import { defineChunkStep, defineJob, skipItem } from "@nest-batch/core";

interface SourceUser {
  readonly id: string;
  readonly active: boolean;
}

interface ImportedUser {
  readonly id: string;
}

export const writtenUsers: ImportedUser[] = [];

const importUsers = defineChunkStep<SourceUser, ImportedUser>({
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

export const dailyUserImport = defineJob({
  name: "daily-user-import",
  steps: [importUsers]
});
