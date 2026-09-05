import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commandForPlatform, runCommand, runCommandInherited } from "./command-runner.mjs";
import { parseReleaseTag } from "./publish-packages.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MAIN_REF = "refs/remotes/origin/main";
const FULL_SHA = /^[0-9a-f]{40}$/u;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const commandExitCode = (error) =>
  isRecord(error) && typeof error.code === "number" ? error.code : undefined;

const assertSha = (sha, label) => {
  if (typeof sha !== "string" || !FULL_SHA.test(sha)) {
    throw new Error(`${label} must be a 40-character lowercase commit SHA.`);
  }

  return sha;
};

export const parseReleaseStartArguments = (argv) => {
  if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== "string")) {
    throw new Error("Release arguments must be strings.");
  }

  let tag;
  let bootstrap = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--tag") {
      if (tag !== undefined || index + 1 >= argv.length) {
        throw new Error("Release requires exactly one --tag value.");
      }

      tag = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--bootstrap") {
      if (bootstrap) {
        throw new Error("Release accepts --bootstrap at most once.");
      }

      bootstrap = true;
      continue;
    }

    throw new Error(`Unknown release argument: ${JSON.stringify(argument)}.`);
  }

  if (tag === undefined) {
    throw new Error("Release requires --tag vX.Y.Z.");
  }

  return { bootstrap, tag };
};

const parseRemoteTag = (source, tag) => {
  const exactRef = `refs/tags/${tag}`;
  const peeledRef = `${exactRef}^{}`;
  const references = new Map();

  for (const line of source.trim().split("\n").filter(Boolean)) {
    const match = /^([0-9a-f]{40})\t(.+)$/u.exec(line);

    if (match === null || (match[2] !== exactRef && match[2] !== peeledRef)) {
      throw new Error(`Remote release tag ${tag} returned malformed git metadata.`);
    }

    references.set(match[2], match[1]);
  }

  const sha = references.get(peeledRef) ?? references.get(exactRef);
  return sha === undefined ? undefined : assertSha(sha, `Remote release tag ${tag}`);
};

export const createGitReleaseAdapter = ({
  run = runCommand,
  runInherited = runCommandInherited,
  command = commandForPlatform("git"),
  cwd = REPOSITORY_ROOT
} = {}) => ({
  ensureClean: async () => {
    const result = await run(command, ["status", "--porcelain=v1", "--untracked-files=all"], { cwd });

    if (result.stdout.length > 0) {
      throw new Error("Release worktree must be clean before creating a tag.");
    }
  },
  fetchReleaseRefs: async () => {
    await run(command, [
      "fetch",
      "--tags",
      "origin",
      "refs/heads/main:refs/remotes/origin/main"
    ], { cwd });
  },
  headSha: async () => {
    const result = await run(command, ["rev-parse", "--verify", "HEAD^{commit}"], { cwd });
    return assertSha(result.stdout.trim(), "Release HEAD");
  },
  isIncludedInMain: async (sha) => {
    try {
      await run(command, ["merge-base", "--is-ancestor", sha, MAIN_REF], { cwd });
      return true;
    } catch (error) {
      if (commandExitCode(error) === 1) {
        return false;
      }

      throw error;
    }
  },
  localTagSha: async (tag) => {
    try {
      await run(command, ["show-ref", "--verify", "--quiet", `refs/tags/${tag}`], { cwd });
    } catch (error) {
      if (commandExitCode(error) === 1) {
        return undefined;
      }

      throw error;
    }

    const result = await run(command, ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`], { cwd });
    return assertSha(result.stdout.trim(), `Local release tag ${tag}`);
  },
  remoteTagSha: async (tag) => {
    try {
      const result = await run(command, [
        "ls-remote",
        "--exit-code",
        "--tags",
        "origin",
        `refs/tags/${tag}`,
        `refs/tags/${tag}^{}`
      ], { cwd });
      return parseRemoteTag(result.stdout, tag);
    } catch (error) {
      if (commandExitCode(error) === 2) {
        return undefined;
      }

      throw error;
    }
  },
  createSignedTag: async (tag, sha) => {
    await runInherited(command, ["tag", "-s", "-m", `Release ${tag}`, tag, sha], { cwd });
  },
  verifySignedTag: async (tag) => {
    await runInherited(command, ["verify-tag", tag], { cwd });
  },
  pushTag: async (tag) => {
    await runInherited(command, ["push", "origin", `refs/tags/${tag}:refs/tags/${tag}`], { cwd });
  }
});

export const prepareSignedReleaseTag = async ({ tag, version, git }) => {
  parseReleaseTag(tag, version);
  await git.ensureClean();
  await git.fetchReleaseRefs();

  const sha = assertSha(await git.headSha(), "Release HEAD");

  if (!await git.isIncludedInMain(sha)) {
    throw new Error(`Release commit ${sha} must be included in origin/main.`);
  }

  const localTagSha = await git.localTagSha(tag);
  const remoteTagSha = await git.remoteTagSha(tag);

  if (localTagSha !== undefined && localTagSha !== sha) {
    throw new Error(`Local release tag ${tag} points to ${localTagSha}, not release commit ${sha}.`);
  }

  if (remoteTagSha !== undefined && remoteTagSha !== sha) {
    throw new Error(`Remote release tag ${tag} points to ${remoteTagSha}, not release commit ${sha}.`);
  }

  if (localTagSha === undefined) {
    if (remoteTagSha !== undefined) {
      throw new Error(`Remote release tag ${tag} exists but was not fetched locally.`);
    }

    await git.createSignedTag(tag, sha);
  }

  await git.verifySignedTag(tag);

  if (await git.localTagSha(tag) !== sha) {
    throw new Error(`Signed release tag ${tag} does not resolve to release commit ${sha}.`);
  }

  return { remoteExists: remoteTagSha !== undefined, sha, tag };
};

const readRootVersion = async (root) => {
  let manifest;

  try {
    manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  } catch (error) {
    throw new Error(`Unable to read root package version: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(manifest) || typeof manifest.version !== "string") {
    throw new Error("Root package.json must contain a version.");
  }

  return manifest.version;
};

const runPnpm = (arguments_, root) =>
  runCommandInherited(commandForPlatform("pnpm"), arguments_, { cwd: root });

export const runReleaseStart = async ({
  argv = process.argv.slice(2),
  root = REPOSITORY_ROOT,
  readVersion = readRootVersion,
  verifyCandidate = (repositoryRoot) => runPnpm(["release:check"], repositoryRoot),
  prepareTag = prepareSignedReleaseTag,
  publish = (tag, repositoryRoot) => runPnpm(["run", "release:publish", "--tag", tag], repositoryRoot),
  git = createGitReleaseAdapter({ cwd: root })
} = {}) => {
  const { bootstrap, tag } = parseReleaseStartArguments(argv);
  const version = await readVersion(root);
  parseReleaseTag(tag, version);

  if (bootstrap && tag !== "v0.1.0") {
    throw new Error("--bootstrap is reserved for the one-time v0.1.0 release.");
  }

  await verifyCandidate(root);
  const prepared = await prepareTag({ tag, version, git });

  if (bootstrap) {
    await publish(tag, root);
  }

  if (!prepared.remoteExists) {
    await git.pushTag(tag);
  }

  return { ...prepared, bootstrap, pushed: !prepared.remoteExists };
};

const isDirectExecution = () =>
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution()) {
  try {
    const result = await runReleaseStart();
    process.stdout.write(
      `${result.tag} ${result.pushed ? "was pushed" : "already exists on origin"}; `
      + `${result.bootstrap ? "bootstrap packages were published locally" : "the tag-triggered publish workflow will continue the release"}.\n`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
