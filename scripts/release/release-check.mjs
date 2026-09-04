import { rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commandForPlatform, runCommand } from "./command-runner.mjs";
import { PUBLIC_PACKAGES } from "./package-catalog.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RELEASE_CHECK_SCRIPTS = ["typecheck", "test", "build", "release:verify", "release:smoke"];

export const publicBuildInfoDirectories = (root = REPOSITORY_ROOT) => {
  const repositoryRoot = resolve(root);

  return PUBLIC_PACKAGES.map((packageInfo) => {
    const packageDirectory = resolve(repositoryRoot, packageInfo.directory);
    const buildInfoDirectory = resolve(packageDirectory, ".tsbuildinfo");
    const pathFromPackage = relative(packageDirectory, buildInfoDirectory);

    if (pathFromPackage !== ".tsbuildinfo" || isAbsolute(pathFromPackage)) {
      throw new Error(`${packageInfo.directory}: invalid build metadata cleanup target.`);
    }

    return buildInfoDirectory;
  });
};

export const cleanupPublicBuildInfo = async (root = REPOSITORY_ROOT) => {
  for (const directory of publicBuildInfoDirectories(root)) {
    await rm(directory, { recursive: true, force: true });
  }
};

export const runReleaseCheck = async ({ repositoryRoot = REPOSITORY_ROOT, run = runCommand } = {}) => {
  const root = resolve(repositoryRoot);

  try {
    for (const script of RELEASE_CHECK_SCRIPTS) {
      await run(commandForPlatform("pnpm"), [script], { cwd: root });
    }
  } finally {
    await cleanupPublicBuildInfo(root);
  }
};

const isDirectExecution = () =>
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution()) {
  try {
    await runReleaseCheck();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
