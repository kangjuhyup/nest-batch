export const PUBLIC_PACKAGE_SCOPE = "@rv-nest-batch";

export const PUBLIC_PACKAGES = [
  { name: `${PUBLIC_PACKAGE_SCOPE}/core`, directory: "packages/core" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/nest`, directory: "packages/nest" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/inmemory`, directory: "packages/inmemory" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/postgres`, directory: "packages/postgres" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/mysql`, directory: "packages/mysql" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/mariadb`, directory: "packages/mariadb" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/bullmq`, directory: "packages/bullmq" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/cli`, directory: "packages/cli" }
];

export const CORE_SUBPATHS = ["queue", "scheduler", "polling", "worker"];
export const REPOSITORY_URL = "https://github.com/kangjuhyup/nest-batch.git";
export const NPM_REGISTRY_URL = "https://registry.npmjs.org/";
export const NPM_SCOPE_REGISTRY_ARGUMENT = `--${PUBLIC_PACKAGE_SCOPE}:registry=${NPM_REGISTRY_URL}`;
