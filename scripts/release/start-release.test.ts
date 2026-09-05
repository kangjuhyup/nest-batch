import { describe, expect, it } from "vitest";
import {
  createGitReleaseAdapter,
  parseReleaseStartArguments,
  prepareSignedReleaseTag,
  runReleaseStart
} from "./start-release.mjs";

const TAG = "v0.1.0";
const VERSION = "0.1.0";
const SHA = "a".repeat(40);

const fakeGit = (overrides: Record<string, unknown> = {}) => ({
  ensureClean: async () => undefined,
  fetchReleaseRefs: async () => undefined,
  headSha: async () => SHA,
  isIncludedInDevelop: async () => true,
  localTagSha: async () => undefined,
  remoteTagSha: async () => undefined,
  createSignedTag: async () => undefined,
  verifySignedTag: async () => undefined,
  pushTag: async () => undefined,
  ...overrides
});

describe("release start automation / release 시작 자동화", () => {
  it("parses a normal and bootstrap release / 일반 release와 bootstrap release를 해석한다", () => {
    expect(parseReleaseStartArguments(["--tag", "v0.2.0"])).toEqual({ bootstrap: false, tag: "v0.2.0" });
    expect(parseReleaseStartArguments(["--bootstrap", "--tag", TAG])).toEqual({ bootstrap: true, tag: TAG });
  });

  it.each([
    ["missing tag", "tag 누락", []],
    ["duplicate tag", "중복 tag", ["--tag", TAG, "--tag", TAG]],
    ["duplicate bootstrap", "중복 bootstrap", ["--bootstrap", "--bootstrap", "--tag", TAG]],
    ["unknown option", "알 수 없는 option", ["--tag", TAG, "--force"]]
  ])("rejects invalid arguments: %s / 잘못된 인자를 거부한다: %s", (_english, _korean, argv) => {
    expect(() => parseReleaseStartArguments(argv)).toThrow(/Release|release|Unknown/u);
  });

  it("creates and verifies a signed tag for the release commit / release commit의 서명 tag를 생성하고 검증한다", async () => {
    const events: string[] = [];
    let localTag: string | undefined;
    const git = fakeGit({
      ensureClean: async () => { events.push("clean"); },
      fetchReleaseRefs: async () => { events.push("fetch"); },
      headSha: async () => { events.push("head"); return SHA; },
      isIncludedInDevelop: async () => { events.push("develop"); return true; },
      localTagSha: async () => { events.push("local"); return localTag; },
      remoteTagSha: async () => { events.push("remote"); return undefined; },
      createSignedTag: async () => { events.push("sign"); localTag = SHA; },
      verifySignedTag: async () => { events.push("verify"); }
    });

    await expect(prepareSignedReleaseTag({ tag: TAG, version: VERSION, git }))
      .resolves.toEqual({ remoteExists: false, sha: SHA, tag: TAG });
    expect(events).toEqual(["clean", "fetch", "head", "develop", "local", "remote", "sign", "verify", "local"]);
  });

  it("reuses an exact signed local and remote tag / 정확한 local·remote 서명 tag를 재사용한다", async () => {
    const events: string[] = [];
    const git = fakeGit({
      localTagSha: async () => SHA,
      remoteTagSha: async () => SHA,
      createSignedTag: async () => { events.push("sign"); },
      verifySignedTag: async () => { events.push("verify"); }
    });

    await expect(prepareSignedReleaseTag({ tag: TAG, version: VERSION, git }))
      .resolves.toEqual({ remoteExists: true, sha: SHA, tag: TAG });
    expect(events).toEqual(["verify"]);
  });

  it.each([
    ["commit outside develop", "develop 밖 commit", { isIncludedInDevelop: async () => false }, /origin\/develop/u],
    ["conflicting local tag", "충돌하는 local tag", { localTagSha: async () => "b".repeat(40) }, /Local release tag/u],
    ["conflicting remote tag", "충돌하는 remote tag", { remoteTagSha: async () => "b".repeat(40) }, /Remote release tag/u]
  ])("rejects an unsafe tag state: %s / 안전하지 않은 tag 상태를 거부한다: %s", async (_english, _korean, overrides, error) => {
    await expect(prepareSignedReleaseTag({ tag: TAG, version: VERSION, git: fakeGit(overrides) }))
      .rejects.toThrow(error);
  });

  it("publishes bootstrap packages before pushing the tag / bootstrap package를 배포한 뒤 tag를 push한다", async () => {
    const events: string[] = [];
    const git = fakeGit({ pushTag: async () => { events.push("push"); } });

    await expect(runReleaseStart({
      argv: ["--tag", TAG, "--bootstrap"],
      root: "/release",
      readVersion: async () => VERSION,
      verifyCandidate: async () => { events.push("check"); },
      prepareTag: async () => { events.push("tag"); return { remoteExists: false, sha: SHA, tag: TAG }; },
      publish: async () => { events.push("publish"); },
      git
    })).resolves.toMatchObject({ bootstrap: true, pushed: true });
    expect(events).toEqual(["check", "tag", "publish", "push"]);
  });

  it("pushes a later tag and leaves publishing to the workflow / 후속 tag를 push하고 publish는 workflow에 맡긴다", async () => {
    const events: string[] = [];
    const git = fakeGit({ pushTag: async () => { events.push("push"); } });

    await expect(runReleaseStart({
      argv: ["--tag", "v0.2.0"],
      root: "/release",
      readVersion: async () => "0.2.0",
      verifyCandidate: async () => { events.push("check"); },
      prepareTag: async () => { events.push("tag"); return { remoteExists: false, sha: SHA, tag: "v0.2.0" }; },
      publish: async () => { events.push("publish"); },
      git
    })).resolves.toMatchObject({ bootstrap: false, pushed: true });
    expect(events).toEqual(["check", "tag", "push"]);
  });

  it("does not push an exact existing remote tag / 정확히 존재하는 remote tag를 다시 push하지 않는다", async () => {
    const events: string[] = [];

    await expect(runReleaseStart({
      argv: ["--tag", "v0.2.0"],
      root: "/release",
      readVersion: async () => "0.2.0",
      verifyCandidate: async () => undefined,
      prepareTag: async () => ({ remoteExists: true, sha: SHA, tag: "v0.2.0" }),
      git: fakeGit({ pushTag: async () => { events.push("push"); } })
    })).resolves.toMatchObject({ pushed: false });
    expect(events).toEqual([]);
  });

  it("reserves bootstrap mode for v0.1.0 / bootstrap mode를 v0.1.0에만 허용한다", async () => {
    await expect(runReleaseStart({
      argv: ["--tag", "v0.2.0", "--bootstrap"],
      root: "/release",
      readVersion: async () => "0.2.0",
      verifyCandidate: async () => undefined,
      git: fakeGit()
    })).rejects.toThrow(/one-time v0\.1\.0/u);
  });

  it("uses explicit git argv without shell interpolation / shell 보간 없이 명시적인 git argv를 사용한다", async () => {
    const calls: Array<{ arguments_: string[]; inherited: boolean }> = [];
    const responses = [
      { stdout: "" },
      { stdout: "" },
      { stdout: `${SHA}\n` },
      { stdout: "" },
      { error: Object.assign(new Error("missing"), { code: 1 }) },
      { error: Object.assign(new Error("missing"), { code: 2 }) },
      { stdout: "" },
      { stdout: `${SHA}\n` }
    ];
    const run = async (_command: string, arguments_: string[]) => {
      calls.push({ arguments_, inherited: false });
      const response = responses.shift();
      if (response?.error) throw response.error;
      return response ?? { stdout: "" };
    };
    const runInherited = async (_command: string, arguments_: string[]) => {
      calls.push({ arguments_, inherited: true });
    };
    const git = createGitReleaseAdapter({ run, runInherited, command: "git", cwd: "/release" });

    await expect(prepareSignedReleaseTag({ tag: TAG, version: VERSION, git })).resolves.toMatchObject({ tag: TAG });
    expect(calls.map(({ arguments_ }) => arguments_)).toContainEqual(["tag", "-s", "-m", `Release ${TAG}`, TAG, SHA]);
    expect(calls.map(({ arguments_ }) => arguments_)).toContainEqual(["verify-tag", TAG]);
  });
});
