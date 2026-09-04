import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@nest-batch/core/queue": fromRoot("./packages/core/src/queue/index.ts"),
      "@nest-batch/core/scheduler": fromRoot("./packages/core/src/scheduler/index.ts"),
      "@nest-batch/core/polling": fromRoot("./packages/core/src/polling/index.ts"),
      "@nest-batch/core": fromRoot("./packages/core/src/index.ts"),
      "@nest-batch/nest": fromRoot("./packages/nest/src/index.ts"),
      "@nest-batch/inmemory": fromRoot("./packages/inmemory/src/index.ts"),
      "@nest-batch/postgres": fromRoot("./packages/postgres/src/index.ts"),
      "@nest-batch/mysql": fromRoot("./packages/mysql/src/index.ts"),
      "@nest-batch/mariadb": fromRoot("./packages/mariadb/src/index.ts"),
      "@nest-batch/polling-core": fromRoot("./packages/polling-core/src/index.ts"),
      "@nest-batch/scheduler-core": fromRoot("./packages/scheduler-core/src/index.ts"),
      "@nest-batch/queue-core": fromRoot("./packages/queue-core/src/index.ts"),
      "@nest-batch/queue-bullmq": fromRoot("./packages/queue-bullmq/src/index.ts"),
      "@nest-batch/cli": fromRoot("./packages/cli/src/index.ts")
    }
  },
  test: {
    reporters: ["verbose"],
    include: ["packages/**/*.e2e.test.ts", "e2e/**/*.e2e.test.ts", "examples/*/test/**/*.e2e.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 30_000
  }
});
