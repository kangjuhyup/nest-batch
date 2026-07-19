import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

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
    include: ["packages/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "packages/**/*.e2e.test.ts", "packages/**/*.perf.test.ts"]
  }
});
