import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { commandForPlatform, runCommand, runCommandInherited } from "./command-runner.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const STABLE_TAG = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const FULL_SHA = /^[0-9a-f]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const RELEASE_QUERY = "query ReleaseByTag($owner: String!, $name: String!, $tagName: String!) { repository(owner: $owner, name: $name) { release(tagName: $tagName) { databaseId } } }";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const assertInputs = (repository, tag, sha) => {
  if (typeof repository !== "string" || !REPOSITORY.test(repository)) {
    throw new Error(`GitHub repository must be an explicit owner/name; received ${JSON.stringify(repository)}.`);
  }

  if (typeof tag !== "string" || !STABLE_TAG.test(tag)) {
    throw new Error(`GitHub Release tag must be v<stable SemVer>; received ${JSON.stringify(tag)}.`);
  }

  if (typeof sha !== "string" || !FULL_SHA.test(sha)) {
    throw new Error(`GitHub workflow SHA must be a 40-character lowercase commit SHA; received ${JSON.stringify(sha)}.`);
  }
};

export const parseGitHubGraphQLResponse = (source) => {
  if (typeof source !== "string") {
    throw new Error("GitHub GraphQL response must be text.");
  }

  let response;

  try {
    response = JSON.parse(source);
  } catch (error) {
    throw new Error(`GitHub GraphQL response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(response)) {
    throw new Error("GitHub GraphQL response must be an object.");
  }

  if (Object.hasOwn(response, "errors")) {
    throw new Error(`GitHub GraphQL response contained errors: ${JSON.stringify(response.errors)}.`);
  }

  if (!isRecord(response.data) || !isRecord(response.data.repository)) {
    throw new Error("GitHub GraphQL response must contain data.repository.");
  }

  const release = response.data.repository.release;

  if (release === null) {
    return undefined;
  }

  if (!isRecord(release) || !Number.isSafeInteger(release.databaseId) || release.databaseId <= 0) {
    throw new Error("GitHub GraphQL release databaseId must be a positive safe integer.");
  }

  return release.databaseId;
};

export const parseGitHubRestResponse = (source, expectedId) => {
  if (typeof source !== "string") {
    throw new Error("GitHub REST response must be text.");
  }

  if (!Number.isSafeInteger(expectedId) || expectedId <= 0) {
    throw new Error("Expected GitHub release ID must be a positive safe integer.");
  }

  let release;

  try {
    release = JSON.parse(source);
  } catch (error) {
    throw new Error(`GitHub REST response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (
    !isRecord(release) ||
    typeof release.tag_name !== "string" ||
    release.tag_name.length === 0 ||
    typeof release.target_commitish !== "string" ||
    release.target_commitish.length === 0 ||
    typeof release.draft !== "boolean" ||
    typeof release.prerelease !== "boolean"
  ) {
    throw new Error("GitHub REST response contained malformed release metadata.");
  }

  if (Object.hasOwn(release, "id") && (
    !Number.isSafeInteger(release.id) ||
    release.id <= 0 ||
    release.id !== expectedId
  )) {
    throw new Error(`GitHub REST release ID must match GraphQL databaseId ${expectedId}.`);
  }

  return {
    tag_name: release.tag_name,
    target_commitish: release.target_commitish,
    draft: release.draft,
    prerelease: release.prerelease
  };
};

export const createGitHubAdapter = ({
  runLookup = runCommand,
  runCreate = runCommandInherited,
  command = commandForPlatform("gh"),
  cwd = REPOSITORY_ROOT
} = {}) => ({
  lookupRelease: async (repository, tag) => {
    const [owner, name] = repository.split("/");
    const result = await runLookup(command, [
      "api",
      "graphql",
      "--raw-field",
      `query=${RELEASE_QUERY}`,
      "--raw-field",
      `owner=${owner}`,
      "--raw-field",
      `name=${name}`,
      "--raw-field",
      `tagName=${tag}`
    ], { cwd, maxBuffer: 10 * 1024 * 1024 });

    const releaseId = parseGitHubGraphQLResponse(result.stdout);

    if (releaseId === undefined) {
      return undefined;
    }

    const releaseResult = await runLookup(command, [
      "api",
      "--method",
      "GET",
      `repos/${repository}/releases/${releaseId}`
    ], { cwd, maxBuffer: 10 * 1024 * 1024 });

    return parseGitHubRestResponse(releaseResult.stdout, releaseId);
  },
  createRelease: async (repository, tag) => runCreate(command, [
    "release",
    "create",
    tag,
    "--repo",
    repository,
    "--verify-tag",
    "--generate-notes",
    "--title",
    tag
  ], { cwd })
});

const resolveCheckoutWithGit = async () => {
  const command = commandForPlatform("git");
  const head = await runCommand(command, ["rev-parse", "--verify", "HEAD^{commit}"], {
    cwd: REPOSITORY_ROOT
  });

  return {
    head: head.stdout.trim(),
    resolveTag: async (tag) => {
      const result = await runCommand(command, ["rev-parse", "--verify", `${tag}^{commit}`], {
        cwd: REPOSITORY_ROOT
      });
      return result.stdout.trim();
    }
  };
};

const assertExistingRelease = (release, tag, sha) => {
  if (
    !isRecord(release) ||
    release.tag_name !== tag ||
    release.draft !== false ||
    release.prerelease !== false
  ) {
    throw new Error(`Conflicting existing GitHub Release for ${tag}: expected exact tag, non-draft, and non-prerelease state.`);
  }

  if (typeof release.target_commitish !== "string" || release.target_commitish.length === 0) {
    throw new Error(`Conflicting existing GitHub Release for ${tag}: target_commitish must be present.`);
  }

  if (FULL_SHA.test(release.target_commitish) && release.target_commitish !== sha) {
    throw new Error(`Conflicting existing GitHub Release for ${tag}: immutable target does not match workflow SHA.`);
  }
};

export const ensureGitHubRelease = async ({
  tag,
  sha,
  repository,
  github = createGitHubAdapter(),
  resolveCheckout = async (releaseTag) => {
    const checkout = await resolveCheckoutWithGit();
    return { head: checkout.head, tag: await checkout.resolveTag(releaseTag) };
  }
}) => {
  assertInputs(repository, tag, sha);

  const checkout = await resolveCheckout(tag);

  if (!isRecord(checkout) || checkout.head !== sha || checkout.tag !== sha) {
    throw new Error(`GitHub Release tag checkout must resolve HEAD and ${tag} to workflow SHA ${sha}.`);
  }

  const existing = await github.lookupRelease(repository, tag);

  if (existing !== undefined) {
    assertExistingRelease(existing, tag, sha);
    return "skip";
  }

  try {
    await github.createRelease(repository, tag);
    return "create";
  } catch (createError) {
    let racedRelease;

    try {
      racedRelease = await github.lookupRelease(repository, tag);
    } catch {
      throw createError;
    }

    if (racedRelease === undefined) {
      throw createError;
    }

    assertExistingRelease(racedRelease, tag, sha);
    return "race-recovered";
  }
};

export const runGitHubReleaseCli = async ({ environment = process.env } = {}) => {
  const result = await ensureGitHubRelease({
    repository: environment.GITHUB_REPOSITORY,
    tag: environment.GITHUB_REF_NAME,
    sha: environment.GITHUB_SHA
  });

  process.stdout.write(result === "create"
    ? "GitHub Release created.\n"
    : `GitHub Release ${result === "race-recovered" ? "appeared during create and" : "already exists and"} matches the release contract; skipping.\n`);
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runGitHubReleaseCli();
}
