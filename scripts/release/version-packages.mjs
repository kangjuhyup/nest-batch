import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localBinaryForPlatform, runCommandInherited } from "./command-runner.mjs";
import { syncRootVersion } from "./sync-root-version.mjs";

const CHANGESET_DIRECTORY = ".changeset";
const CHANGESET_README = "README.md";

export const hasPendingChangesets = async (root) => {
  try {
    const entries = await readdir(join(resolve(root), CHANGESET_DIRECTORY), { withFileTypes: true });

    return entries.some((entry) =>
      entry.isFile() && entry.name !== CHANGESET_README && entry.name.endsWith(".md")
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
};

export const versionPackages = async (root, { run = runCommandInherited } = {}) => {
  const repositoryRoot = resolve(root);

  if (await hasPendingChangesets(repositoryRoot)) {
    await run(localBinaryForPlatform(repositoryRoot, "changeset"), ["version"], { cwd: repositoryRoot });
  }

  return syncRootVersion(repositoryRoot);
};

const isDirectExecution = () =>
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution()) {
  try {
    const version = await versionPackages(process.cwd());
    console.log(`Release version synchronized to ${version}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
