import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CORE_SUBPATHS, PUBLIC_PACKAGES } from "./package-catalog.mjs";
import { validateManifest } from "./verify-release.mjs";
import * as release from "./verify-release.mjs";

const REPOSITORY_URL = "https://github.com/kangjuhyup/nest-batch.git";
const HOMEPAGE = "https://github.com/kangjuhyup/nest-batch#readme";
const BUGS_URL = "https://github.com/kangjuhyup/nest-batch/issues";
const LICENSE_TEXT = "MIT License\n";
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const temporaryRoots: string[] = [];

function createRepository(
  mutatePackage?: (manifest: Record<string, unknown>, packageInfo: (typeof PUBLIC_PACKAGES)[number]) => void,
  licenseForPackage: (packageInfo: (typeof PUBLIC_PACKAGES)[number]) => string = () => LICENSE_TEXT
) {
  const root = mkdtempSync(join(tmpdir(), "nest-batch-release-test-"));
  temporaryRoots.push(root);

  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "nest-batch",
        version: "0.1.0",
        private: true,
        type: "module",
        license: "MIT",
        author: "kangjuhyup",
        repository: { type: "git", url: REPOSITORY_URL },
        homepage: HOMEPAGE,
        bugs: { url: BUGS_URL },
        engines: { node: ">=20.18.0" }
      },
      null,
      2
    )}\n`
  );
  writeFileSync(join(root, "LICENSE"), LICENSE_TEXT);

  for (const packageInfo of PUBLIC_PACKAGES) {
    const manifest: Record<string, unknown> = {
      name: packageInfo.name,
      version: "0.1.0",
      description: "Release fixture package",
      keywords: ["nest-batch", "fixture"],
      type: "module",
      license: "MIT",
      author: "kangjuhyup",
      repository: { type: "git", url: REPOSITORY_URL, directory: packageInfo.directory },
      homepage: HOMEPAGE,
      bugs: { url: BUGS_URL },
      engines: { node: ">=20.18.0" },
      files: ["dist", "src", "README.md", "LICENSE"],
      publishConfig: { access: "public" }
    };
    mutatePackage?.(manifest, packageInfo);
    const packageDirectory = join(root, packageInfo.directory);
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(join(packageDirectory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(packageDirectory, "LICENSE"), licenseForPackage(packageInfo));
  }

  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("release metadata validation / release metadata 검증", () => {
  it("defines exactly eight public packages / 공개 package를 정확히 8개 정의한다", () => {
    expect(PUBLIC_PACKAGES.map(({ name }) => name)).toEqual([
      "@nest-batch/core",
      "@nest-batch/nest",
      "@nest-batch/inmemory",
      "@nest-batch/postgres",
      "@nest-batch/mysql",
      "@nest-batch/mariadb",
      "@nest-batch/bullmq",
      "@nest-batch/cli"
    ]);
    expect(CORE_SUBPATHS).toEqual(["queue", "scheduler", "polling", "worker"]);
  });

  it("rejects missing public access / public access 누락을 거부한다", () => {
    expect(() => validateManifest({ name: "@nest-batch/core", version: "0.1.0" }, "packages/core"))
      .toThrow(/publishConfig\.access/);
  });

  it("reads JSON manifests / JSON manifest를 읽는다", () => {
    const root = createRepository();

    expect(release.readJson(join(root, "package.json"))).toMatchObject({ name: "nest-batch", version: "0.1.0" });
  });

  it("accepts a complete matching release repository / 완전히 일치하는 릴리즈 repository를 허용한다", () => {
    expect(() => release.verifyReleaseRepository(createRepository())).not.toThrow();
  });

  it("rejects a package version that differs from root / root와 다른 package version을 거부한다", () => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@nest-batch/core") {
        manifest.version = "0.1.1";
      }
    });

    expect(() => release.verifyReleaseRepository(root)).toThrow(/version.*0\.1\.0|0\.1\.0.*version/);
  });

  it("rejects a mismatched repository directory / repository directory 불일치를 거부한다", () => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@nest-batch/core") {
        manifest.repository = { type: "git", url: REPOSITORY_URL, directory: "packages/other" };
      }
    });

    expect(() => release.verifyReleaseRepository(root)).toThrow(/repository\.directory/);
  });

  it("rejects non-public package access / public이 아닌 package access를 거부한다", () => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@nest-batch/core") {
        manifest.publishConfig = { access: "restricted" };
      }
    });

    expect(() => release.verifyReleaseRepository(root)).toThrow(/publishConfig\.access/);
  });

  it("rejects a package LICENSE that differs from root / root와 다른 package LICENSE를 거부한다", () => {
    const root = createRepository(undefined, (packageInfo) =>
      packageInfo.name === "@nest-batch/core" ? "Different license\n" : LICENSE_TEXT
    );

    expect(() => release.verifyReleaseRepository(root)).toThrow(/LICENSE/);
  });

  it("verifies the checked-out release repository / 현재 checkout된 릴리즈 repository를 검증한다", () => {
    expect(() => release.verifyReleaseRepository(REPOSITORY_ROOT)).not.toThrow();
  });
});
