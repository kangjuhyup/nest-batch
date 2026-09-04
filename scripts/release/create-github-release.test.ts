import { describe, expect, it } from "vitest";
import {
  createGitHubAdapter,
  ensureGitHubRelease,
  parseGitHubGraphQLResponse
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
const graphQLResponse = (releaseValue: Record<string, unknown> | null) => JSON.stringify({
  data: {
    repository: {
      release: releaseValue
    }
  }
});
const graphQLRelease = (overrides: Record<string, unknown> = {}) => ({
  tagName: TAG,
  targetCommitish: SHA,
  isDraft: false,
  isPrerelease: false,
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

  it("parses an exact GraphQL release object / 정확한 GraphQL release 객체를 해석한다", () => {
    expect(parseGitHubGraphQLResponse(graphQLResponse(graphQLRelease()))).toEqual(release());
  });

  it("maps an exact GraphQL null to confirmed absence / 정확한 GraphQL null을 확인된 부재로 해석한다", async () => {
    const github = createGitHubAdapter({
      runLookup: async () => ({ stdout: graphQLResponse(null) }),
      runCreate: async () => undefined,
      command: "fake-gh",
      cwd: "/repository"
    });

    await expect(github.lookupRelease(REPOSITORY, TAG)).resolves.toBeUndefined();
  });

  it.each([
    ["GraphQL errors", "GraphQL 오류", async () => ({ stdout: JSON.stringify({ errors: [{ message: "Bad credentials" }], data: { repository: null } }) })],
    ["malformed repository", "잘못된 repository", async () => ({ stdout: JSON.stringify({ data: { repository: null } }) })],
    ["malformed release", "잘못된 release", async () => ({ stdout: graphQLResponse({ tagName: TAG }) })],
    ["malformed JSON", "잘못된 JSON", async () => ({ stdout: "not-json" })],
    ["network failure", "네트워크 실패", async () => { throw new Error("connect ECONNREFUSED"); }]
  ])("rejects an unsafe fake-gh lookup: %s / 안전하지 않은 fake-gh 조회를 거부한다: %s", async (_english, _korean, runLookup) => {
    const github = createGitHubAdapter({
      runLookup,
      runCreate: async () => undefined,
      command: "fake-gh",
      cwd: "/repository"
    });

    await expect(github.lookupRelease(REPOSITORY, TAG)).rejects.toThrow();
  });

  it("discovers a draft through the adapter and never creates / adapter에서 draft를 발견하고 생성하지 않는다", async () => {
    const events: string[] = [];
    const github = createGitHubAdapter({
      runLookup: async () => {
        events.push("lookup");
        return { stdout: graphQLResponse(graphQLRelease({ isDraft: true })) };
      },
      runCreate: async () => {
        events.push("create");
      },
      command: "fake-gh",
      cwd: "/repository"
    });

    await expect(ensureGitHubRelease({
      tag: TAG,
      sha: SHA,
      repository: REPOSITORY,
      github,
      resolveCheckout: async () => ({ head: SHA, tag: SHA })
    })).rejects.toThrow(/existing GitHub Release/u);
    expect(events).toEqual(["lookup"]);
  });

  it("uses the explicit repository for lookup and inherited create / 조회와 inherited create에 명시적인 repository를 사용한다", async () => {
    const calls: Array<{ command: string; arguments_: string[] }> = [];
    const github = createGitHubAdapter({
      runLookup: async (command: string, arguments_: string[]) => {
        calls.push({ command, arguments_ });
        return { stdout: graphQLResponse(graphQLRelease({ targetCommitish: "main" })) };
      },
      runCreate: async (command: string, arguments_: string[]) => {
        calls.push({ command, arguments_ });
      },
      command: "fake-gh",
      cwd: "/repository"
    });

    await expect(github.lookupRelease(REPOSITORY, TAG)).resolves.toMatchObject({ tag_name: TAG });
    await github.createRelease(REPOSITORY, TAG);
    const queryArgument = calls[0].arguments_.find((argument) => argument.startsWith("query="));
    expect(queryArgument).toContain("release(tagName: $tagName)");
    expect(queryArgument).toContain("tagName targetCommitish isDraft isPrerelease");
    expect(calls).toEqual([
      {
        command: "fake-gh",
        arguments_: expect.arrayContaining([
          "api",
          "graphql",
          "--raw-field",
          "owner=kangjuhyup",
          "name=nest-batch",
          `tagName=${TAG}`
        ])
      },
      {
        command: "fake-gh",
        arguments_: ["release", "create", TAG, "--repo", REPOSITORY, "--verify-tag", "--generate-notes", "--title", TAG]
      }
    ]);
  });

  it("recovers a concurrent create race after one exact relookup / 한 번의 정확한 재조회로 동시 생성 경합을 복구한다", async () => {
    const createFailure = new Error("already exists");
    const events: string[] = [];
    const lookupResults = [undefined, release()];
    const github = {
      lookupRelease: async () => {
        events.push("lookup");
        return lookupResults.shift();
      },
      createRelease: async () => {
        events.push("create");
        throw createFailure;
      }
    };

    await expect(ensureGitHubRelease({
      tag: TAG,
      sha: SHA,
      repository: REPOSITORY,
      github,
      resolveCheckout: async () => ({ head: SHA, tag: SHA })
    })).resolves.toBe("race-recovered");
    expect(events).toEqual(["lookup", "create", "lookup"]);
  });

  it.each([
    ["still absent", "여전히 없음", undefined, undefined],
    ["lookup failure", "조회 실패", new Error("LOOKUP_FAILURE"), undefined],
    ["conflicting release", "충돌 release", release({ draft: true }), /existing GitHub Release/u]
  ])("fails safely after a create race: %s / 생성 경합 뒤 안전하게 실패한다: %s", async (_english, _korean, secondLookup, expectedConflict) => {
    const createFailure = new Error("CREATE_FAILURE");
    const events: string[] = [];
    let lookupCount = 0;
    const github = {
      lookupRelease: async () => {
        events.push("lookup");
        lookupCount += 1;
        if (lookupCount === 1) {
          return undefined;
        }
        if (secondLookup instanceof Error) {
          throw secondLookup;
        }
        return secondLookup;
      },
      createRelease: async () => {
        events.push("create");
        throw createFailure;
      }
    };
    const operation = ensureGitHubRelease({
      tag: TAG,
      sha: SHA,
      repository: REPOSITORY,
      github,
      resolveCheckout: async () => ({ head: SHA, tag: SHA })
    });

    if (expectedConflict === undefined) {
      await expect(operation).rejects.toBe(createFailure);
    } else {
      await expect(operation).rejects.toThrow(expectedConflict);
    }
    expect(events).toEqual(["lookup", "create", "lookup"]);
  });
});
