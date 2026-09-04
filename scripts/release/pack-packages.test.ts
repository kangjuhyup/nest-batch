import { describe, expect, it } from "vitest";
import { NPM_REGISTRY_URL, PUBLIC_PACKAGES, REPOSITORY_URL } from "./package-catalog.mjs";
import { validatePackedFiles, validatePackedManifest } from "./pack-packages.mjs";

const packedManifest = (packageInfo = PUBLIC_PACKAGES[1]) => ({
  name: packageInfo.name,
  version: "0.1.0",
  repository: { type: "git", url: REPOSITORY_URL, directory: packageInfo.directory },
  engines: { node: ">=20.18.0" },
  publishConfig: { access: "public", registry: NPM_REGISTRY_URL },
  dependencies: { "@nest-batch/core": "0.1.0" }
});

describe("package tarball validation / package tarball 검증", () => {
  it("accepts release files / 배포 대상 파일만 허용한다", () => {
    expect(() => validatePackedFiles({
      name: "@nest-batch/core",
      files: [
        "dist/index.js",
        "dist/index.d.ts",
        "dist/index.js.map",
        "src/index.ts",
        "README.md",
        "LICENSE",
        "package.json"
      ]
    })).not.toThrow();
  });

  it("rejects build metadata / build metadata 포함을 거부한다", () => {
    expect(() => validatePackedFiles({
      name: "@nest-batch/core",
      files: ["dist/index.js", "dist/.tsbuildinfo", "README.md", "LICENSE", "package.json"]
    })).toThrow(/tsbuildinfo/u);
  });

  it.each([
    ["test/runner.test.js", /test/u],
    ["src/.env", /\.env/u],
    ["dist/.npmrc", /npmrc/u],
    ["dist/signing-key.pem", /certificate|key/u],
    ["scripts/release.mjs", /not allowed/u]
  ])("rejects forbidden path %s / 금지된 경로를 거부한다", (path, expectedError) => {
    expect(() => validatePackedFiles({
      name: "@nest-batch/core",
      files: ["dist/index.js", path, "README.md", "LICENSE", "package.json"]
    })).toThrow(expectedError);
  });

  it.each([
    ["", "empty path"],
    [".", "dot path"],
    ["..", "dot-dot path"],
    ["./dist/index.js", "leading dot segment"],
    ["dist/./index.js", "nested dot segment"],
    ["dist/../secrets.txt", "dist traversal"],
    ["src/a/../../secrets.txt", "src traversal"],
    ["/dist/index.js", "absolute path"],
    ["dist//index.js", "empty nested segment"],
    ["dist\\index.js", "backslash separator"],
    ["dist/\u0000index.js", "NUL byte"]
  ])("rejects non-canonical path %s / %s를 거부한다", (path) => {
    expect(() => validatePackedFiles({
      name: "@nest-batch/core",
      files: ["dist/index.js", path, "README.md", "LICENSE", "package.json"]
    })).toThrow(/canonical POSIX relative path/u);
  });

  it("rejects an invalid file list / 잘못된 파일 목록을 거부한다", () => {
    expect(() => validatePackedFiles({
      name: "@nest-batch/core",
      files: ["dist/index.js", 42] as unknown as string[]
    })).toThrow(/file path/u);
  });

  it.each([
    ["README.md", "README.md"],
    ["LICENSE", "LICENSE"],
    ["package.json", "package.json"]
  ])(
    "rejects missing required root file %s / 필수 root 파일 %s 누락을 거부한다",
    (missing) => {
      const files = ["dist/index.js", "README.md", "LICENSE", "package.json"].filter((path) => path !== missing);

      expect(() => validatePackedFiles({ name: "@nest-batch/core", files })).toThrow(/required root files/u);
    }
  );

  it("accepts exact packed metadata / 정확한 packed metadata를 허용한다", () => {
    expect(() => validatePackedManifest(packedManifest(), PUBLIC_PACKAGES[1], "0.1.0")).not.toThrow();
  });

  it("rejects a packed internal dependency range / packed 내부 dependency range를 거부한다", () => {
    const manifest = packedManifest();
    manifest.dependencies["@nest-batch/core"] = "^0.1.0";

    expect(() => validatePackedManifest(manifest, PUBLIC_PACKAGES[1], "0.1.0")).toThrow(/exact fixed version/u);
  });

  it("rejects a packed manifest missing a source internal dependency / source 내부 dependency가 빠진 packed manifest를 거부한다", () => {
    const manifest = packedManifest();
    delete manifest.dependencies["@nest-batch/core"];
    const sourceManifest = { dependencies: { "@nest-batch/core": "workspace:*" } };

    expect(() => validatePackedManifest(manifest, PUBLIC_PACKAGES[1], "0.1.0", sourceManifest)).toThrow(/source manifest/u);
  });

  it("rejects packed metadata with a private registry / 사설 registry를 가리키는 packed metadata를 거부한다", () => {
    const manifest = packedManifest();
    manifest.publishConfig.registry = "https://registry.example.test/";

    expect(() => validatePackedManifest(manifest, PUBLIC_PACKAGES[1], "0.1.0")).toThrow(/registry\.npmjs\.org/u);
  });
});
