import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@rv-nest-batch/core/queue": fromRoot("./packages/core/src/queue/index.ts"),
      "@rv-nest-batch/core/scheduler": fromRoot("./packages/core/src/scheduler/index.ts"),
      "@rv-nest-batch/core/polling": fromRoot("./packages/core/src/polling/index.ts"),
      "@rv-nest-batch/core/worker": fromRoot("./packages/core/src/worker/index.ts"),
      "@rv-nest-batch/core": fromRoot("./packages/core/src/index.ts"),
      "@rv-nest-batch/nest": fromRoot("./packages/nest/src/index.ts"),
      "@rv-nest-batch/inmemory": fromRoot("./packages/inmemory/src/index.ts"),
      "@rv-nest-batch/postgres": fromRoot("./packages/postgres/src/index.ts"),
      "@rv-nest-batch/mysql": fromRoot("./packages/mysql/src/index.ts"),
      "@rv-nest-batch/mariadb": fromRoot("./packages/mariadb/src/index.ts"),
      "@rv-nest-batch/bullmq": fromRoot("./packages/bullmq/src/index.ts"),
      "@rv-nest-batch/cli": fromRoot("./packages/cli/src/index.ts")
    }
  },
  test: {
    reporters: ["verbose"],
    include: ["packages/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "packages/**/*.e2e.test.ts", "packages/**/*.perf.test.ts"]
  }
});
