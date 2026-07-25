import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@nest-batch/core": fromRoot("./packages/core/src/index.ts"),
      "@nest-batch/nest": fromRoot("./packages/nest/src/index.ts"),
      "@nest-batch/inmemory": fromRoot("./packages/inmemory/src/index.ts"),
      "@nest-batch/postgres": fromRoot("./packages/postgres/src/index.ts"),
      "@nest-batch/mysql": fromRoot("./packages/mysql/src/index.ts"),
      "@nest-batch/mariadb": fromRoot("./packages/mariadb/src/index.ts"),
      "@nest-batch/cli": fromRoot("./packages/cli/src/index.ts")
    }
  },
  test: {
    reporters: ["verbose"],
    include: ["packages/**/*.perf.test.ts"],
    hookTimeout: 60_000,
    testTimeout: 180_000
  }
});
