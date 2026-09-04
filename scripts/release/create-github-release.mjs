import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { commandForPlatform, runCommand, runCommandInherited } from "./command-runner.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const STABLE_TAG = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const FULL_SHA = /^[0-9a-f]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const HTTP_STATUS = /^HTTP\/\S+\s+(\d{3})(?:\s|$)/gmu;

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

export const parseGitHubApiResponse = (source) => {
  if (typeof source !== "string") {
    throw new Error("GitHub API response must be text.");
  }

  const matches = [...source.matchAll(HTTP_STATUS)];
  const lastMatch = matches.at(-1);

  if (lastMatch === undefined) {
    throw new Error("GitHub API response did not include an HTTP status.");
  }

  const status = Number.parseInt(lastMatch[1], 10);
  const responseFromStatus = source.slice(lastMatch.index);
  const separator = /\r?\n\r?\n/u.exec(responseFromStatus);

  if (separator === null) {
    throw new Error(`GitHub API HTTP ${status} response did not include a body separator.`);
  }

  const bodySource = responseFromStatus.slice(separator.index + separator[0].length).trim();
  let body;

  try {
    body = JSON.parse(bodySource);
  } catch (error) {
    throw new Error(`GitHub API HTTP ${status} response body was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { status, body };
};

const responseFromError = (error) => {
  if (!isRecord(error) || typeof error.stdout !== "string") {
    return undefined;
  }

  try {
    return parseGitHubApiResponse(error.stdout);
  } catch {
    return undefined;
  }
};

export const createGitHubAdapter = ({
  runLookup = runCommand,
  runCreate = runCommandInherited,
  command = commandForPlatform("gh"),
  cwd = REPOSITORY_ROOT
} = {}) => ({
  lookupRelease: async (repository, tag) => {
    let result;

    try {
      result = await runLookup(command, [
        "api",
        "--include",
        "--method",
        "GET",
        `repos/${repository}/releases/tags/${encodeURIComponent(tag)}`
      ], { cwd, maxBuffer: 10 * 1024 * 1024 });
    } catch (error) {
      if (responseFromError(error)?.status === 404) {
        return undefined;
      }

      throw error;
    }

    const response = parseGitHubApiResponse(result.stdout);

    if (response.status !== 200 || !isRecord(response.body)) {
      throw new Error(`GitHub Release lookup expected HTTP 200 with an object body; received HTTP ${response.status}.`);
    }

    return response.body;
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

  await github.createRelease(repository, tag);
  return "create";
};

export const runGitHubReleaseCli = async ({ environment = process.env } = {}) => {
  const result = await ensureGitHubRelease({
    repository: environment.GITHUB_REPOSITORY,
    tag: environment.GITHUB_REF_NAME,
    sha: environment.GITHUB_SHA
  });

  process.stdout.write(result === "skip"
    ? "GitHub Release already exists and matches the release contract; skipping.\n"
    : "GitHub Release created.\n");
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runGitHubReleaseCli();
}
