import { describe, expect, it } from "vitest";
import {
  createGitHubAdapter,
  ensureGitHubRelease,
  parseGitHubApiResponse
} from "./create-github-release.mjs";

const TAG = "v0.1.0";
const SHA = "a".repeat(40);
const REPOSITORY = "kangjuhyup/nest-batch";
const release = (overrides: Record<string, unknown> = {}) => ({
  tag_name: TAG,
  target_commitish: SHA,
  draft: false,
  prerelease: false,
  ...overrides
});

const run = async (existing: ReturnType<typeof release> | undefined | Error) => {
  const events: string[] = [];
  const github = {
    lookupRelease: async () => {
      events.push("lookup");
      if (existing instanceof Error) {
        throw existing;
      }
      return existing;
    },
    createRelease: async () => {
      events.push("create");
    }
  };
  const result = await ensureGitHubRelease({
    tag: TAG,
    sha: SHA,
    repository: REPOSITORY,
    github,
    resolveCheckout: async () => ({ head: SHA, tag: SHA })
  });
  return { events, result };
};

describe("idempotent GitHub release / 멱등 GitHub release", () => {
  it("skips an exact existing release / 정확한 기존 release를 건너뛴다", async () => {
    await expect(run(release())).resolves.toEqual({ events: ["lookup"], result: "skip" });
  });

  it("creates only after a confirmed not-found / 확인된 not-found 뒤에만 생성한다", async () => {
    await expect(run(undefined)).resolves.toEqual({ events: ["lookup", "create"], result: "create" });
  });

  it("fails a lookup error without creating / 조회 오류에서 생성하지 않고 실패한다", async () => {
    const failure = new Error("GITHUB_AUTH_FAILURE");
    const events: string[] = [];
    const github = {
      lookupRelease: async () => {
        events.push("lookup");
        throw failure;
      },
      createRelease: async () => {
        events.push("create");
      }
    };

    await expect(ensureGitHubRelease({
      tag: TAG,
      sha: SHA,
      repository: REPOSITORY,
      github,
      resolveCheckout: async () => ({ head: SHA, tag: SHA })
    })).rejects.toBe(failure);
    expect(events).toEqual(["lookup"]);
  });

  it.each([
    ["different tag", "다른 tag", { tag_name: "v0.1.1" }],
    ["draft release", "draft release", { draft: true }],
    ["prerelease", "prerelease", { prerelease: true }],
    ["different immutable target", "다른 immutable target", { target_commitish: "b".repeat(40) }]
  ])("rejects conflicting existing state: %s / 충돌하는 기존 상태를 거부한다: %s", async (_english, _korean, overrides) => {
    await expect(run(release(overrides))).rejects.toThrow(/existing GitHub Release/u);
  });

  it("rejects a checkout that does not resolve the tag to the workflow SHA / tag가 workflow SHA로 resolve되지 않는 checkout을 거부한다", async () => {
    await expect(ensureGitHubRelease({
      tag: TAG,
      sha: SHA,
      repository: REPOSITORY,
      github: { lookupRelease: async () => undefined, createRelease: async () => undefined },
      resolveCheckout: async () => ({ head: SHA, tag: "b".repeat(40) })
    })).rejects.toThrow(/tag checkout/u);
  });

  it("parses explicit GitHub API status and body / 명시적인 GitHub API status와 body를 해석한다", () => {
    expect(parseGitHubApiResponse("HTTP/2.0 200 OK\ncontent-type: application/json\n\n{\"tag_name\":\"v0.1.0\"}\n"))
      .toEqual({ status: 200, body: { tag_name: "v0.1.0" } });
    expect(parseGitHubApiResponse("HTTP/2.0 404 Not Found\ncontent-type: application/json\n\n{\"message\":\"Not Found\"}\n").status)
      .toBe(404);
  });

  it("maps only an explicit API 404 to missing / 명시적인 API 404만 없음으로 해석한다", async () => {
    const notFound = Object.assign(new Error("gh exited 1"), {
      stdout: "HTTP/2.0 404 Not Found\ncontent-type: application/json\n\n{\"message\":\"Not Found\"}\n"
    });
    const github = createGitHubAdapter({
      runLookup: async () => { throw notFound; },
      runCreate: async () => undefined,
      command: "fake-gh",
      cwd: "/repository"
    });

    await expect(github.lookupRelease(REPOSITORY, TAG)).resolves.toBeUndefined();
  });

  it.each([
    ["authentication response", "인증 응답", Object.assign(new Error("gh exited 1"), {
      stdout: "HTTP/2.0 401 Unauthorized\ncontent-type: application/json\n\n{\"message\":\"Bad credentials\"}\n"
    })],
    ["network failure", "네트워크 실패", new Error("connect ECONNREFUSED")]
  ])("propagates a non-404 fake-gh failure: %s / 404가 아닌 fake-gh 실패를 전파한다: %s", async (_english, _korean, failure) => {
    const github = createGitHubAdapter({
      runLookup: async () => { throw failure; },
      runCreate: async () => undefined,
      command: "fake-gh",
      cwd: "/repository"
    });

    await expect(github.lookupRelease(REPOSITORY, TAG)).rejects.toBe(failure);
  });

  it("uses the explicit repository for lookup and inherited create / 조회와 inherited create에 명시적인 repository를 사용한다", async () => {
    const calls: Array<{ command: string; arguments_: string[] }> = [];
    const github = createGitHubAdapter({
      runLookup: async (command: string, arguments_: string[]) => {
        calls.push({ command, arguments_ });
        return {
          stdout: "HTTP/2.0 200 OK\ncontent-type: application/json\n\n{\"tag_name\":\"v0.1.0\",\"target_commitish\":\"main\",\"draft\":false,\"prerelease\":false}\n"
        };
      },
      runCreate: async (command: string, arguments_: string[]) => {
        calls.push({ command, arguments_ });
      },
      command: "fake-gh",
      cwd: "/repository"
    });

    await expect(github.lookupRelease(REPOSITORY, TAG)).resolves.toMatchObject({ tag_name: TAG });
    await github.createRelease(REPOSITORY, TAG);
    expect(calls).toEqual([
      {
        command: "fake-gh",
        arguments_: ["api", "--include", "--method", "GET", `repos/${REPOSITORY}/releases/tags/${TAG}`]
      },
      {
        command: "fake-gh",
        arguments_: ["release", "create", TAG, "--repo", REPOSITORY, "--verify-tag", "--generate-notes", "--title", TAG]
      }
    ]);
  });
});
