import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@rvkang/batch-core/queue": fromRoot("./packages/core/src/queue/index.ts"),
      "@rvkang/batch-core/scheduler": fromRoot("./packages/core/src/scheduler/index.ts"),
      "@rvkang/batch-core/polling": fromRoot("./packages/core/src/polling/index.ts"),
      "@rvkang/batch-core/worker": fromRoot("./packages/core/src/worker/index.ts"),
      "@rvkang/batch-core": fromRoot("./packages/core/src/index.ts"),
      "@rvkang/batch-nest": fromRoot("./packages/nest/src/index.ts"),
      "@rvkang/batch-inmemory": fromRoot("./packages/inmemory/src/index.ts"),
      "@rvkang/batch-postgres": fromRoot("./packages/postgres/src/index.ts"),
      "@rvkang/batch-mysql": fromRoot("./packages/mysql/src/index.ts"),
      "@rvkang/batch-mariadb": fromRoot("./packages/mariadb/src/index.ts"),
      "@rvkang/batch-bullmq": fromRoot("./packages/bullmq/src/index.ts"),
      "@rvkang/batch-cli": fromRoot("./packages/cli/src/index.ts")
    }
  },
  test: {
    reporters: ["verbose"],
    include: ["packages/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "packages/**/*.e2e.test.ts", "packages/**/*.perf.test.ts"]
  }
});
