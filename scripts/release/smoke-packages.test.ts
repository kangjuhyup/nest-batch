import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NPM_REGISTRY_URL, PUBLIC_PACKAGES, REPOSITORY_URL } from "./package-catalog.mjs";
import { createConsumerTsconfig, validateInstalledPackageMetadata } from "./smoke-packages.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("consumer smoke TypeScript configuration / consumer smoke TypeScript 설정", () => {
  it("enables strict NodeNext declaration checking / strict NodeNext declaration 검사를 사용한다", () => {
    const tsconfig = createConsumerTsconfig();

    expect(tsconfig.compilerOptions).toMatchObject({
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true
    });
    expect(tsconfig.compilerOptions).not.toHaveProperty("skipLibCheck");
  });
});

describe("installed package metadata / 설치된 package metadata", () => {
  it("validates every installed catalog manifest / 설치된 모든 catalog manifest를 검증한다", async () => {
    const root = await mkdtemp(join(tmpdir(), "nest-batch-installed-metadata-test-"));
    temporaryRoots.push(root);
    const artifacts = PUBLIC_PACKAGES.map(({ name, directory }) => ({ name, directory, version: "0.1.0" }));

    for (const packageInfo of PUBLIC_PACKAGES) {
      const directory = join(root, "node_modules", ...packageInfo.name.split("/"));
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "package.json"), `${JSON.stringify({
        name: packageInfo.name,
        version: "0.1.0",
        repository: { type: "git", url: REPOSITORY_URL, directory: packageInfo.directory },
        engines: { node: ">=20.18.0" },
        publishConfig: { access: "public", registry: NPM_REGISTRY_URL },
        dependencies: packageInfo.name === "@nest-batch/core" ? undefined : { "@nest-batch/core": "0.1.0" }
      }, null, 2)}\n`);
    }

    await expect(validateInstalledPackageMetadata(root, artifacts)).resolves.toBeUndefined();
  });

  it("rejects an installed internal dependency range / 설치된 내부 dependency range를 거부한다", async () => {
    const root = await mkdtemp(join(tmpdir(), "nest-batch-installed-metadata-test-"));
    temporaryRoots.push(root);
    const artifacts = PUBLIC_PACKAGES.map(({ name, directory }) => ({ name, directory, version: "0.1.0" }));

    for (const packageInfo of PUBLIC_PACKAGES) {
      const directory = join(root, "node_modules", ...packageInfo.name.split("/"));
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "package.json"), `${JSON.stringify({
        name: packageInfo.name,
        version: "0.1.0",
        repository: { type: "git", url: REPOSITORY_URL, directory: packageInfo.directory },
        engines: { node: ">=20.18.0" },
        publishConfig: { access: "public", registry: NPM_REGISTRY_URL },
        dependencies: packageInfo.name === "@nest-batch/nest" ? { "@nest-batch/core": "^0.1.0" } : undefined
      }, null, 2)}\n`);
    }

    await expect(validateInstalledPackageMetadata(root, artifacts)).rejects.toThrow(/exact fixed version/u);
  });

  it("rejects an installed manifest missing packed internal metadata / packed 내부 metadata가 빠진 설치 manifest를 거부한다", async () => {
    const root = await mkdtemp(join(tmpdir(), "nest-batch-installed-metadata-test-"));
    temporaryRoots.push(root);
    const artifacts = PUBLIC_PACKAGES.map(({ name, directory }) => ({
      name,
      directory,
      version: "0.1.0",
      manifest: name === "@nest-batch/nest" ? { dependencies: { "@nest-batch/core": "0.1.0" } } : {}
    }));

    for (const packageInfo of PUBLIC_PACKAGES) {
      const directory = join(root, "node_modules", ...packageInfo.name.split("/"));
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "package.json"), `${JSON.stringify({
        name: packageInfo.name,
        version: "0.1.0",
        repository: { type: "git", url: REPOSITORY_URL, directory: packageInfo.directory },
        engines: { node: ">=20.18.0" },
        publishConfig: { access: "public", registry: NPM_REGISTRY_URL }
      }, null, 2)}\n`);
    }

    await expect(validateInstalledPackageMetadata(root, artifacts)).rejects.toThrow(/source manifest/u);
  });
});
