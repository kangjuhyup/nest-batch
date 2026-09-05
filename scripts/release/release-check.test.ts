import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PUBLIC_PACKAGE_SCOPE, PUBLIC_PACKAGES } from "./package-catalog.mjs";
import { cleanupReleaseBuildInfo, cleanupReleaseOutputs, releaseBuildInfoTargets, releaseOutputTargets, runReleaseCheck } from "./release-check.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const writeJson = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

const createProject = async (root: string, directory: string, tsBuildInfoFile: string) => {
  await writeJson(join(root, directory, "tsconfig.json"), {
    compilerOptions: { tsBuildInfoFile }
  });
};

const createReleaseFixture = async (root: string) => {
  await writeJson(join(root, "tsconfig.json"), {
    references: [
      { path: "./examples/basic" },
      { path: "./examples/nestjs" }
    ]
  });

  for (const packageInfo of PUBLIC_PACKAGES) {
    await createProject(root, packageInfo.directory, ".tsbuildinfo/tsconfig.tsbuildinfo");
  }

  await createProject(root, "examples/basic", "dist/.tsbuildinfo");
  await createProject(root, "examples/nestjs", "dist/.tsbuildinfo");
};

const createBuildInfoArtifacts = async (root: string, targets: readonly string[]) => {
  await Promise.all(targets.map(async (target) => {
    const pathFromRoot = relative(root, target);

    if (pathFromRoot.startsWith("packages/")) {
      await mkdir(target, { recursive: true });
      await writeFile(join(target, "tsconfig.tsbuildinfo"), "metadata\n");
      return;
    }

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, "metadata\n");
  }));
};

describe("release check cleanup / release check 정리", () => {
  it("removes catalog build metadata after a command fails / 명령 실패 후 catalog build metadata를 제거한다", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "nest-batch-release-check-test-"));
    temporaryRoots.push(repositoryRoot);
    await createReleaseFixture(repositoryRoot);
    const buildInfoTargets = await releaseBuildInfoTargets(repositoryRoot);

    await createBuildInfoArtifacts(repositoryRoot, buildInfoTargets);

    let attempts = 0;
    const failure = Object.assign(new Error("forced release command failure"), { code: 7 });

    await expect(runReleaseCheck({
      repositoryRoot,
      run: async () => {
        attempts += 1;
        throw failure;
      }
    })).rejects.toBe(failure);

    expect(attempts).toBe(1);
    await Promise.all(buildInfoTargets.map((target) => expect(access(target)).rejects.toThrow()));
  });

  it("removes catalog and root-reference build metadata after success / 성공 후 catalog와 root reference build metadata를 제거한다", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "nest-batch-release-check-test-"));
    temporaryRoots.push(repositoryRoot);
    await createReleaseFixture(repositoryRoot);
    const buildInfoTargets = await releaseBuildInfoTargets(repositoryRoot);

    const canonicalRepositoryRoot = await realpath(repositoryRoot);

    expect(buildInfoTargets.map((target) => relative(canonicalRepositoryRoot, target))).toEqual([
      ...PUBLIC_PACKAGES.map(({ directory }) => `${directory}/.tsbuildinfo`),
      "examples/basic/dist/.tsbuildinfo",
      "examples/nestjs/dist/.tsbuildinfo"
    ]);
    await createBuildInfoArtifacts(repositoryRoot, buildInfoTargets);

    const scripts: string[] = [];
    await runReleaseCheck({
      repositoryRoot,
      run: async (_command, [script]) => {
        scripts.push(script);
      }
    });

    expect(scripts).toEqual(["typecheck", "test", "build", "release:verify", "release:smoke"]);
    await Promise.all(buildInfoTargets.map((target) => expect(access(target)).rejects.toThrow()));
  });

  it("removes only catalog dist before the first release command / 첫 릴리즈 명령 전에 catalog dist만 제거한다", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "nest-batch-release-check-test-"));
    temporaryRoots.push(repositoryRoot);
    await createReleaseFixture(repositoryRoot);
    const outputTargets = await releaseOutputTargets(repositoryRoot);
    const adjacentSentinel = join(repositoryRoot, "packages/core/dist-backup/sentinel.txt");

    await Promise.all(outputTargets.map(async (target) => {
      await mkdir(target, { recursive: true });
      await writeFile(join(target, "stale-sentinel.js"), "stale\n");
    }));
    await mkdir(dirname(adjacentSentinel), { recursive: true });
    await writeFile(adjacentSentinel, "keep\n");

    let commands = 0;
    await runReleaseCheck({
      repositoryRoot,
      run: async () => {
        commands += 1;
        await Promise.all(outputTargets.map((target) => expect(access(join(target, "stale-sentinel.js"))).rejects.toThrow()));
        await expect(readFile(adjacentSentinel, "utf8")).resolves.toBe("keep\n");
      }
    });

    expect(commands).toBe(5);
    await expect(readFile(adjacentSentinel, "utf8")).resolves.toBe("keep\n");
  });

  it("produces the same fresh output digest with stale dist present / stale dist가 있어도 fresh output digest를 동일하게 만든다", async () => {
    const cleanRoot = await mkdtemp(join(tmpdir(), "nest-batch-release-check-clean-test-"));
    const staleRoot = await mkdtemp(join(tmpdir(), "nest-batch-release-check-stale-test-"));
    temporaryRoots.push(cleanRoot, staleRoot);
    await createReleaseFixture(cleanRoot);
    await createReleaseFixture(staleRoot);

    for (const packageInfo of PUBLIC_PACKAGES) {
      const dist = join(staleRoot, packageInfo.directory, "dist");
      await mkdir(dist, { recursive: true });
      await writeFile(join(dist, "removed-api.js"), "stale\n");
    }

    const buildAndDigest = async (repositoryRoot: string) => {
      await runReleaseCheck({
        repositoryRoot,
        run: async (_command, [script]) => {
          if (script !== "build") {
            return;
          }

          for (const packageInfo of PUBLIC_PACKAGES) {
            const dist = join(repositoryRoot, packageInfo.directory, "dist");
            await mkdir(dist, { recursive: true });
            await writeFile(join(dist, "index.js"), `export const packageName = ${JSON.stringify(packageInfo.name)};\n`);
          }
        }
      });

      const hash = createHash("sha512");
      for (const packageInfo of PUBLIC_PACKAGES) {
        const dist = join(repositoryRoot, packageInfo.directory, "dist");
        await expect(access(join(dist, "removed-api.js"))).rejects.toThrow();
        hash.update(await readFile(join(dist, "index.js")));
      }
      return hash.digest("base64");
    };

    await expect(buildAndDigest(staleRoot)).resolves.toBe(await buildAndDigest(cleanRoot));
  });

  it.each([
    ["../outside", "traversal"],
    ["/tmp/nest-batch-release-check-outside", "absolute path"],
    [".", "dot path"],
    ["", "empty path"]
  ])("rejects an unsafe catalog directory %s / %s를 거부하고 외부 sentinel을 보존한다", async (directory) => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "nest-batch-release-check-test-"));
    const externalRoot = await mkdtemp(join(tmpdir(), "nest-batch-release-check-external-"));
    temporaryRoots.push(repositoryRoot, externalRoot);
    const sentinel = join(externalRoot, "sentinel.txt");
    await writeFile(sentinel, "keep\n");

    await expect(cleanupReleaseBuildInfo(repositoryRoot, {
      publicPackages: [{ name: `${PUBLIC_PACKAGE_SCOPE}/core`, directory }]
    })).rejects.toThrow(/invalid public package directory/u);

    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep\n");
  });

  it("rejects a symlinked package directory / symlinked package directory를 거부하고 외부 sentinel을 보존한다", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "nest-batch-release-check-test-"));
    const externalRoot = await mkdtemp(join(tmpdir(), "nest-batch-release-check-external-"));
    temporaryRoots.push(repositoryRoot, externalRoot);
    const sentinel = join(externalRoot, ".tsbuildinfo", "sentinel.txt");
    await mkdir(dirname(sentinel), { recursive: true });
    await writeFile(sentinel, "keep\n");
    await mkdir(join(repositoryRoot, "packages"), { recursive: true });
    await symlink(externalRoot, join(repositoryRoot, "packages", "core"), "dir");

    await expect(cleanupReleaseBuildInfo(repositoryRoot, {
      publicPackages: [{ name: `${PUBLIC_PACKAGE_SCOPE}/core`, directory: "packages/core" }]
    })).rejects.toThrow(/symbolic link/u);

    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep\n");
  });

  it("rejects a symlinked dist directory / symlinked dist directory를 거부하고 외부 sentinel을 보존한다", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "nest-batch-release-check-test-"));
    const externalRoot = await mkdtemp(join(tmpdir(), "nest-batch-release-check-external-"));
    temporaryRoots.push(repositoryRoot, externalRoot);
    const sentinel = join(externalRoot, "sentinel.txt");
    await writeFile(sentinel, "keep\n");
    await createProject(repositoryRoot, "packages/core", ".tsbuildinfo/tsconfig.tsbuildinfo");
    await symlink(externalRoot, join(repositoryRoot, "packages", "core", "dist"), "dir");

    await expect(cleanupReleaseOutputs(repositoryRoot, {
      publicPackages: [{ name: `${PUBLIC_PACKAGE_SCOPE}/core`, directory: "packages/core" }]
    })).rejects.toThrow(/symbolic link/u);

    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep\n");
  });

  it("rejects a symlinked build-info directory / symlinked build-info directory를 거부하고 외부 sentinel을 보존한다", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "nest-batch-release-check-test-"));
    const externalRoot = await mkdtemp(join(tmpdir(), "nest-batch-release-check-external-"));
    temporaryRoots.push(repositoryRoot, externalRoot);
    await writeJson(join(repositoryRoot, "tsconfig.json"), { references: [] });
    await createProject(repositoryRoot, "packages/core", ".tsbuildinfo/tsconfig.tsbuildinfo");
    const sentinel = join(externalRoot, "sentinel.txt");
    await writeFile(sentinel, "keep\n");
    await symlink(externalRoot, join(repositoryRoot, "packages", "core", ".tsbuildinfo"), "dir");

    await expect(cleanupReleaseBuildInfo(repositoryRoot, {
      publicPackages: [{ name: `${PUBLIC_PACKAGE_SCOPE}/core`, directory: "packages/core" }]
    })).rejects.toThrow(/symbolic link/u);

    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep\n");
  });
});
