import { describe, expect, it } from "vitest";
import { PUBLIC_PACKAGES } from "./package-catalog.mjs";
import {
  createNpmRegistryAdapter,
  decidePublication,
  parseReleaseTag,
  publishRelease,
  runPublishCli
} from "./publish-packages.mjs";

const VERSION = "0.1.0";

const artifacts = () => PUBLIC_PACKAGES.map((packageInfo, index) => ({
  name: packageInfo.name,
  version: VERSION,
  directory: packageInfo.directory,
  tarball: `/tmp/${index}.tgz`,
  integrity: `sha512-${index}`
}));

const registryFrom = (remoteIntegrities = new Map<string, string>()) => {
  const lookupCalls: string[] = [];
  const publishCalls: string[] = [];

  return {
    lookupCalls,
    publishCalls,
    registry: {
      lookupIntegrity: async (name: string) => {
        lookupCalls.push(name);
        return remoteIntegrities.get(name);
      },
      publish: async (artifact: { name: string; integrity: string }) => {
        publishCalls.push(artifact.name);
        remoteIntegrities.set(artifact.name, artifact.integrity);
      }
    }
  };
};

describe("idempotent package publishing / 멱등 package 배포", () => {
  it("rejects a tag version mismatch / tag와 package version 불일치를 거부한다", () => {
    expect(() => parseReleaseTag("v0.2.0", VERSION)).toThrow(/does not match/u);
  });

  it.each(["0.1.0", "v0.1", "v01.1.0", "v0.1.0-next.1", "v0.1.0+build.1"])(
    "rejects a non-stable release tag %s / stable SemVer가 아닌 tag를 거부한다",
    (tag) => {
      expect(() => parseReleaseTag(tag, VERSION)).toThrow(/stable SemVer/u);
    }
  );

  it("skips the same published tarball / 같은 tarball이 이미 배포되면 건너뛴다", () => {
    expect(decidePublication("sha512-same", "sha512-same")).toBe("skip");
  });

  it("publishes a missing tarball / registry에 없는 tarball을 배포한다", () => {
    expect(decidePublication("sha512-local")).toBe("publish");
  });

  it("rejects an occupied version with different integrity / 다른 tarball의 같은 version을 거부한다", () => {
    expect(() => decidePublication("sha512-local", "sha512-remote")).toThrow(/integrity/u);
  });

  it("publishes missing artifacts in catalog order / 없는 artifact를 catalog 순서로 배포한다", async () => {
    const { registry, publishCalls } = registryFrom();

    await expect(publishRelease({
      tag: "v0.1.0",
      rootVersion: VERSION,
      artifacts: artifacts(),
      registry,
      sleep: async () => undefined
    })).resolves.toEqual({
      published: PUBLIC_PACKAGES.map(({ name }) => name),
      skipped: []
    });

    expect(publishCalls).toEqual(PUBLIC_PACKAGES.map(({ name }) => name));
  });

  it("skips matching artifacts and publishes only the partial retry remainder / 같은 artifact는 건너뛰고 부분 배포 나머지만 재시도한다", async () => {
    const allArtifacts = artifacts();
    const existing = new Map([
      [allArtifacts[0].name, allArtifacts[0].integrity],
      [allArtifacts[1].name, allArtifacts[1].integrity]
    ]);
    const { registry, publishCalls } = registryFrom(existing);

    await expect(publishRelease({
      tag: "v0.1.0",
      rootVersion: VERSION,
      artifacts: allArtifacts,
      registry,
      sleep: async () => undefined
    })).resolves.toEqual({
      published: PUBLIC_PACKAGES.slice(2).map(({ name }) => name),
      skipped: PUBLIC_PACKAGES.slice(0, 2).map(({ name }) => name)
    });

    expect(publishCalls).toEqual(PUBLIC_PACKAGES.slice(2).map(({ name }) => name));
  });

  it("rechecks all artifacts after a delayed publish / 지연된 publish 반영 후 모든 artifact를 다시 확인한다", async () => {
    const allArtifacts = artifacts();
    let lookupCount = 0;
    const sleeps: number[] = [];
    const registry = {
      lookupIntegrity: async (name: string) => {
        lookupCount += 1;
        return lookupCount <= allArtifacts.length * 2
          ? undefined
          : allArtifacts.find((artifact) => artifact.name === name)?.integrity;
      },
      publish: async () => undefined
    };

    await expect(publishRelease({
      tag: "v0.1.0",
      rootVersion: VERSION,
      artifacts: allArtifacts,
      registry,
      sleep: async (milliseconds: number) => {
        sleeps.push(milliseconds);
      }
    })).resolves.toEqual({
      published: PUBLIC_PACKAGES.map(({ name }) => name),
      skipped: []
    });

    expect(sleeps).toEqual([5_000]);
  });

  it("fails before publishing when a catalog artifact is occupied differently / catalog artifact의 integrity가 다르면 publish 전에 실패한다", async () => {
    const allArtifacts = artifacts();
    const { registry, publishCalls } = registryFrom(new Map([
      [allArtifacts[0].name, "sha512-different"]
    ]));

    await expect(publishRelease({
      tag: "v0.1.0",
      rootVersion: VERSION,
      artifacts: allArtifacts,
      registry,
      sleep: async () => undefined
    })).rejects.toThrow(/integrity/u);

    expect(publishCalls).toEqual([]);
  });

  it("rejects an artifact catalog order mismatch / artifact catalog 순서 불일치를 거부한다", async () => {
    const allArtifacts = artifacts();
    [allArtifacts[0], allArtifacts[1]] = [allArtifacts[1], allArtifacts[0]];
    const { registry, publishCalls } = registryFrom();

    await expect(publishRelease({
      tag: "v0.1.0",
      rootVersion: VERSION,
      artifacts: allArtifacts,
      registry,
      sleep: async () => undefined
    })).rejects.toThrow(/catalog order/u);

    expect(publishCalls).toEqual([]);
  });

  it("rejects an artifact version that differs from the tag and root / tag와 root와 다른 artifact version을 거부한다", async () => {
    const allArtifacts = artifacts();
    allArtifacts[3].version = "0.1.1";
    const { registry, publishCalls } = registryFrom();

    await expect(publishRelease({
      tag: "v0.1.0",
      rootVersion: VERSION,
      artifacts: allArtifacts,
      registry,
      sleep: async () => undefined
    })).rejects.toThrow(/artifact version/u);

    expect(publishCalls).toEqual([]);
  });

  it("fails after six missing confirmation attempts / 여섯 번의 미확인 후 실패한다", async () => {
    const sleeps: number[] = [];
    const registry = {
      lookupIntegrity: async () => undefined,
      publish: async () => undefined
    };

    await expect(publishRelease({
      tag: "v0.1.0",
      rootVersion: VERSION,
      artifacts: artifacts(),
      registry,
      sleep: async (milliseconds: number) => {
        sleeps.push(milliseconds);
      }
    })).rejects.toThrow(/after 6 attempts/u);

    expect(sleeps).toEqual([5_000, 5_000, 5_000, 5_000, 5_000]);
  });

  it("treats only npm 404 lookup errors as missing / npm 404 조회 오류만 미배포로 처리한다", async () => {
    const commandCalls: unknown[][] = [];
    const adapter = createNpmRegistryAdapter({
      run: async (...arguments_) => {
        commandCalls.push(arguments_);
        throw Object.assign(new Error("missing"), { stderr: "npm error code E404\nnpm error 404 Not Found" });
      }
    });

    await expect(adapter.lookupIntegrity("@nest-batch/core", VERSION)).resolves.toBeUndefined();
    expect(commandCalls).toEqual([["npm", ["view", "@nest-batch/core@0.1.0", "dist.integrity", "--json"], expect.any(Object)]]);
  });

  it("propagates npm auth and malformed lookup responses / npm 인증 오류와 잘못된 조회 응답을 전파한다", async () => {
    const unauthorized = createNpmRegistryAdapter({
      run: async () => {
        throw Object.assign(new Error("unauthorized"), { stderr: "npm error code E401" });
      }
    });
    const malformed = createNpmRegistryAdapter({ run: async () => ({ stdout: "not-json" }) });

    await expect(unauthorized.lookupIntegrity("@nest-batch/core", VERSION)).rejects.toThrow(/unauthorized/u);
    await expect(malformed.lookupIntegrity("@nest-batch/core", VERSION)).rejects.toThrow(/invalid JSON/u);
  });

  it("publishes through the npm adapter command / npm adapter 명령으로 tarball을 배포한다", async () => {
    const commandCalls: unknown[][] = [];
    const adapter = createNpmRegistryAdapter({
      run: async (...arguments_) => {
        commandCalls.push(arguments_);
        return { stdout: "" };
      }
    });

    await adapter.publish({ tarball: "/tmp/core.tgz" });
    expect(commandCalls).toEqual([["npm", ["publish", "/tmp/core.tgz", "--access", "public"], expect.any(Object)]]);
  });

  it("validates the command-line tag before packing or registry access / command-line tag를 pack과 registry 접근 전에 검증한다", async () => {
    let packed = false;
    let lookedUp = false;

    await expect(runPublishCli({
      argv: ["--tag", "v0.1.0-next.1"],
      rootVersion: VERSION,
      pack: async () => {
        packed = true;
        return artifacts();
      },
      registry: {
        lookupIntegrity: async () => {
          lookedUp = true;
          return undefined;
        },
        publish: async () => undefined
      },
      sleep: async () => undefined
    })).rejects.toThrow(/stable SemVer/u);

    expect(packed).toBe(false);
    expect(lookedUp).toBe(false);
  });

  it("uses GITHUB_REF_NAME when --tag is absent / --tag가 없으면 GITHUB_REF_NAME을 사용한다", async () => {
    const removed: string[] = [];
    const { registry } = registryFrom();

    await expect(runPublishCli({
      argv: [],
      environment: { GITHUB_REF_NAME: "v0.1.0" },
      rootVersion: VERSION,
      createTemporaryDirectory: async () => "/tmp/nest-batch-publish-test",
      removeTemporaryDirectory: async (directory: string) => {
        removed.push(directory);
      },
      pack: async () => artifacts(),
      registry,
      sleep: async () => undefined
    })).resolves.toEqual({
      published: PUBLIC_PACKAGES.map(({ name }) => name),
      skipped: []
    });

    expect(removed).toEqual(["/tmp/nest-batch-publish-test"]);
  });
});
