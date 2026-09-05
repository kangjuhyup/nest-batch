export const PUBLIC_PACKAGE_SCOPE = "@rvkang";

export const PUBLIC_PACKAGES = [
  { name: `${PUBLIC_PACKAGE_SCOPE}/batch-core`, directory: "packages/core" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/batch-nest`, directory: "packages/nest" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/batch-inmemory`, directory: "packages/inmemory" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/batch-postgres`, directory: "packages/postgres" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/batch-mysql`, directory: "packages/mysql" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/batch-mariadb`, directory: "packages/mariadb" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/batch-bullmq`, directory: "packages/bullmq" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/batch-cli`, directory: "packages/cli" }
];

export const CORE_SUBPATHS = ["queue", "scheduler", "polling", "worker"];
export const REPOSITORY_URL = "https://github.com/kangjuhyup/nest-batch.git";
export const NPM_REGISTRY_URL = "https://registry.npmjs.org/";
export const NPM_SCOPE_REGISTRY_ARGUMENT = `--${PUBLIC_PACKAGE_SCOPE}:registry=${NPM_REGISTRY_URL}`;
