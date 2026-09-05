import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { commandForPlatform, runCommand } from "./command-runner.mjs";
import { NPM_REGISTRY_URL, NPM_SCOPE_REGISTRY_ARGUMENT, PUBLIC_PACKAGE_SCOPE, PUBLIC_PACKAGES } from "./package-catalog.mjs";
import {
  createNpmRegistryAdapter,
  decidePublication,
  parseRemoteIntegrity,
  parseReleaseTag,
  publishRelease,
  runPublishCli
} from "./publish-packages.mjs";

const VERSION = "0.1.0";
const CORE_PACKAGE_NAME = `${PUBLIC_PACKAGE_SCOPE}/batch-core`;
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
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
const INTEGRITY = integrity(9);
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

const readRootVersion = async (root: string) => {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version?: unknown };

  if (typeof manifest.version !== "string") {
    throw new Error(`${root}: package.json must contain a string version.`);
  }

  return manifest.version;
};

const differentStableTag = (version: string) => version === "0.0.0" ? "v0.0.1" : "v0.0.0";

const createIsolatedPublishRepository = async (version: string) => {
  const root = await mkdtemp(join(tmpdir(), "nest-batch-publish-cli-test-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "scripts/release"), { recursive: true });

  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "nest-batch-publish-cli-test", version, private: true, type: "module", packageManager: "pnpm@10.34.5", scripts: { "release:publish": "node scripts/release/publish-packages.mjs" } }, null, 2)}\n`
  );

  await Promise.all([
    "command-runner.mjs",
    "pack-packages.mjs",
    "package-catalog.mjs",
    "package-entrypoints.mjs",
    "publish-packages.mjs"
  ].map((file) => copyFile(join(REPOSITORY_ROOT, "scripts/release", file), join(root, "scripts/release", file))));

  await Promise.all(PUBLIC_PACKAGES.map(async ({ directory, name }) => {
    await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, directory, "package.json"), `${JSON.stringify({ name, version }, null, 2)}\n`);
  }));

  return root;
};

const runPnpm = (cwd: string, arguments_: string[]) => new Promise<{ exitCode: number | null; stderr: string; stdout: string }>((resolve, reject) => {
  const child = spawn(commandForPlatform("pnpm"), ["run", ...arguments_], {
    cwd,
    env: {
      ...process.env,
      NPM_CONFIG_REGISTRY: "http://127.0.0.1:9",
      npm_config_registry: "http://127.0.0.1:9"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.once("error", reject);
  child.once("close", (exitCode) => {
    resolve({ exitCode, stderr, stdout });
  });
});

const expectForwardedTagMismatch = async (root: string, expectedVersion: string) => {
  const tag = differentStableTag(expectedVersion);
  const result = await runPnpm(root, ["release:publish", "--tag", tag]);
  const output = `${result.stdout}\n${result.stderr}`;

  expect(result.exitCode).toBe(1);
  expect(output).toContain(`Release tag ${tag} does not match expected version ${expectedVersion}.`);
  expect(output).not.toContain("Unknown publish argument");
  expect(output).not.toContain("npm view");
  expect(output).not.toContain("pnpm pack");
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("idempotent package publishing / 멱등 package 배포", () => {
  it.each([
    ["npm 11 scalar", "npm 11 scalar", JSON.stringify(INTEGRITY)],
    ["npm 12 one-element array", "npm 12 단일 원소 배열", JSON.stringify([INTEGRITY])]
  ])("parses a valid remote integrity shape: %s / 유효한 remote integrity 형태를 해석한다: %s", (_english, _korean, stdout) => {
    expect(parseRemoteIntegrity(stdout, CORE_PACKAGE_NAME, VERSION)).toBe(INTEGRITY);
  });

  it.each([
    ["empty array", "빈 배열", []],
    ["multiple values", "복수 값", [INTEGRITY, INTEGRITY]],
    ["non-string value", "문자열이 아닌 값", [42]],
    ["malformed integrity", "잘못된 integrity", ["sha512-not_base64!"]]
  ])("rejects an invalid npm 12 integrity shape: %s / 잘못된 npm 12 integrity 형태를 거부한다: %s", (_english, _korean, value) => {
    expect(() => parseRemoteIntegrity(JSON.stringify(value), CORE_PACKAGE_NAME, VERSION)).toThrow(/integrity|exactly one/u);
  });

  it("accepts only a matching stable release tag / 일치하는 stable release tag만 허용한다", () => {
    expect(parseReleaseTag("v0.1.0", VERSION)).toBe(VERSION);
  });

  it.each([
    ["rejects tag without v prefix", "v 접두사가 없는 tag를 거부한다", "0.1.0"],
    ["rejects incomplete tag", "불완전한 tag를 거부한다", "v0.1"],
    ["rejects leading-zero tag", "leading zero tag를 거부한다", "v01.1.0"],
    ["rejects prerelease tag", "prerelease tag를 거부한다", "v0.1.0-next.1"],
    ["rejects build-metadata tag", "build metadata tag를 거부한다", "v0.1.0+build.1"]
  ])("%s / %s", (_englishLabel, _koreanLabel, tag) => {
    expect(() => parseReleaseTag(tag, VERSION)).toThrow(/stable SemVer/u);
  });

  it("rejects a tag version mismatch / tag와 package version 불일치를 거부한다", () => {
    expect(() => parseReleaseTag("v0.2.0", VERSION)).toThrow(/does not match/u);
  });

  it("forwards a mismatched tag through pnpm before pack or registry access / pnpm이 불일치 tag를 pack이나 registry 접근 전에 전달한다", async () => {
    const publishWorkflow = parseDocument(
      await readFile(join(REPOSITORY_ROOT, ".github/workflows/publish.yml"), "utf8"),
      { version: "1.2" }
    ).toJS() as { jobs: { publish: { steps: Array<{ name?: string; run?: string }> } } };
    const publishStep = publishWorkflow.jobs.publish.steps.find(({ name }) => name === "Publish packages");

    expect(publishStep?.run).toBe("pnpm run release:publish --tag \"$GITHUB_REF_NAME\"");

    await expectForwardedTagMismatch(REPOSITORY_ROOT, await readRootVersion(REPOSITORY_ROOT));
  });

  it("forwards a mismatched tag from an isolated 0.2.0 release copy / 격리된 0.2.0 릴리즈 복사본에서 불일치 tag를 전달한다", async () => {
    const root = await createIsolatedPublishRepository("0.2.0");

    await expect(readRootVersion(root)).resolves.toBe("0.2.0");
    await expectForwardedTagMismatch(root, "0.2.0");
  });

  it("skips the same published tarball / 같은 tarball이 이미 배포되면 건너뛴다", () => {
    expect(decidePublication(integrity(1), integrity(1))).toBe("skip");
  });

  it("publishes a missing tarball / registry에 없는 tarball을 배포한다", () => {
    expect(decidePublication(integrity(1))).toBe("publish");
  });

  it.each([
    ["rejects bad-alphabet local SRI", "잘못된 alphabet local SRI를 거부한다", "sha512-not_base64!"],
    ["rejects short local SRI", "길이가 짧은 local SRI를 거부한다", `sha512-${Buffer.alloc(63, 1).toString("base64")}`],
    ["rejects multiple-token local SRI", "multiple token local SRI를 거부한다", `${integrity(1)} ${integrity(2)}`]
  ])("%s / %s", (_englishLabel, _koreanLabel, malformedIntegrity) => {
    expect(() => decidePublication(malformedIntegrity)).toThrow(/integrity/u);
  });

  it.each([
    ["rejects bad-alphabet remote SRI", "잘못된 alphabet remote SRI를 거부한다", "sha512-not_base64!"],
    ["rejects long remote SRI", "길이가 긴 remote SRI를 거부한다", `sha512-${Buffer.alloc(65, 1).toString("base64")}`],
    ["rejects multiple-token remote SRI", "multiple token remote SRI를 거부한다", `${integrity(1)} ${integrity(2)}`]
  ])("%s / %s", (_englishLabel, _koreanLabel, malformedIntegrity) => {
    expect(() => decidePublication(integrity(1), malformedIntegrity)).toThrow(/integrity/u);
  });

  it("publishes and confirms missing artifacts in exact catalog order / 없는 artifact를 정확한 catalog 순서로 배포하고 확인한다", async () => {
    const fixture = await createFixture();
    const { registry, events } = registryFrom();

    await expect(publish(fixture, registry)).resolves.toEqual({ published: catalogNames(), skipped: [] });

    expect(events).toEqual([
      ...catalogNames().map(lookupEvent),
      ...catalogNames().map(publishEvent),
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
      ...catalogNames().map(lookupEvent),
      ...catalogNames().slice(2).map(publishEvent),
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
      ...catalogNames().map(lookupEvent),
      ...catalogNames().map(publishEvent),
      ...Array.from({ length: 6 }).flatMap(() => catalogNames().map(lookupEvent))
    ]);
    expect(sleeps).toEqual([5_000, 5_000, 5_000, 5_000, 5_000]);
  });

  it("confirms delayed registry visibility on the second attempt / 두 번째 확인에서 지연된 registry 반영을 확인한다", async () => {
    const fixture = await createFixture();
    const events: string[] = [];
    const sleeps: number[] = [];
    let lookupCount = 0;
    const registry = {
      lookupIntegrity: async (name: string, version: string) => {
        events.push(`lookup:${name}@${version}`);
        lookupCount += 1;

        if (lookupCount <= fixture.artifacts.length * 2) {
          return undefined;
        }

        return fixture.artifacts.find((artifact) => artifact.name === name)?.integrity;
      },
      publish: async (artifact: Artifact) => {
        events.push(`publish:${artifact.name}@${artifact.version}`);
      }
    };

    await expect(publish(fixture, registry, async (milliseconds: number) => {
      sleeps.push(milliseconds);
    })).resolves.toEqual({ published: catalogNames(), skipped: [] });
    expect(events).toEqual([
      ...catalogNames().map(lookupEvent),
      ...catalogNames().map(publishEvent),
      ...catalogNames().map(lookupEvent),
      ...catalogNames().map(lookupEvent)
    ]);
    expect(sleeps).toEqual([5_000]);
  });

  it("publishes nothing when the last artifact has different integrity / 마지막 artifact integrity가 다르면 아무 package도 배포하지 않는다", async () => {
    const fixture = await createFixture();
    const lastArtifact = fixture.artifacts.at(-1)!;
    const lookedUp: string[] = [];
    const published: string[] = [];
    const registry = {
      lookupIntegrity: async (name: string) => {
        lookedUp.push(name);
        return name === lastArtifact.name ? integrity(99) : undefined;
      },
      publish: async (artifact: Artifact) => {
        published.push(artifact.name);
      }
    };

    await expect(publish(fixture, registry)).rejects.toThrow(/integrity/u);
    expect(lookedUp).toEqual(catalogNames());
    expect(published).toEqual([]);
  });

  it("publishes nothing when the last artifact lookup fails / 마지막 artifact 조회가 실패하면 아무 package도 배포하지 않는다", async () => {
    const fixture = await createFixture();
    const lastArtifact = fixture.artifacts.at(-1)!;
    const lookupFailure = new Error("LAST_LOOKUP_FAILURE");
    const lookedUp: string[] = [];
    const published: string[] = [];
    const registry = {
      lookupIntegrity: async (name: string) => {
        lookedUp.push(name);

        if (name === lastArtifact.name) {
          throw lookupFailure;
        }

        return undefined;
      },
      publish: async (artifact: Artifact) => {
        published.push(artifact.name);
      }
    };

    await expect(publish(fixture, registry)).rejects.toBe(lookupFailure);
    expect(lookedUp).toEqual(catalogNames());
    expect(published).toEqual([]);
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
    expect(events).toEqual([
      ...catalogNames().map(lookupEvent),
      publishEvent(fixture.artifacts[0].name)
    ]);
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

  it("rejects a late artifact version mismatch before registry access / 뒤쪽 artifact version 불일치를 registry 접근 전에 거부한다", async () => {
    const fixture = await createFixture();
    fixture.artifacts.at(-1)!.version = "0.1.1";
    const events: string[] = [];
    const { registry } = registryFrom(new Map(), events);

    await expect(publish(fixture, registry)).rejects.toThrow(/artifact version/u);
    expect(events).toEqual([]);
  });

  it("rejects malformed late local integrity before registry access / 뒤쪽의 잘못된 local integrity를 registry 접근 전에 거부한다", async () => {
    const fixture = await createFixture();
    fixture.artifacts.at(-1)!.integrity = "sha512-not_base64!";
    const events: string[] = [];
    const { registry } = registryFrom(new Map(), events);

    await expect(publish(fixture, registry)).rejects.toThrow(/integrity/u);
    expect(events).toEqual([]);
  });

  it.each([
    ["rejects missing catalog artifact before registry access", "registry 접근 전에 누락된 catalog artifact를 거부한다", (fixture: Fixture) => fixture.artifacts.slice(1)],
    ["rejects duplicate catalog artifact before registry access", "registry 접근 전에 중복된 catalog artifact를 거부한다", (fixture: Fixture) => [fixture.artifacts[0], fixture.artifacts[0], ...fixture.artifacts.slice(2)]],
    ["rejects wrong catalog directory before registry access", "registry 접근 전에 잘못된 catalog directory를 거부한다", (fixture: Fixture) => fixture.artifacts.map((artifact, index) =>
      index === 0 ? { ...artifact, directory: "packages/nest" } : artifact
    )],
    ["rejects relative tarball before registry access", "registry 접근 전에 상대 tarball을 거부한다", (fixture: Fixture) => fixture.artifacts.map((artifact, index) =>
      index === 0 ? { ...artifact, tarball: "relative.tgz" } : artifact
    )],
    ["rejects traversal tarball before registry access", "registry 접근 전에 traversal tarball을 거부한다", (fixture: Fixture) => fixture.artifacts.map((artifact, index) =>
      index === 0 ? { ...artifact, tarball: `${fixture.root}/nested/../0.tgz` } : artifact
    )],
    ["rejects option-like tarball before registry access", "registry 접근 전에 option 형태 tarball을 거부한다", (fixture: Fixture) => fixture.artifacts.map((artifact, index) =>
      index === 0 ? { ...artifact, tarball: "--registry=https://attacker.invalid" } : artifact
    )]
  ])("%s / %s", async (_englishLabel, _koreanLabel, mutate) => {
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
      runLookup: async (...arguments_) => {
        commandCalls.push(arguments_);
        throw Object.assign(new Error("missing"), { code: "E404", statusCode: 404 });
      }
    });

    await expect(adapter.lookupIntegrity(CORE_PACKAGE_NAME, VERSION)).resolves.toBeUndefined();
    expect(commandCalls).toEqual([["npm", ["view", `${CORE_PACKAGE_NAME}@0.1.0`, "dist.integrity", "--json", "--registry", NPM_REGISTRY_URL, NPM_SCOPE_REGISTRY_ARGUMENT], expect.any(Object)]]);
  });

  it("classifies npm E404 stderr as missing / npm E404 stderr를 미배포로 처리한다", async () => {
    const adapter = createNpmRegistryAdapter({
      runLookup: async () => {
        throw Object.assign(new Error("missing"), { stderr: "npm error code E404\nnpm error 404 Not Found" });
      }
    });

    await expect(adapter.lookupIntegrity(CORE_PACKAGE_NAME, VERSION)).resolves.toBeUndefined();
  });

  it.each([
    ["propagates auth lookup failure", "인증 lookup 실패를 전파한다", Object.assign(new Error("unauthorized"), { stderr: "npm error code E401" })],
    ["propagates network lookup failure", "network lookup 실패를 전파한다", Object.assign(new Error("network"), { code: "ECONNRESET" })],
    ["propagates 404-like non-E404 lookup failure", "E404가 아닌 404 형태 lookup 실패를 전파한다", Object.assign(new Error("looks like 404"), { stderr: "npm error 404 but no E404 code" })]
  ])("%s / %s", async (_englishLabel, _koreanLabel, failure) => {
    const adapter = createNpmRegistryAdapter({ runLookup: async () => { throw failure; } });

    await expect(adapter.lookupIntegrity(CORE_PACKAGE_NAME, VERSION)).rejects.toBe(failure);
  });

  it("rejects malformed npm lookup JSON / 잘못된 npm 조회 JSON을 거부한다", async () => {
    const adapter = createNpmRegistryAdapter({ runLookup: async () => ({ stdout: "not-json" }) });

    await expect(adapter.lookupIntegrity(CORE_PACKAGE_NAME, VERSION)).rejects.toThrow(/invalid JSON/u);
  });

  it("rejects malformed npm lookup integrity / 잘못된 npm 조회 integrity를 거부한다", async () => {
    const adapter = createNpmRegistryAdapter({ runLookup: async () => ({ stdout: JSON.stringify("sha512-not_base64!") }) });

    await expect(adapter.lookupIntegrity(CORE_PACKAGE_NAME, VERSION)).rejects.toThrow(/integrity/u);
  });

  it("accepts an npm 12 one-element lookup array / npm 12 단일 원소 lookup 배열을 허용한다", async () => {
    const adapter = createNpmRegistryAdapter({
      runLookup: async () => ({ stdout: JSON.stringify([INTEGRITY]) })
    });

    await expect(adapter.lookupIntegrity(CORE_PACKAGE_NAME, VERSION)).resolves.toBe(INTEGRITY);
  });

  it("confirms published artifacts through npm 12 arrays after retry / 재시도 뒤 npm 12 배열로 배포 artifact를 확인한다", async () => {
    const fixture = await createFixture();
    const lookupCounts = new Map<string, number>();
    const publishCalls: string[] = [];
    const sleepCalls: number[] = [];
    const integrityByName = new Map(fixture.artifacts.map((artifact) => [artifact.name, artifact.integrity]));
    const adapter = createNpmRegistryAdapter({
      artifactRoot: fixture.root,
      runLookup: async (_command: string, arguments_: string[]) => {
        const packageReference = arguments_[1];
        const name = packageReference.slice(0, packageReference.lastIndexOf("@"));
        const count = (lookupCounts.get(name) ?? 0) + 1;
        lookupCounts.set(name, count);

        if (count === 1 || (name === CORE_PACKAGE_NAME && count === 2)) {
          throw Object.assign(new Error("missing"), { code: "E404" });
        }

        return { stdout: JSON.stringify([integrityByName.get(name)]) };
      },
      runPublish: async (_command: string, arguments_: string[]) => {
        publishCalls.push(arguments_.at(-1) ?? "");
      }
    });

    await expect(publish(fixture, adapter, async (milliseconds) => {
      sleepCalls.push(milliseconds);
    })).resolves.toEqual({ published: catalogNames(), skipped: [] });
    expect(publishCalls).toEqual(fixture.artifacts.map(({ tarball }) => tarball));
    expect(sleepCalls).toEqual([5_000]);
    expect(lookupCounts.get(CORE_PACKAGE_NAME)).toBe(3);
  });

  it("uses buffered lookup and inherited publish runners with the public registry / 조회와 배포에 각각 buffered 및 inherited runner와 public registry를 사용한다", async () => {
    const fixture = await createFixture();
    const lookupCalls: unknown[][] = [];
    const publishCalls: unknown[][] = [];
    const adapter = createNpmRegistryAdapter({
      artifactRoot: fixture.root,
      runLookup: async (...arguments_) => {
        lookupCalls.push(arguments_);
        return { stdout: JSON.stringify(fixture.artifacts[0].integrity) };
      },
      runPublish: async (...arguments_) => {
        publishCalls.push(arguments_);
      }
    });

    await expect(adapter.lookupIntegrity(CORE_PACKAGE_NAME, VERSION)).resolves.toBe(fixture.artifacts[0].integrity);
    await adapter.publish(fixture.artifacts[0]);
    expect(lookupCalls).toEqual([["npm", ["view", `${CORE_PACKAGE_NAME}@0.1.0`, "dist.integrity", "--json", "--registry", NPM_REGISTRY_URL, NPM_SCOPE_REGISTRY_ARGUMENT], expect.objectContaining({ maxBuffer: expect.any(Number) })]]);
    expect(publishCalls).toEqual([["npm", ["publish", "--access", "public", "--registry", NPM_REGISTRY_URL, NPM_SCOPE_REGISTRY_ARGUMENT, "--", fixture.artifacts[0].tarball], expect.not.objectContaining({ maxBuffer: expect.anything() })]]);
    const arguments_ = lookupCalls[0][1] as string[];
    const previousScopeRegistryArgument = `--${["@nest", "batch"].join("-")}:registry=${NPM_REGISTRY_URL}`;

    expect(NPM_SCOPE_REGISTRY_ARGUMENT).toBe("--@rvkang:registry=https://registry.npmjs.org/");
    expect(arguments_).toContain(NPM_SCOPE_REGISTRY_ARGUMENT);
    expect(arguments_).not.toContain(previousScopeRegistryArgument);
  });

  it("overrides a hostile ambient scoped registry through real npm resolution / 실제 npm 해석에서 hostile ambient scoped registry를 덮어쓴다", async () => {
    const { stdout } = await runCommand(commandForPlatform("npm"), [
      "config",
      "get",
      `${PUBLIC_PACKAGE_SCOPE}:registry`,
      "--registry",
      NPM_REGISTRY_URL,
      NPM_SCOPE_REGISTRY_ARGUMENT
    ], {
      cwd: REPOSITORY_ROOT,
      env: {
        ...process.env,
        "npm_config_@rvkang:registry": "http://127.0.0.1:9/"
      }
    });

    expect(stdout.trim()).toBe(NPM_REGISTRY_URL);
  });

  it("rejects an option-like tarball in the npm adapter before command execution / npm adapter에서 option 형태 tarball을 명령 실행 전에 거부한다", async () => {
    const fixture = await createFixture();
    const commandCalls: unknown[][] = [];
    const adapter = createNpmRegistryAdapter({
      artifactRoot: fixture.root,
      runPublish: async (...arguments_) => {
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
    ["rejects missing tag before temporary directory creation", "temporary directory 생성 전에 누락된 tag를 거부한다", [], {}],
    ["rejects unknown argument before temporary directory creation", "temporary directory 생성 전에 알 수 없는 argument를 거부한다", ["--other"], {}],
    ["rejects duplicate tag before temporary directory creation", "temporary directory 생성 전에 중복된 tag를 거부한다", ["--tag", "v0.1.0", "--tag", "v0.1.0"], {}],
    ["rejects missing tag value before temporary directory creation", "temporary directory 생성 전에 누락된 tag 값을 거부한다", ["--tag"], {}]
  ])("%s / %s", async (_englishLabel, _koreanLabel, argv, environment) => {
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

  it.each([
    ["rejects prerelease tag before any CLI side effect", "CLI 부작용 전에 prerelease tag를 거부한다", ["--tag", "v0.1.0-next.1"]],
    ["rejects tag and root version mismatch before any CLI side effect", "CLI 부작용 전에 tag와 root version 불일치를 거부한다", ["--tag", "v0.1.1"]]
  ])("%s / %s", async (_englishLabel, _koreanLabel, argv) => {
    const effects: string[] = [];
    const registry = {
      lookupIntegrity: async () => {
        effects.push("lookup");
        return undefined;
      },
      publish: async () => {
        effects.push("publish");
      }
    };

    await expect(runPublishCli({
      argv,
      rootVersion: VERSION,
      createTemporaryDirectory: async () => {
        effects.push("temporary-directory");
        return "/tmp/unreachable";
      },
      pack: async () => {
        effects.push("pack");
        return [];
      },
      registry,
      sleep: async () => undefined
    })).rejects.toThrow();
    expect(effects).toEqual([]);
  });

  it.each([
    ["cleans temporary directory after pack failure", "pack 실패 뒤 temporary directory를 정리한다", "pack"],
    ["cleans temporary directory after lookup failure", "lookup 실패 뒤 temporary directory를 정리한다", "lookup"],
    ["cleans temporary directory after publish failure", "publish 실패 뒤 temporary directory를 정리한다", "publish"],
    ["cleans temporary directory after confirmation failure", "confirmation 실패 뒤 temporary directory를 정리한다", "confirmation"]
  ])("%s / %s", async (_englishLabel, _koreanLabel, failurePoint) => {
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
    });

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
