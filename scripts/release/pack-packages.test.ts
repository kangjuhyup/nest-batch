import { describe, expect, it } from "vitest";
import { validatePackedFiles } from "./pack-packages.mjs";

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

  it("rejects an invalid file list / 잘못된 파일 목록을 거부한다", () => {
    expect(() => validatePackedFiles({
      name: "@nest-batch/core",
      files: ["dist/index.js", 42] as unknown as string[]
    })).toThrow(/file path/u);
  });
});
