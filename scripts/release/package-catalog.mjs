export const PUBLIC_PACKAGES = [
  { name: "@nest-batch/core", directory: "packages/core" },
  { name: "@nest-batch/nest", directory: "packages/nest" },
  { name: "@nest-batch/inmemory", directory: "packages/inmemory" },
  { name: "@nest-batch/postgres", directory: "packages/postgres" },
  { name: "@nest-batch/mysql", directory: "packages/mysql" },
  { name: "@nest-batch/mariadb", directory: "packages/mariadb" },
  { name: "@nest-batch/bullmq", directory: "packages/bullmq" },
  { name: "@nest-batch/cli", directory: "packages/cli" }
];

export const CORE_SUBPATHS = ["queue", "scheduler", "polling", "worker"];
export const REPOSITORY_URL = "https://github.com/kangjuhyup/nest-batch.git";
export const NPM_REGISTRY_URL = "https://registry.npmjs.org/";
export const NPM_SCOPE_REGISTRY_ARGUMENT = `--@nest-batch:registry=${NPM_REGISTRY_URL}`;
