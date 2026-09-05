import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_PACKAGES } from "./package-catalog.mjs";

const NUMERIC_IDENTIFIER = "(?:0|[1-9]\\d*)";
const NON_NUMERIC_IDENTIFIER = "\\d*[A-Za-z-][0-9A-Za-z-]*";
const PRERELEASE_IDENTIFIER = `(?:${NUMERIC_IDENTIFIER}|${NON_NUMERIC_IDENTIFIER})`;
const SEMVER_PATTERN = new RegExp(
  `^${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}(?:-${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`
);

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

export const syncRootVersion = async (root) => {
  const repositoryRoot = resolve(root);
  const packageManifests = await Promise.all(PUBLIC_PACKAGES.map(({ directory }) =>
    readJson(join(repositoryRoot, directory, "package.json"))
  ));
  const versions = new Set(packageManifests.map((manifest) => manifest.version));

  if (versions.size !== 1) {
    throw new Error("Public packages must share exactly one fixed version.");
  }

  const [version] = versions;

  if (typeof version !== "string" || !SEMVER_PATTERN.test(version)) {
    throw new Error("Public packages must share one valid fixed version.");
  }

  const rootManifestPath = join(repositoryRoot, "package.json");
  const rootManifest = await readJson(rootManifestPath);
  rootManifest.version = version;
  await writeFile(rootManifestPath, `${JSON.stringify(rootManifest, null, 2)}\n`);

  return version;
};

const isDirectExecution = () =>
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution()) {
  try {
    const version = await syncRootVersion(process.cwd());
    console.log(`Root version synchronized to ${version}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
