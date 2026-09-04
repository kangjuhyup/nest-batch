import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REPOSITORY_URL } from "./package-catalog.mjs";
import { PUBLIC_PACKAGES } from "./package-catalog.mjs";

const EXPECTED_HOMEPAGE = "https://github.com/kangjuhyup/nest-batch#readme";
const EXPECTED_BUGS_URL = "https://github.com/kangjuhyup/nest-batch/issues";
const EXPECTED_NODE_RANGE = ">=20.18.0";
const EXPECTED_FILES = ["dist", "src", "README.md", "LICENSE"];
const NUMERIC_IDENTIFIER = "(?:0|[1-9]\\d*)";
const NON_NUMERIC_IDENTIFIER = "\\d*[A-Za-z-][0-9A-Za-z-]*";
const PRERELEASE_IDENTIFIER = `(?:${NUMERIC_IDENTIFIER}|${NON_NUMERIC_IDENTIFIER})`;
const SEMVER_PATTERN = new RegExp(
  `^${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}(?:-${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`
);

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const hasExactFiles = (files) =>
  Array.isArray(files) && files.length === EXPECTED_FILES.length && files.every((file, index) => file === EXPECTED_FILES[index]);

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validateManifest(manifest, directory) {
  const errors = [];

  if (!isRecord(manifest)) {
    throw new Error(`${directory}: package manifest must be an object`);
  }

  if (typeof manifest.name !== "string" || !/^@nest-batch\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(manifest.name)) {
    errors.push("name must be an @nest-batch scoped package name");
  }

  if (typeof manifest.version !== "string" || !SEMVER_PATTERN.test(manifest.version)) {
    errors.push("version must be strict SemVer");
  }

  if (manifest.type !== "module") {
    errors.push('type must be "module"');
  }

  if (manifest.license !== "MIT") {
    errors.push('license must be "MIT"');
  }

  if (manifest.author !== "kangjuhyup") {
    errors.push('author must be "kangjuhyup"');
  }

  if (!isRecord(manifest.repository) || manifest.repository.type !== "git" || manifest.repository.url !== REPOSITORY_URL) {
    errors.push(`repository must identify ${REPOSITORY_URL}`);
  }

  if (!isRecord(manifest.repository) || manifest.repository.directory !== directory) {
    errors.push(`repository.directory must equal ${directory}`);
  }

  if (manifest.homepage !== EXPECTED_HOMEPAGE) {
    errors.push(`homepage must equal ${EXPECTED_HOMEPAGE}`);
  }

  if (!isRecord(manifest.bugs) || manifest.bugs.url !== EXPECTED_BUGS_URL) {
    errors.push(`bugs.url must equal ${EXPECTED_BUGS_URL}`);
  }

  if (!isRecord(manifest.engines) || manifest.engines.node !== EXPECTED_NODE_RANGE) {
    errors.push(`engines.node must equal ${EXPECTED_NODE_RANGE}`);
  }

  if (!hasExactFiles(manifest.files)) {
    errors.push(`files must equal ${JSON.stringify(EXPECTED_FILES)}`);
  }

  if (!isRecord(manifest.publishConfig) || manifest.publishConfig.access !== "public") {
    errors.push('publishConfig.access must equal "public"');
  }

  if (typeof manifest.description !== "string" || manifest.description.trim().length === 0) {
    errors.push("description must be a non-empty string");
  }

  if (!Array.isArray(manifest.keywords) || manifest.keywords.length === 0 || manifest.keywords.some((keyword) => typeof keyword !== "string" || keyword.trim().length === 0)) {
    errors.push("keywords must be a non-empty string array");
  }

  if (errors.length > 0) {
    throw new Error(`${directory}: ${errors.join("; ")}`);
  }
}

function validateRootManifest(manifest) {
  const errors = [];

  if (!isRecord(manifest)) {
    return ["root package manifest must be an object"];
  }

  if (manifest.name !== "nest-batch") {
    errors.push('root name must be "nest-batch"');
  }

  if (typeof manifest.version !== "string" || !SEMVER_PATTERN.test(manifest.version)) {
    errors.push("root version must be strict SemVer");
  }

  if (manifest.private !== true) {
    errors.push("root package must remain private");
  }

  if (manifest.type !== "module") {
    errors.push('root type must be "module"');
  }

  if (manifest.license !== "MIT") {
    errors.push('root license must be "MIT"');
  }

  if (manifest.author !== "kangjuhyup") {
    errors.push('root author must be "kangjuhyup"');
  }

  if (!isRecord(manifest.repository) || manifest.repository.type !== "git" || manifest.repository.url !== REPOSITORY_URL) {
    errors.push(`root repository must identify ${REPOSITORY_URL}`);
  }

  if (manifest.homepage !== EXPECTED_HOMEPAGE) {
    errors.push(`root homepage must equal ${EXPECTED_HOMEPAGE}`);
  }

  if (!isRecord(manifest.bugs) || manifest.bugs.url !== EXPECTED_BUGS_URL) {
    errors.push(`root bugs.url must equal ${EXPECTED_BUGS_URL}`);
  }

  if (!isRecord(manifest.engines) || manifest.engines.node !== EXPECTED_NODE_RANGE) {
    errors.push(`root engines.node must equal ${EXPECTED_NODE_RANGE}`);
  }

  return errors;
}

export function verifyReleaseRepository(root) {
  const repositoryRoot = resolve(root);
  const errors = [];
  const rootManifestPath = join(repositoryRoot, "package.json");
  const rootManifest = readJson(rootManifestPath);
  const rootManifestErrors = validateRootManifest(rootManifest);
  errors.push(...rootManifestErrors.map((error) => `package.json: ${error}`));

  const rootLicense = readFileSync(join(repositoryRoot, "LICENSE"), "utf8");

  for (const packageInfo of PUBLIC_PACKAGES) {
    const manifestPath = join(repositoryRoot, packageInfo.directory, "package.json");
    let manifest;

    try {
      manifest = readJson(manifestPath);
      validateManifest(manifest, packageInfo.directory);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    if (manifest.name !== packageInfo.name) {
      errors.push(`${packageInfo.directory}: name ${manifest.name} must equal ${packageInfo.name}`);
    }

    if (manifest.version !== rootManifest.version) {
      errors.push(`${packageInfo.directory}: version ${manifest.version} must match root version ${rootManifest.version}`);
    }

    const packageLicensePath = join(repositoryRoot, packageInfo.directory, "LICENSE");
    try {
      if (readFileSync(packageLicensePath, "utf8") !== rootLicense) {
        errors.push(`${packageInfo.directory}/LICENSE must exactly match root LICENSE`);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (errors.length > 0) {
    throw new Error(`Release repository verification failed:\n- ${errors.join("\n- ")}`);
  }
}

const isDirectExecution = () =>
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution()) {
  try {
    verifyReleaseRepository(process.cwd());
    console.log("Release repository verification passed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
