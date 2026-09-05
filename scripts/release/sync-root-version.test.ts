import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { PUBLIC_PACKAGES } from "./package-catalog.mjs";
import { syncRootVersion } from "./sync-root-version.mjs";

const execFile = promisify(execFileCallback);
const syncRootVersionScript = fileURLToPath(new URL("./sync-root-version.mjs", import.meta.url));

const createVersionFixture = async (packageVersions: readonly string[]): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "nest-batch-version-test-"));
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "fixture", private: true, version: "0.1.0", scripts: { test: "vitest" } }, null, 2)}\n`
  );

  await Promise.all(PUBLIC_PACKAGES.map(async (packageInfo, index) => {
    const directory = join(root, packageInfo.directory);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      `${JSON.stringify({ name: packageInfo.name, version: packageVersions[index] }, null, 2)}\n`
    );
  }));

  return root;
};

const readFixtureFile = (root: string, relativePath: string) => readFile(join(root, relativePath), "utf8");

describe("root version synchronization / root version 동기화", () => {
  it("syncs only the private root version with the fixed public package version / 고정 공개 package version으로 private root version만 동기화한다", async () => {
    const root = await createVersionFixture(PUBLIC_PACKAGES.map(() => "0.2.0"));
    const originalPackageManifest = await readFixtureFile(root, "packages/core/package.json");

    try {
      await expect(syncRootVersion(root)).resolves.toBe("0.2.0");
      await expect(readFixtureFile(root, "package.json")).resolves.toBe(
        `${JSON.stringify({ name: "fixture", private: true, version: "0.2.0", scripts: { test: "vitest" } }, null, 2)}\n`
      );
      await expect(readFixtureFile(root, "packages/core/package.json")).resolves.toBe(originalPackageManifest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects divergent public package versions / 서로 다른 공개 package version을 거부한다", async () => {
    const versions = PUBLIC_PACKAGES.map(() => "0.2.0");
    versions[versions.length - 1] = "0.2.1";
    const root = await createVersionFixture(versions);

    try {
      await expect(syncRootVersion(root)).rejects.toThrow(/fixed version/u);
      await expect(readFixtureFile(root, "package.json")).resolves.toContain('"version": "0.1.0"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an invalid fixed public package version / 유효하지 않은 고정 공개 package version을 거부한다", async () => {
    const root = await createVersionFixture(PUBLIC_PACKAGES.map(() => "0.2"));

    try {
      await expect(syncRootVersion(root)).rejects.toThrow(/valid fixed version/u);
      await expect(readFixtureFile(root, "package.json")).resolves.toContain('"version": "0.1.0"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs from the fixture directory when executed directly / 직접 실행 시 fixture directory를 기준으로 동작한다", async () => {
    const root = await createVersionFixture(PUBLIC_PACKAGES.map(() => "0.2.0"));

    try {
      const { stdout } = await execFile(process.execPath, [syncRootVersionScript], { cwd: root });

      expect(stdout).toContain("0.2.0");
      await expect(readFixtureFile(root, "package.json")).resolves.toContain('"version": "0.2.0"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
