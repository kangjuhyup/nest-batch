import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PUBLIC_PACKAGES } from "./package-catalog.mjs";
import {
  createNpmRegistryAdapter,
  decidePublication,
  parseReleaseTag,
  publishRelease,
  runPublishCli
} from "./publish-packages.mjs";

const VERSION = "0.1.0";
const temporaryRoots: string[] = [];

type Artifact = {
  name: string;
  version: string;
  directory: string;
  tarball: string;
  integrity: string;
};

type Fixture = {
  root: string;
  artifacts: Artifact[];
};

const integrity = (value: number) => `sha512-${Buffer.alloc(64, value).toString("base64")}`;
const packageLabel = (name: string) => `${name}@${VERSION}`;
const lookupEvent = (name: string) => `lookup:${packageLabel(name)}`;
const publishEvent = (name: string) => `publish:${packageLabel(name)}`;
const catalogNames = () => PUBLIC_PACKAGES.map(({ name }) => name);

const createFixture = async (): Promise<Fixture> => {
  const root = await mkdtemp(join(tmpdir(), "nest-batch-publish-test-"));
  temporaryRoots.push(root);
  const artifacts = PUBLIC_PACKAGES.map((packageInfo, index) => ({
    name: packageInfo.name,
    version: VERSION,
    directory: packageInfo.directory,
    tarball: join(root, `${index}.tgz`),
    integrity: integrity(index)
  }));

  await Promise.all(artifacts.map((artifact) => writeFile(artifact.tarball, `${artifact.name}\n`)));
  return { root, artifacts };
};

const registryFrom = (remoteIntegrities = new Map<string, string>(), events: string[] = []) => ({
  events,
  registry: {
    lookupIntegrity: async (name: string, version: string) => {
      events.push(`lookup:${name}@${version}`);
      return remoteIntegrities.get(name);
    },
    publish: async (artifact: Artifact) => {
      events.push(`publish:${artifact.name}@${artifact.version}`);
      remoteIntegrities.set(artifact.name, artifact.integrity);
    }
  }
});

const publish = (fixture: Fixture, registry: ReturnType<typeof registryFrom>["registry"], sleep = async () => undefined) =>
  publishRelease({
    tag: "v0.1.0",
    rootVersion: VERSION,
    artifactRoot: fixture.root,
    artifacts: fixture.artifacts,
    registry,
    sleep
  });

const captureError = async (operation: () => Promise<unknown>) => {
  try {
    await operation();
  } catch (error) {
    return error;
  }

  throw new Error("Expected operation to fail.");
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("idempotent package publishing / 멱등 package 배포", () => {
  it("accepts only a matching stable release tag / 일치하는 stable release tag만 허용한다", () => {
    expect(parseReleaseTag("v0.1.0", VERSION)).toBe(VERSION);
  });

  it.each(["0.1.0", "v0.1", "v01.1.0", "v0.1.0-next.1", "v0.1.0+build.1"])(
    "rejects a non-stable release tag %s / stable SemVer가 아닌 tag를 거부한다",
    (tag) => {
      expect(() => parseReleaseTag(tag, VERSION)).toThrow(/stable SemVer/u);
    }
  );

  it("rejects a tag version mismatch / tag와 package version 불일치를 거부한다", () => {
    expect(() => parseReleaseTag("v0.2.0", VERSION)).toThrow(/does not match/u);
  });

  it("skips the same published tarball / 같은 tarball이 이미 배포되면 건너뛴다", () => {
    expect(decidePublication(integrity(1), integrity(1))).toBe("skip");
  });

  it("publishes a missing tarball / registry에 없는 tarball을 배포한다", () => {
    expect(decidePublication(integrity(1))).toBe("publish");
  });

  it.each([
    "sha512-not_base64!",
    `sha512-${Buffer.alloc(63, 1).toString("base64")}`,
    `${integrity(1)} ${integrity(2)}`
  ])("rejects malformed local SRI %s / 잘못된 local SRI를 거부한다", (malformedIntegrity) => {
    expect(() => decidePublication(malformedIntegrity)).toThrow(/integrity/u);
  });

  it.each([
    "sha512-not_base64!",
    `sha512-${Buffer.alloc(65, 1).toString("base64")}`,
    `${integrity(1)} ${integrity(2)}`
  ])("rejects malformed remote SRI %s / 잘못된 remote SRI를 거부한다", (malformedIntegrity) => {
    expect(() => decidePublication(integrity(1), malformedIntegrity)).toThrow(/integrity/u);
  });

  it("publishes and confirms missing artifacts in exact catalog order / 없는 artifact를 정확한 catalog 순서로 배포하고 확인한다", async () => {
    const fixture = await createFixture();
    const { registry, events } = registryFrom();

    await expect(publish(fixture, registry)).resolves.toEqual({ published: catalogNames(), skipped: [] });

    expect(events).toEqual([
      ...catalogNames().flatMap((name) => [lookupEvent(name), publishEvent(name)]),
      ...catalogNames().map(lookupEvent)
    ]);
  });

  it("skips matching artifacts and publishes only the catalog-order partial retry remainder / 같은 artifact는 건너뛰고 부분 배포 나머지만 catalog 순서로 재시도한다", async () => {
    const fixture = await createFixture();
    const remote = new Map([
      [fixture.artifacts[0].name, fixture.artifacts[0].integrity],
      [fixture.artifacts[1].name, fixture.artifacts[1].integrity]
    ]);
    const { registry, events } = registryFrom(remote);

    await expect(publish(fixture, registry)).resolves.toEqual({
      published: catalogNames().slice(2),
      skipped: catalogNames().slice(0, 2)
    });

    expect(events).toEqual([
      lookupEvent(catalogNames()[0]),
      lookupEvent(catalogNames()[1]),
      ...catalogNames().slice(2).flatMap((name) => [lookupEvent(name), publishEvent(name)]),
      ...catalogNames().map(lookupEvent)
    ]);
  });

  it("rechecks every catalog artifact for exactly six missing confirmation attempts / 여섯 번의 미확인에서 모든 catalog artifact를 다시 조회한다", async () => {
    const fixture = await createFixture();
    const events: string[] = [];
    const sleeps: number[] = [];
    const registry = {
      lookupIntegrity: async (name: string, version: string) => {
        events.push(`lookup:${name}@${version}`);
        return undefined;
      },
      publish: async (artifact: Artifact) => {
        events.push(`publish:${artifact.name}@${artifact.version}`);
      }
    };

    await expect(publish(fixture, registry, async (milliseconds: number) => {
      sleeps.push(milliseconds);
    })).rejects.toThrow(/after 6 attempts/u);

    expect(events).toEqual([
      ...catalogNames().flatMap((name) => [lookupEvent(name), publishEvent(name)]),
      ...Array.from({ length: 6 }).flatMap(() => catalogNames().map(lookupEvent))
    ]);
    expect(sleeps).toEqual([5_000, 5_000, 5_000, 5_000, 5_000]);
  });

  it("stops before publishing an occupied different artifact / 다른 integrity로 점유된 artifact는 publish 전에 중단한다", async () => {
    const fixture = await createFixture();
    const events: string[] = [];
    const { registry } = registryFrom(new Map([[fixture.artifacts[0].name, integrity(99)]]), events);

    await expect(publish(fixture, registry)).rejects.toThrow(/integrity/u);
    expect(events).toEqual([lookupEvent(fixture.artifacts[0].name)]);
  });

  it("propagates lookup failures before publishing / 조회 실패를 publish 전에 전파한다", async () => {
    const fixture = await createFixture();
    const lookupFailure = new Error("NETWORK_LOOKUP_FAILURE");
    const events: string[] = [];
    const registry = {
      lookupIntegrity: async (name: string, version: string) => {
        events.push(`lookup:${name}@${version}`);
        throw lookupFailure;
      },
      publish: async () => {
        events.push("publish");
      }
    };

    await expect(publish(fixture, registry)).rejects.toBe(lookupFailure);
    expect(events).toEqual([lookupEvent(fixture.artifacts[0].name)]);
  });

  it("rejects malformed remote integrity before publishing / 잘못된 remote integrity를 publish 전에 거부한다", async () => {
    const fixture = await createFixture();
    const events: string[] = [];
    const { registry } = registryFrom(new Map([[fixture.artifacts[0].name, "sha512-not_base64!"]]), events);

    await expect(publish(fixture, registry)).rejects.toThrow(/integrity/u);
    expect(events).toEqual([lookupEvent(fixture.artifacts[0].name)]);
  });

  it("stops subsequent publishing after a publish failure / publish 실패 뒤 후속 package 배포를 중단한다", async () => {
    const fixture = await createFixture();
    const publishFailure = new Error("PUBLISH_FAILURE");
    const events: string[] = [];
    const registry = {
      lookupIntegrity: async (name: string, version: string) => {
        events.push(`lookup:${name}@${version}`);
        return undefined;
      },
      publish: async (artifact: Artifact) => {
        events.push(`publish:${artifact.name}@${artifact.version}`);
        throw publishFailure;
      }
    };

    await expect(publish(fixture, registry)).rejects.toBe(publishFailure);
    expect(events).toEqual([lookupEvent(fixture.artifacts[0].name), publishEvent(fixture.artifacts[0].name)]);
  });

  it("stops confirmation on a different integrity / confirmation 중 다른 integrity가 확인되면 중단한다", async () => {
    const fixture = await createFixture();
    let lookupCount = 0;
    const sleeps: number[] = [];
    const registry = {
      lookupIntegrity: async () => {
        lookupCount += 1;
        return lookupCount <= fixture.artifacts.length ? undefined : integrity(99);
      },
      publish: async () => undefined
    };

    await expect(publish(fixture, registry, async (milliseconds: number) => {
      sleeps.push(milliseconds);
    })).rejects.toThrow(/integrity/u);
    expect(lookupCount).toBe(fixture.artifacts.length + 1);
    expect(sleeps).toEqual([]);
  });

  it("propagates a confirmation lookup failure immediately / confirmation 조회 실패를 즉시 전파한다", async () => {
    const fixture = await createFixture();
    let lookupCount = 0;
    const confirmationFailure = new Error("CONFIRMATION_LOOKUP_FAILURE");
    const registry = {
      lookupIntegrity: async () => {
        lookupCount += 1;
        if (lookupCount <= fixture.artifacts.length) {
          return undefined;
        }

        throw confirmationFailure;
      },
      publish: async () => undefined
    };

    await expect(publish(fixture, registry)).rejects.toBe(confirmationFailure);
    expect(lookupCount).toBe(fixture.artifacts.length + 1);
  });

  it.each([
    ["missing catalog artifact", (fixture: Fixture) => fixture.artifacts.slice(1)],
    ["duplicate catalog artifact", (fixture: Fixture) => [fixture.artifacts[0], fixture.artifacts[0], ...fixture.artifacts.slice(2)]],
    ["wrong catalog directory", (fixture: Fixture) => fixture.artifacts.map((artifact, index) =>
      index === 0 ? { ...artifact, directory: "packages/nest" } : artifact
    )],
    ["relative tarball", (fixture: Fixture) => fixture.artifacts.map((artifact, index) =>
      index === 0 ? { ...artifact, tarball: "relative.tgz" } : artifact
    )],
    ["non-canonical traversal tarball", (fixture: Fixture) => fixture.artifacts.map((artifact, index) =>
      index === 0 ? { ...artifact, tarball: `${fixture.root}/nested/../0.tgz` } : artifact
    )],
    ["leading-hyphen tarball", (fixture: Fixture) => fixture.artifacts.map((artifact, index) =>
      index === 0 ? { ...artifact, tarball: "--registry=https://attacker.invalid" } : artifact
    )]
  ])("rejects %s before registry access / registry 접근 전에 %s를 거부한다", async (_label, mutate) => {
    const fixture = await createFixture();
    const events: string[] = [];
    const { registry } = registryFrom(new Map(), events);

    await expect(publishRelease({
      tag: "v0.1.0",
      rootVersion: VERSION,
      artifactRoot: fixture.root,
      artifacts: mutate(fixture),
      registry,
      sleep: async () => undefined
    })).rejects.toThrow();
    expect(events).toEqual([]);
  });

  it("rejects an outside-root tarball before registry access / root 밖 tarball을 registry 접근 전에 거부한다", async () => {
    const fixture = await createFixture();
    const outsideRoot = await mkdtemp(join(tmpdir(), "nest-batch-publish-outside-"));
    temporaryRoots.push(outsideRoot);
    const outsideTarball = join(outsideRoot, "outside.tgz");
    await writeFile(outsideTarball, "outside\n");
    const events: string[] = [];
    const { registry } = registryFrom(new Map(), events);
    fixture.artifacts[0] = { ...fixture.artifacts[0], tarball: outsideTarball };

    await expect(publish(fixture, registry)).rejects.toThrow(/artifact root|inside/u);
    expect(events).toEqual([]);
  });

  it("rejects a symlink tarball before registry access / symlink tarball을 registry 접근 전에 거부한다", async () => {
    const fixture = await createFixture();
    const outsideRoot = await mkdtemp(join(tmpdir(), "nest-batch-publish-outside-"));
    temporaryRoots.push(outsideRoot);
    const outsideTarball = join(outsideRoot, "outside.tgz");
    await writeFile(outsideTarball, "outside\n");
    await rm(fixture.artifacts[0].tarball);
    await symlink(outsideTarball, fixture.artifacts[0].tarball);
    const events: string[] = [];
    const { registry } = registryFrom(new Map(), events);

    await expect(publish(fixture, registry)).rejects.toThrow(/symbolic link|canonical/u);
    expect(events).toEqual([]);
  });

  it("rejects a non-regular tarball before registry access / regular file이 아닌 tarball을 registry 접근 전에 거부한다", async () => {
    const fixture = await createFixture();
    const directoryTarball = join(fixture.root, "directory.tgz");
    await rm(directoryTarball, { recursive: true, force: true });
    await mkdir(directoryTarball);
    const events: string[] = [];
    const { registry } = registryFrom(new Map(), events);
    fixture.artifacts[0] = { ...fixture.artifacts[0], tarball: directoryTarball };

    await expect(publish(fixture, registry)).rejects.toThrow(/regular file/u);
    expect(events).toEqual([]);
  });

  it("rejects a symlink-directory escape before registry access / symlink directory escape를 registry 접근 전에 거부한다", async () => {
    const fixture = await createFixture();
    const outsideRoot = await mkdtemp(join(tmpdir(), "nest-batch-publish-outside-"));
    temporaryRoots.push(outsideRoot);
    const outsideTarball = join(outsideRoot, "outside.tgz");
    await writeFile(outsideTarball, "outside\n");
    const escapedDirectory = join(fixture.root, "escaped");
    await symlink(outsideRoot, escapedDirectory, "dir");
    const events: string[] = [];
    const { registry } = registryFrom(new Map(), events);
    fixture.artifacts[0] = { ...fixture.artifacts[0], tarball: join(escapedDirectory, "outside.tgz") };

    await expect(publish(fixture, registry)).rejects.toThrow(/canonical|inside/u);
    expect(events).toEqual([]);
  });

  it("classifies only explicit npm 404 lookup errors as missing / 명시적인 npm 404 조회 오류만 미배포로 처리한다", async () => {
    const commandCalls: unknown[][] = [];
    const adapter = createNpmRegistryAdapter({
      run: async (...arguments_) => {
        commandCalls.push(arguments_);
        throw Object.assign(new Error("missing"), { code: "E404", statusCode: 404 });
      }
    });

    await expect(adapter.lookupIntegrity("@nest-batch/core", VERSION)).resolves.toBeUndefined();
    expect(commandCalls).toEqual([["npm", ["view", "@nest-batch/core@0.1.0", "dist.integrity", "--json"], expect.any(Object)]]);
  });

  it("classifies npm E404 stderr as missing / npm E404 stderr를 미배포로 처리한다", async () => {
    const adapter = createNpmRegistryAdapter({
      run: async () => {
        throw Object.assign(new Error("missing"), { stderr: "npm error code E404\nnpm error 404 Not Found" });
      }
    });

    await expect(adapter.lookupIntegrity("@nest-batch/core", VERSION)).resolves.toBeUndefined();
  });

  it.each([
    [Object.assign(new Error("unauthorized"), { stderr: "npm error code E401" })],
    [Object.assign(new Error("network"), { code: "ECONNRESET" })],
    [Object.assign(new Error("looks like 404"), { stderr: "npm error 404 but no E404 code" })]
  ])("propagates non-404 registry lookup failures / 404가 아닌 registry 조회 실패를 전파한다", async (failure) => {
    const adapter = createNpmRegistryAdapter({ run: async () => { throw failure; } });

    await expect(adapter.lookupIntegrity("@nest-batch/core", VERSION)).rejects.toBe(failure);
  });

  it("rejects malformed npm lookup JSON / 잘못된 npm 조회 JSON을 거부한다", async () => {
    const adapter = createNpmRegistryAdapter({ run: async () => ({ stdout: "not-json" }) });

    await expect(adapter.lookupIntegrity("@nest-batch/core", VERSION)).rejects.toThrow(/invalid JSON/u);
  });

  it("rejects malformed npm lookup integrity / 잘못된 npm 조회 integrity를 거부한다", async () => {
    const adapter = createNpmRegistryAdapter({ run: async () => ({ stdout: JSON.stringify("sha512-not_base64!") }) });

    await expect(adapter.lookupIntegrity("@nest-batch/core", VERSION)).rejects.toThrow(/integrity/u);
  });

  it("publishes through a hardened npm argv boundary / 강화된 npm argv 경계로 tarball을 배포한다", async () => {
    const fixture = await createFixture();
    const commandCalls: unknown[][] = [];
    const adapter = createNpmRegistryAdapter({
      artifactRoot: fixture.root,
      run: async (...arguments_) => {
        commandCalls.push(arguments_);
        return { stdout: "" };
      }
    });

    await adapter.publish(fixture.artifacts[0]);
    expect(commandCalls).toEqual([["npm", ["publish", "--access", "public", "--", fixture.artifacts[0].tarball], expect.any(Object)]]);
  });

  it("rejects an option-like tarball in the npm adapter before command execution / npm adapter에서 option 형태 tarball을 명령 실행 전에 거부한다", async () => {
    const fixture = await createFixture();
    const commandCalls: unknown[][] = [];
    const adapter = createNpmRegistryAdapter({
      artifactRoot: fixture.root,
      run: async (...arguments_) => {
        commandCalls.push(arguments_);
        return { stdout: "" };
      }
    });

    await expect(adapter.publish({ ...fixture.artifacts[0], tarball: "--registry=https://attacker.invalid" })).rejects.toThrow();
    expect(commandCalls).toEqual([]);
  });

  it("uses explicit --tag over a conflicting GITHUB_REF_NAME and wires the root script contract / explicit --tag가 충돌하는 GITHUB_REF_NAME보다 우선하고 root script 계약을 연결한다", async () => {
    const fixture = await createFixture();
    const { registry, events } = registryFrom();
    const cleanupCalls: string[] = [];
    const rootManifest = await import("../../package.json", { with: { type: "json" } });

    expect(rootManifest.default.scripts["release:publish"]).toBe("node scripts/release/publish-packages.mjs");
    await expect(runPublishCli({
      argv: ["--tag", "v0.1.0"],
      environment: { GITHUB_REF_NAME: "v9.9.9" },
      rootVersion: VERSION,
      createTemporaryDirectory: async () => fixture.root,
      removeTemporaryDirectory: async (directory: string) => {
        cleanupCalls.push(directory);
      },
      pack: async (directory: string) => {
        expect(directory).toBe(fixture.root);
        return fixture.artifacts;
      },
      registry,
      sleep: async () => undefined
    })).resolves.toEqual({ published: catalogNames(), skipped: [] });
    expect(events).toHaveLength(PUBLIC_PACKAGES.length * 3);
    expect(cleanupCalls).toEqual([fixture.root]);
  });

  it("uses GITHUB_REF_NAME when --tag is absent / --tag가 없으면 GITHUB_REF_NAME을 사용한다", async () => {
    const fixture = await createFixture();
    const { registry } = registryFrom();

    await expect(runPublishCli({
      argv: [],
      environment: { GITHUB_REF_NAME: "v0.1.0" },
      rootVersion: VERSION,
      createTemporaryDirectory: async () => fixture.root,
      removeTemporaryDirectory: async () => undefined,
      pack: async () => fixture.artifacts,
      registry,
      sleep: async () => undefined
    })).resolves.toEqual({ published: catalogNames(), skipped: [] });
  });

  it.each([
    ["missing tag", [], {}],
    ["unknown argument", ["--other"], {}],
    ["duplicate tag", ["--tag", "v0.1.0", "--tag", "v0.1.0"], {}],
    ["missing tag value", ["--tag"], {}]
  ])("rejects CLI %s before temporary directory creation / temporary directory 생성 전에 CLI %s를 거부한다", async (_label, argv, environment) => {
    let madeTemporaryDirectory = false;

    await expect(runPublishCli({
      argv,
      environment,
      rootVersion: VERSION,
      createTemporaryDirectory: async () => {
        madeTemporaryDirectory = true;
        return "/tmp/unreachable";
      },
      pack: async () => {
        throw new Error("unreachable");
      },
      registry: registryFrom().registry,
      sleep: async () => undefined
    })).rejects.toThrow();
    expect(madeTemporaryDirectory).toBe(false);
  });

  it.each(["pack", "lookup", "publish", "confirmation"])(
    "cleans the exact temporary directory after %s failure / %s 실패 뒤 정확한 temporary directory를 정리한다",
    async (failurePoint) => {
      const fixture = await createFixture();
      const cleanupCalls: string[] = [];
      const failure = new Error(`${failurePoint.toUpperCase()}_FAILURE`);
      let lookupCount = 0;
      const registry = {
        lookupIntegrity: async () => {
          lookupCount += 1;

          if (failurePoint === "lookup" || (failurePoint === "confirmation" && lookupCount > fixture.artifacts.length)) {
            throw failure;
          }

          return undefined;
        },
        publish: async () => {
          if (failurePoint === "publish") {
            throw failure;
          }
        }
      };

      await expect(runPublishCli({
        argv: ["--tag", "v0.1.0"],
        rootVersion: VERSION,
        createTemporaryDirectory: async () => fixture.root,
        removeTemporaryDirectory: async (directory: string) => {
          cleanupCalls.push(directory);
        },
        pack: async () => {
          if (failurePoint === "pack") {
            throw failure;
          }

          return fixture.artifacts;
        },
        registry,
        sleep: async () => undefined
      })).rejects.toBe(failure);
      expect(cleanupCalls).toEqual([fixture.root]);
    }
  );

  it("preserves the primary failure before cleanup failure / cleanup 실패보다 원래 실패를 보존한다", async () => {
    const fixture = await createFixture();
    const primaryFailure = new Error("PRIMARY_PACK_FAILURE");
    const cleanupFailure = new Error("CLEANUP_FAILURE");
    const error = await captureError(() => runPublishCli({
      argv: ["--tag", "v0.1.0"],
      rootVersion: VERSION,
      createTemporaryDirectory: async () => fixture.root,
      removeTemporaryDirectory: async () => {
        throw cleanupFailure;
      },
      pack: async () => {
        throw primaryFailure;
      },
      registry: registryFrom().registry,
      sleep: async () => undefined
    }));

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([primaryFailure, cleanupFailure]);
    expect((error as AggregateError).cause).toBe(primaryFailure);
  });

  it("preserves a mid-publish failure before cleanup failure / mid-publish 실패보다 cleanup 실패를 뒤에 보존한다", async () => {
    const fixture = await createFixture();
    const publishFailure = new Error("PRIMARY_PUBLISH_FAILURE");
    const cleanupFailure = new Error("CLEANUP_FAILURE");
    const registry = {
      lookupIntegrity: async () => undefined,
      publish: async () => {
        throw publishFailure;
      }
    };
    const error = await captureError(() => runPublishCli({
      argv: ["--tag", "v0.1.0"],
      rootVersion: VERSION,
      createTemporaryDirectory: async () => fixture.root,
      removeTemporaryDirectory: async () => {
        throw cleanupFailure;
      },
      pack: async () => fixture.artifacts,
      registry,
      sleep: async () => undefined
    }));

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([publishFailure, cleanupFailure]);
    expect((error as AggregateError).cause).toBe(publishFailure);
  });

  it("fails with cleanup failure when the primary operation succeeds / 원래 작업이 성공하면 cleanup 실패로 실패한다", async () => {
    const fixture = await createFixture();
    const cleanupFailure = new Error("CLEANUP_FAILURE");
    const { registry } = registryFrom();

    await expect(runPublishCli({
      argv: ["--tag", "v0.1.0"],
      rootVersion: VERSION,
      createTemporaryDirectory: async () => fixture.root,
      removeTemporaryDirectory: async () => {
        throw cleanupFailure;
      },
      pack: async () => fixture.artifacts,
      registry,
      sleep: async () => undefined
    })).rejects.toBe(cleanupFailure);
  });
});
