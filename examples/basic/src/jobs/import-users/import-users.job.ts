import { defineJob } from "@nest-batch/core";
import { importUsersStep } from "./import-users.step.js";

export const dailyUserImport = defineJob({
  name: "daily-user-import",
  steps: [importUsersStep]
});
