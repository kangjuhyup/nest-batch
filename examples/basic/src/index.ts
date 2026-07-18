import { defineJob, defineStep } from "@nest-batch/core";

const loadUsers = defineStep({
  name: "load-users",
  async execute({ signal }) {
    signal.throwIfAborted();
    return ["user-1", "user-2"];
  }
});

export const dailyUserImport = defineJob({
  name: "daily-user-import",
  steps: [loadUsers]
});
