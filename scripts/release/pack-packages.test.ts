import { describe, expect, it } from "vitest";
import { CORE_SUBPATHS, NPM_REGISTRY_URL, PUBLIC_PACKAGES, REPOSITORY_URL } from "./package-catalog.mjs";
import { validatePackedFiles, validatePackedManifest } from "./pack-packages.mjs";

const packedManifest = (packageInfo = PUBLIC_PACKAGES[1]) => {
  const exports: Record<string, { types: string; import: string }> = {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }
  };

  if (packageInfo.name === "@nest-batch/core") {
    for (const subpath of CORE_SUBPATHS) {
      exports[`./${subpath}`] = {
        types: `./dist/${subpath}/index.d.ts`,
        import: `./dist/${subpath}/index.js`
      };
    }
  }

  return {
    name: packageInfo.name,
    version: "0.1.0",
    repository: { type: "git", url: REPOSITORY_URL, directory: packageInfo.directory },
    engines: { node: ">=20.18.0" },
    publishConfig: { access: "public", registry: NPM_REGISTRY_URL },
    dependencies: { "@nest-batch/core": "0.1.0" },
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports,
    ...(packageInfo.name === "@nest-batch/cli" ? { bin: { "nest-batch": "./dist/bin.js" } } : {})
  };
};

const packedFiles = (packageInfo = PUBLIC_PACKAGES[1]) => [
  "dist/index.js",
  "dist/index.d.ts",
  ...(packageInfo.name === "@nest-batch/core"
    ? CORE_SUBPATHS.flatMap((subpath) => [`dist/${subpath}/index.js`, `dist/${subpath}/index.d.ts`])
    : []),
  ...(packageInfo.name === "@nest-batch/cli" ? ["dist/bin.js"] : []),
  "README.md",
  "LICENSE",
  "package.json"
];

describe("package tarball validation / package tarball 검증", () => {
  it("accepts release files / 배포 대상 파일만 허용한다", () => {
    const packageInfo = PUBLIC_PACKAGES[1];
    expect(() => validatePackedFiles({
      name: packageInfo.name,
      files: [
        "dist/index.js",
        "dist/index.d.ts",
        "dist/index.js.map",
        "src/index.ts",
        "README.md",
        "LICENSE",
        "package.json"
      ]
    }, packedManifest(packageInfo), packageInfo)).not.toThrow();
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

  it.each([
    ["main", "main", (manifest: ReturnType<typeof packedManifest>) => { manifest.main = "./dist/other.js"; }],
    ["top-level types", "top-level types", (manifest: ReturnType<typeof packedManifest>) => { manifest.types = "./dist/other.d.ts"; }],
    ["root export types", "root export types", (manifest: ReturnType<typeof packedManifest>) => { manifest.exports["."].types = "./dist/other.d.ts"; }],
    ["root export import", "root export import", (manifest: ReturnType<typeof packedManifest>) => { manifest.exports["."].import = "./dist/other.js"; }]
  ])("rejects packed manifest drift in %s / packed manifest의 %s 변경을 거부한다", (_english, _korean, mutate) => {
    const manifest = packedManifest();
    mutate(manifest);

    expect(() => validatePackedManifest(manifest, PUBLIC_PACKAGES[1], "0.1.0")).toThrow(/main|types|exports/u);
  });

  it.each([
    ["traversal", "상위 경로", "./dist/../outside.js"],
    ["absolute path", "절대 경로", "/dist/index.js"],
    ["backslash", "backslash", ".\\dist\\index.js"]
  ])("rejects a non-canonical packed entrypoint: %s / 비정규 packed entrypoint를 거부한다: %s", (_english, _korean, target) => {
    const manifest = packedManifest();
    manifest.main = target;

    expect(() => validatePackedManifest(manifest, PUBLIC_PACKAGES[1], "0.1.0")).toThrow(/canonical/u);
  });

  it("rejects a packed core subpath export drift / packed core subpath export 변경을 거부한다", () => {
    const packageInfo = PUBLIC_PACKAGES[0];
    const manifest = packedManifest(packageInfo);
    manifest.exports["./worker"].import = "./dist/worker/other.js";

    expect(() => validatePackedManifest(manifest, packageInfo, "0.1.0")).toThrow(/exports/u);
  });

  it("rejects a packed CLI bin drift / packed CLI bin 변경을 거부한다", () => {
    const packageInfo = PUBLIC_PACKAGES[7];
    const manifest = packedManifest(packageInfo);
    manifest.bin = { "nest-batch": "./dist/other.js" };

    expect(() => validatePackedManifest(manifest, packageInfo, "0.1.0")).toThrow(/bin/u);
  });

  it("rejects packed bin metadata on a non-CLI package / CLI가 아닌 packed package의 bin metadata를 거부한다", () => {
    const packageInfo = PUBLIC_PACKAGES[1];
    const manifest = { ...packedManifest(packageInfo), bin: { unexpected: "./dist/index.js" } };

    expect(() => validatePackedManifest(manifest, packageInfo, "0.1.0")).toThrow(/bin/u);
  });

  it.each([
    ["root JavaScript entrypoint", "root JavaScript entrypoint", PUBLIC_PACKAGES[1], "dist/index.js"],
    ["root declaration entrypoint", "root declaration entrypoint", PUBLIC_PACKAGES[1], "dist/index.d.ts"],
    ["core subpath entrypoint", "core subpath entrypoint", PUBLIC_PACKAGES[0], "dist/worker/index.js"],
    ["CLI binary", "CLI binary", PUBLIC_PACKAGES[7], "dist/bin.js"]
  ])("rejects a packed artifact missing its %s / packed artifact의 %s 누락을 거부한다", (_english, _korean, packageInfo, missingPath) => {
    const files = packedFiles(packageInfo).filter((path) => path !== missingPath);

    expect(() => validatePackedFiles({ name: packageInfo.name, files }, packedManifest(packageInfo), packageInfo))
      .toThrow(new RegExp(missingPath.replaceAll(".", "\\."), "u"));
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
