import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandForPlatform, runCommand } from "./command-runner.mjs";
import { packPackages } from "./pack-packages.mjs";
import { PUBLIC_PACKAGES } from "./package-catalog.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const STABLE_TAG = /^v((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))$/u;
const CONFIRMATION_ATTEMPTS = 6;
const CONFIRMATION_DELAY_MILLISECONDS = 5_000;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const assertIntegrity = (integrity, label) => {
  if (typeof integrity !== "string" || !integrity.startsWith("sha512-") || integrity.length === "sha512-".length) {
    throw new Error(`${label}: integrity must be a non-empty sha512 value.`);
  }
};

const assertRegistry = (registry) => {
  if (!isRecord(registry) || typeof registry.lookupIntegrity !== "function" || typeof registry.publish !== "function") {
    throw new Error("Registry adapter must provide lookupIntegrity() and publish().");
  }
};

export const parseReleaseTag = (tag, expectedVersion) => {
  const tagMatch = typeof tag === "string" ? STABLE_TAG.exec(tag) : undefined;

  if (tagMatch === null || tagMatch === undefined) {
    throw new Error(`Release tag must be v<stable SemVer>; received ${JSON.stringify(tag)}.`);
  }

  if (typeof expectedVersion !== "string" || !STABLE_VERSION.test(expectedVersion)) {
    throw new Error(`Expected version must be stable SemVer; received ${JSON.stringify(expectedVersion)}.`);
  }

  const version = tagMatch[1];

  if (version !== expectedVersion) {
    throw new Error(`Release tag ${tag} does not match expected version ${expectedVersion}.`);
  }

  return version;
};

export const decidePublication = (localIntegrity, remoteIntegrity = undefined) => {
  assertIntegrity(localIntegrity, "Local artifact");

  if (remoteIntegrity === undefined) {
    return "publish";
  }

  assertIntegrity(remoteIntegrity, "Registry artifact");

  if (localIntegrity === remoteIntegrity) {
    return "skip";
  }

  throw new Error("Registry version is occupied with a different integrity.");
};

const validateArtifacts = (artifacts, expectedVersion) => {
  if (!Array.isArray(artifacts) || artifacts.length !== PUBLIC_PACKAGES.length) {
    throw new Error(`Release artifacts must contain exactly ${PUBLIC_PACKAGES.length} catalog packages.`);
  }

  return artifacts.map((artifact, index) => {
    const packageInfo = PUBLIC_PACKAGES[index];

    if (!isRecord(artifact) || artifact.name !== packageInfo.name) {
      throw new Error(`Release artifact at catalog order ${index} must be ${packageInfo.name}.`);
    }

    if (artifact.version !== expectedVersion) {
      throw new Error(`${artifact.name}: artifact version ${JSON.stringify(artifact.version)} does not match ${expectedVersion}.`);
    }

    if (typeof artifact.tarball !== "string" || artifact.tarball.length === 0) {
      throw new Error(`${artifact.name}: artifact tarball path must be a non-empty string.`);
    }

    assertIntegrity(artifact.integrity, artifact.name);
    return artifact;
  });
};

const parseRemoteIntegrity = (stdout, name, version) => {
  let integrity;

  try {
    integrity = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${name}@${version}: registry returned invalid JSON for dist.integrity: ${error instanceof Error ? error.message : String(error)}`);
  }

  assertIntegrity(integrity, `${name}@${version}: registry artifact`);
  return integrity;
};

const isNotFoundResponse = (error) => {
  if (!isRecord(error)) {
    return false;
  }

  if (error.code === "E404" || error.statusCode === 404 || error.status === 404) {
    return true;
  }

  return typeof error.stderr === "string" && /\bnpm\s+error\s+code\s+E404\b/u.test(error.stderr);
};

export const createNpmRegistryAdapter = ({
  run = runCommand,
  command = commandForPlatform("npm"),
  cwd = REPOSITORY_ROOT
} = {}) => ({
  lookupIntegrity: async (name, version) => {
    try {
      const { stdout } = await run(command, ["view", `${name}@${version}`, "dist.integrity", "--json"], {
        cwd,
        maxBuffer: 10 * 1024 * 1024
      });
      return parseRemoteIntegrity(stdout, name, version);
    } catch (error) {
      if (isNotFoundResponse(error)) {
        return undefined;
      }

      throw error;
    }
  },
  publish: async (artifact) => {
    await run(command, ["publish", artifact.tarball, "--access", "public"], {
      cwd,
      maxBuffer: 10 * 1024 * 1024
    });
  }
});

const confirmPublication = async ({ artifacts, registry, sleep }) => {
  let pending = [];

  for (let attempt = 1; attempt <= CONFIRMATION_ATTEMPTS; attempt += 1) {
    pending = [];

    for (const artifact of artifacts) {
      const remoteIntegrity = await registry.lookupIntegrity(artifact.name, artifact.version);

      if (decidePublication(artifact.integrity, remoteIntegrity) === "publish") {
        pending.push(artifact.name);
      }
    }

    if (pending.length === 0) {
      return;
    }

    if (attempt < CONFIRMATION_ATTEMPTS) {
      await sleep(CONFIRMATION_DELAY_MILLISECONDS);
    }
  }

  throw new Error(`Published package integrity was not visible after ${CONFIRMATION_ATTEMPTS} attempts: ${pending.join(", ")}.`);
};

export const publishRelease = async ({ tag, rootVersion, artifacts, registry, sleep = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
}) }) => {
  const version = parseReleaseTag(tag, rootVersion);
  const validatedArtifacts = validateArtifacts(artifacts, version);
  assertRegistry(registry);
  const published = [];
  const skipped = [];

  for (const artifact of validatedArtifacts) {
    const remoteIntegrity = await registry.lookupIntegrity(artifact.name, version);
    const decision = decidePublication(artifact.integrity, remoteIntegrity);

    if (decision === "skip") {
      skipped.push(artifact.name);
      continue;
    }

    await registry.publish(artifact);
    published.push(artifact.name);
  }

  await confirmPublication({ artifacts: validatedArtifacts, registry, sleep });
  return { published, skipped };
};

export const readReleaseTag = (argv, environment) => {
  let tag;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    let candidate;

    if (argument === "--tag") {
      candidate = argv[index + 1];
      index += 1;
    } else if (argument.startsWith("--tag=")) {
      candidate = argument.slice("--tag=".length);
    } else {
      throw new Error(`Unknown publish argument: ${argument}.`);
    }

    if (typeof candidate !== "string" || candidate.length === 0) {
      throw new Error("--tag requires a release tag value.");
    }

    if (tag !== undefined) {
      throw new Error("Release tag may be provided only once.");
    }

    tag = candidate;
  }

  if (tag !== undefined) {
    return tag;
  }

  if (typeof environment.GITHUB_REF_NAME === "string" && environment.GITHUB_REF_NAME.length > 0) {
    return environment.GITHUB_REF_NAME;
  }

  throw new Error("Release tag is required via --tag or GITHUB_REF_NAME.");
};

const readRootVersion = async (root = REPOSITORY_ROOT) => {
  const manifestPath = join(root, "package.json");
  let manifest;

  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read root package version: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(manifest) || typeof manifest.version !== "string") {
    throw new Error("Root package.json must contain a version.");
  }

  return manifest.version;
};

const createTemporaryDirectory = () => mkdtemp(join(tmpdir(), "nest-batch-publish-"));
const removeTemporaryDirectory = (directory) => rm(directory, { recursive: true, force: true });

export const runPublishCli = async ({
  argv = process.argv.slice(2),
  environment = process.env,
  rootVersion = undefined,
  readVersion = readRootVersion,
  createTemporaryDirectory: makeTemporaryDirectory = createTemporaryDirectory,
  removeTemporaryDirectory: removeDirectory = removeTemporaryDirectory,
  pack = packPackages,
  registry = undefined,
  sleep = undefined
} = {}) => {
  const tag = readReleaseTag(argv, environment);
  const expectedVersion = rootVersion ?? await readVersion();

  parseReleaseTag(tag, expectedVersion);

  const temporaryDirectory = await makeTemporaryDirectory();

  try {
    const artifacts = await pack(temporaryDirectory);
    return await publishRelease({
      tag,
      rootVersion: expectedVersion,
      artifacts,
      registry: registry ?? createNpmRegistryAdapter(),
      ...(sleep === undefined ? {} : { sleep })
    });
  } finally {
    await removeDirectory(temporaryDirectory);
  }
};

const isDirectExecution = () =>
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution()) {
  try {
    const { published, skipped } = await runPublishCli();
    console.log(`Published ${published.length} package(s); skipped ${skipped.length} package(s).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
