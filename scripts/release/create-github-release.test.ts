import { describe, expect, it } from "vitest";
import {
  createGitHubAdapter,
  ensureGitHubRelease,
  parseGitHubGraphQLResponse,
  parseGitHubRestResponse
} from "./create-github-release.mjs";

const TAG = "v0.1.0";
const SHA = "a".repeat(40);
const REPOSITORY = "kangjuhyup/nest-batch";
const RELEASE_ID = 123;
const release = (overrides: Record<string, unknown> = {}) => ({
  tag_name: TAG,
  target_commitish: SHA,
  draft: false,
  prerelease: false,
  ...overrides
});
const graphQLResponse = (releaseValue: Record<string, unknown> | null) => JSON.stringify({
  data: { repository: { release: releaseValue } }
});
const restResponse = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  id: RELEASE_ID,
  ...release(),
  ...overrides
});
const checkout = async () => ({ head: SHA, tag: SHA });

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
    resolveCheckout: checkout
  });
  return { events, result };
};

describe("idempotent GitHub release / 멱등 GitHub release", () => {
  it("skips an exact existing release / 정확한 기존 release를 건너뛴다", async () => {
    await expect(run(release())).resolves.toEqual({ events: ["lookup"], result: "skip" });
  });

  it("creates only after confirmed absence / 확인된 부재 뒤에만 생성한다", async () => {
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
      resolveCheckout: checkout
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

  it("parses a positive GraphQL database ID / 양의 GraphQL database ID를 해석한다", () => {
    expect(parseGitHubGraphQLResponse(graphQLResponse({ databaseId: RELEASE_ID }))).toBe(RELEASE_ID);
  });

  it("maps only GraphQL release null to confirmed absence / GraphQL release null만 확인된 부재로 해석한다", () => {
    expect(parseGitHubGraphQLResponse(graphQLResponse(null))).toBeUndefined();
  });

  it.each([
    ["GraphQL errors", "GraphQL 오류", JSON.stringify({ errors: [{ message: "Bad credentials" }], data: { repository: null } })],
    ["null repository", "null repository", JSON.stringify({ data: { repository: null } })],
    ["missing release", "누락된 release", JSON.stringify({ data: { repository: {} } })],
    ["malformed JSON", "잘못된 JSON", "not-json"]
  ])("rejects a malformed GraphQL response: %s / 잘못된 GraphQL 응답을 거부한다: %s", (_english, _korean, source) => {
    expect(() => parseGitHubGraphQLResponse(source)).toThrow(/GraphQL/u);
  });

  it.each([
    ["zero", "0", 0],
    ["negative", "음수", -1],
    ["fractional", "소수", 1.5],
    ["unsafe integer", "unsafe integer", Number.MAX_SAFE_INTEGER + 1],
    ["string", "문자열", "123"]
  ])("rejects an invalid GraphQL database ID: %s / 잘못된 GraphQL database ID를 거부한다: %s", (_english, _korean, databaseId) => {
    expect(() => parseGitHubGraphQLResponse(graphQLResponse({ databaseId }))).toThrow(/databaseId/u);
  });

  it("parses strict REST release metadata / 엄격한 REST release metadata를 해석한다", () => {
    expect(parseGitHubRestResponse(restResponse(), RELEASE_ID)).toEqual(release());
  });

  it.each([
    ["malformed JSON", "잘못된 JSON", "not-json", RELEASE_ID],
    ["non-object", "객체가 아닌 값", "null", RELEASE_ID],
    ["missing state", "누락된 상태", JSON.stringify({ id: RELEASE_ID, tag_name: TAG }), RELEASE_ID],
    ["ID mismatch", "ID 불일치", restResponse({ id: RELEASE_ID + 1 }), RELEASE_ID],
    ["invalid optional ID", "잘못된 optional ID", restResponse({ id: "123" }), RELEASE_ID]
  ])("rejects malformed REST metadata: %s / 잘못된 REST metadata를 거부한다: %s", (_english, _korean, source, expectedId) => {
    expect(() => parseGitHubRestResponse(source, expectedId)).toThrow(/REST|release ID/u);
  });

  it("uses GraphQL ID then REST by ID for an exact published release / 정확한 published release에 GraphQL ID 뒤 REST by ID를 사용한다", async () => {
    const events: string[] = [];
    const github = createGitHubAdapter({
      runLookup: async (_command: string, arguments_: string[]) => {
        if (arguments_[1] === "graphql") {
          events.push("graphql");
          return { stdout: graphQLResponse({ databaseId: RELEASE_ID }) };
        }
        events.push("rest");
        return { stdout: restResponse() };
      },
      runCreate: async () => {
        events.push("create");
      },
      command: "fake-gh",
      cwd: "/repository"
    });

    await expect(ensureGitHubRelease({ tag: TAG, sha: SHA, repository: REPOSITORY, github, resolveCheckout: checkout }))
      .resolves.toBe("skip");
    expect(events).toEqual(["graphql", "rest"]);
  });

  it("discovers a draft by GraphQL ID and REST metadata without creating / GraphQL ID와 REST metadata로 draft를 발견하고 생성하지 않는다", async () => {
    const events: string[] = [];
    const github = createGitHubAdapter({
      runLookup: async (_command: string, arguments_: string[]) => {
        if (arguments_[1] === "graphql") {
          events.push("graphql");
          return { stdout: graphQLResponse({ databaseId: RELEASE_ID }) };
        }
        events.push("rest");
        return { stdout: restResponse({ draft: true }) };
      },
      runCreate: async () => {
        events.push("create");
      },
      command: "fake-gh",
      cwd: "/repository"
    });

    await expect(ensureGitHubRelease({ tag: TAG, sha: SHA, repository: REPOSITORY, github, resolveCheckout: checkout }))
      .rejects.toThrow(/existing GitHub Release/u);
    expect(events).toEqual(["graphql", "rest"]);
  });

  it("creates after a one-stage GraphQL null lookup / 한 단계 GraphQL null 조회 뒤 생성한다", async () => {
    const events: string[] = [];
    const github = createGitHubAdapter({
      runLookup: async () => {
        events.push("graphql");
        return { stdout: graphQLResponse(null) };
      },
      runCreate: async () => {
        events.push("create");
      },
      command: "fake-gh",
      cwd: "/repository"
    });

    await expect(ensureGitHubRelease({ tag: TAG, sha: SHA, repository: REPOSITORY, github, resolveCheckout: checkout }))
      .resolves.toBe("create");
    expect(events).toEqual(["graphql", "create"]);
  });

  it.each([
    ["GraphQL command failure", "GraphQL 명령 실패", "graphql", async () => { throw new Error("GRAPHQL_AUTH_FAILURE"); }],
    ["REST auth failure", "REST 인증 실패", "rest", async () => { throw new Error("REST_AUTH_FAILURE"); }],
    ["REST network failure", "REST network 실패", "rest", async () => { throw new Error("REST_NETWORK_FAILURE"); }],
    ["malformed REST response", "잘못된 REST 응답", "rest", async () => ({ stdout: "not-json" })],
    ["REST ID mismatch", "REST ID 불일치", "rest", async () => ({ stdout: restResponse({ id: RELEASE_ID + 1 }) })]
  ])("fails adapter lookup without create: %s / adapter 조회 실패 시 생성하지 않는다: %s", async (_english, _korean, failingStage, failure) => {
    const events: string[] = [];
    const github = createGitHubAdapter({
      runLookup: async (_command: string, arguments_: string[]) => {
        const stage = arguments_[1] === "graphql" ? "graphql" : "rest";
        events.push(stage);
        if (stage === failingStage) {
          return failure();
        }
        return { stdout: graphQLResponse({ databaseId: RELEASE_ID }) };
      },
      runCreate: async () => {
        events.push("create");
      },
      command: "fake-gh",
      cwd: "/repository"
    });

    await expect(ensureGitHubRelease({ tag: TAG, sha: SHA, repository: REPOSITORY, github, resolveCheckout: checkout }))
      .rejects.toThrow();
    expect(events).toEqual(failingStage === "graphql" ? ["graphql"] : ["graphql", "rest"]);
  });

  it("uses schema-valid GraphQL and explicit REST/create argv / schema-valid GraphQL과 명시적인 REST/create argv를 사용한다", async () => {
    const calls: Array<{ command: string; arguments_: string[] }> = [];
    const github = createGitHubAdapter({
      runLookup: async (command: string, arguments_: string[]) => {
        calls.push({ command, arguments_ });
        return arguments_[1] === "graphql"
          ? { stdout: graphQLResponse({ databaseId: RELEASE_ID }) }
          : { stdout: restResponse({ target_commitish: "main" }) };
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
    expect(queryArgument).toContain("release(tagName: $tagName) { databaseId }");
    expect(queryArgument).not.toMatch(/targetCommitish|tagName target|isDraft|isPrerelease/u);
    expect(calls).toEqual([
      {
        command: "fake-gh",
        arguments_: expect.arrayContaining(["api", "graphql", "--raw-field", "owner=kangjuhyup", "name=nest-batch", `tagName=${TAG}`])
      },
      {
        command: "fake-gh",
        arguments_: ["api", "--method", "GET", `repos/${REPOSITORY}/releases/${RELEASE_ID}`]
      },
      {
        command: "fake-gh",
        arguments_: ["release", "create", TAG, "--repo", REPOSITORY, "--verify-tag", "--generate-notes", "--title", TAG]
      }
    ]);
  });

  it("recovers a create race through one GraphQL-to-REST relookup / 한 번의 GraphQL-REST 재조회로 생성 경합을 복구한다", async () => {
    const createFailure = new Error("already exists");
    const events: string[] = [];
    let graphQLCount = 0;
    const github = createGitHubAdapter({
      runLookup: async (_command: string, arguments_: string[]) => {
        if (arguments_[1] === "graphql") {
          events.push("graphql");
          graphQLCount += 1;
          return { stdout: graphQLResponse(graphQLCount === 1 ? null : { databaseId: RELEASE_ID }) };
        }
        events.push("rest");
        return { stdout: restResponse() };
      },
      runCreate: async () => {
        events.push("create");
        throw createFailure;
      },
      command: "fake-gh",
      cwd: "/repository"
    });

    await expect(ensureGitHubRelease({ tag: TAG, sha: SHA, repository: REPOSITORY, github, resolveCheckout: checkout }))
      .resolves.toBe("race-recovered");
    expect(events).toEqual(["graphql", "create", "graphql", "rest"]);
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
    const operation = ensureGitHubRelease({ tag: TAG, sha: SHA, repository: REPOSITORY, github, resolveCheckout: checkout });

    if (expectedConflict === undefined) {
      await expect(operation).rejects.toBe(createFailure);
    } else {
      await expect(operation).rejects.toThrow(expectedConflict);
    }
    expect(events).toEqual(["lookup", "create", "lookup"]);
  });
});
