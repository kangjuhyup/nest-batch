import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CORE_SUBPATHS, NPM_REGISTRY_URL, NPM_SCOPE_REGISTRY_ARGUMENT, PUBLIC_PACKAGES } from "./package-catalog.mjs";
import { validateManifest, verifyPackageDocuments } from "./verify-release.mjs";
import * as release from "./verify-release.mjs";

const REPOSITORY_URL = "https://github.com/kangjuhyup/nest-batch.git";
const HOMEPAGE = "https://github.com/kangjuhyup/nest-batch#readme";
const BUGS_URL = "https://github.com/kangjuhyup/nest-batch/issues";
const LICENSE_TEXT = "MIT License\n";
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const temporaryRoots: string[] = [];

const entrypointsFor = (packageInfo: (typeof PUBLIC_PACKAGES)[number]) => {
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
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports,
    ...(packageInfo.name === "@nest-batch/cli" ? { bin: { "nest-batch": "./dist/bin.js" } } : {})
  };
};

const createPackageReadme = (packageInfo: (typeof PUBLIC_PACKAGES)[number]) => `# ${packageInfo.name}

\`\`\`bash
pnpm add ${packageInfo.name}
\`\`\`

\`\`\`ts
import {} from "${packageInfo.name}";
\`\`\`

[Repository](https://github.com/kangjuhyup/nest-batch)

## License

MIT. Report issues at https://github.com/kangjuhyup/nest-batch/issues.
`;

const createReleasingGuide = () => `# Releasing nest-batch

nvm은 maintainer shell에 설치·로드되어 있어야 합니다.

\`\`\`bash
nvm use
corepack enable
corepack pnpm --version # 10.34.5
pnpm install --frozen-lockfile
\`\`\`

## 1. Release candidate 준비

- [ ] Changesets Version PR workflow 승인과 CI 성공 확인 후 merge
  - 각 Changesets Version PR이 생성되거나 갱신될 때마다 write 권한 maintainer가 PR merge box에서 **Approve workflows to run**을 클릭합니다.
  - **Quality (Node 20.18.3)**, **Quality (Node 24)**, **E2E (Node 24)** check가 모두 성공한 뒤에만 Version PR을 merge합니다.
  - Version PR merge commit을 release candidate로 정하고 아래 local 검증을 마친 뒤에만 release tag를 생성합니다.
- [ ] worktree가 clean이고 release commit이 \`develop\`에 포함됨
- [ ] 8개 package와 root version이 동일함
- [ ] \`pnpm release:check\` 성공
- [ ] \`pnpm test:e2e\` 성공

## 2. 최초 0.1.0 bootstrap

- [ ] npm에서 \`@nest-batch\` scope 권한 확인
  - 모든 catalog package의 identity를 먼저 read-only로 확인합니다.

\`\`\`bash
${PUBLIC_PACKAGES.map(({ name }) => `npm view ${name} name version maintainers repository dist-tags --json --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}`).join("\n")}
\`\`\`

  - 기존 package는 승인된 repository identity와 ownership이 일치하거나 명시적인 transfer/rename 결정이 있어야 합니다. 그렇지 않으면 **STOP**합니다.
  - \`E404\`는 scope publish 권한을 확인한 뒤에만 bootstrap 후보입니다.
- [ ] \`npm whoami\`와 2FA 상태 확인
  - \`npm whoami --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}\`와 \`npm profile get --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}\`
- [ ] \`pnpm run release:publish --tag v0.1.0\`을 maintainer가 직접 실행
- 로컬에서 publish한 \`0.1.0\`은 provenance 예외입니다.
- [ ] 8개 package의 \`0.1.0\`과 integrity 확인

\`\`\`bash
${PUBLIC_PACKAGES.map(({ name }) => `npm view ${name}@0.1.0 version dist.integrity --json --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}`).join("\n")}
\`\`\`

\`@nest-batch/core\`
\`@nest-batch/nest\`
\`@nest-batch/inmemory\`
\`@nest-batch/postgres\`
\`@nest-batch/mysql\`
\`@nest-batch/mariadb\`
\`@nest-batch/bullmq\`
\`@nest-batch/cli\`

## 3. Trusted Publisher 등록

- [ ] owner \`kangjuhyup\`, repository \`nest-batch\`, workflow \`publish.yml\`, environment \`npm\` 등록
- [ ] 8개 package 모두 Allowed action \`npm publish\` 설정
- [ ] GitHub \`npm\` environment와 required reviewer 설정
- [ ] npm token publish 제한 설정
  - 8개 package 각각의 npm package web UI에서 **Settings → Publishing access**를 열고 **Require two-factor authentication and disallow tokens**를 선택한 뒤 **Save**합니다.
  - bootstrap에 token을 사용했다면 package-level setting과 별도로 해당 token을 revoke합니다.

## 4. Tag release

- [ ] \`git tag -s vX.Y.Z <release-commit>\`
- [ ] \`git push origin vX.Y.Z\`
- [ ] publish workflow 성공 확인
- [ ] npm provenance와 GitHub generated release notes 확인
  - 처음으로 OIDC publish되는 후속 version부터 provenance를 필수로 확인합니다.
  - 기존 GitHub Release가 있으면 검증 후 건너뛰고, 없을 때만 생성합니다.
  - 기존 release는 tag 이름이 정확하고 draft/prerelease가 아니어야 합니다. workflow checkout의 tag와 \`HEAD\`가 모두 \`GITHUB_SHA\`로 resolve되어야 하며, \`target_commitish\`가 40자리 commit SHA이면 그 값도 일치해야 합니다. branch 이름처럼 가변 target이면 검증된 tag ref를 기준으로 삼습니다.
  - \`gh api graphql\` 조회로 published와 draft release의 양의 \`databaseId\`를 찾으며, \`data.repository.release\`가 \`null\`인 경우에만 새 release를 생성합니다.
  - GraphQL object가 있으면 REST \`GET repos/{owner}/{repo}/releases/{databaseId}\`로 tag, target, draft, prerelease를 검증합니다.
  - GraphQL \`errors\`, REST 인증·권한·network 오류 또는 malformed 응답은 생성으로 전환하지 않고 workflow를 실패시킵니다.
  - create가 실패하면 같은 GraphQL ID → REST by ID 경로로 정확히 한 번 재조회합니다. 그 사이 생성된 release가 계약과 정확히 일치할 때만 성공으로 복구하고, 여전히 없거나 조회가 실패하면 원래 create 오류를 보존하며, 충돌 release면 충돌 오류로 실패합니다.

## 5. 실패 복구

- [ ] 같은 tag workflow 재실행으로 동일 integrity package를 skip
- [ ] integrity가 다르면 즉시 중단하고 원인 조사
- [ ] publish된 version은 덮어쓰지 않고 필요 시 다음 patch version 준비
`;

const createWorkflowFixtures = (root: string) => {
  for (const relativePath of [
    ".github/workflows/ci.yml",
    ".github/workflows/release-pr.yml",
    ".github/workflows/publish.yml",
    ".github/release.yml"
  ]) {
    const destination = join(root, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(REPOSITORY_ROOT, relativePath), destination);
  }
};

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
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "releasing.md"), createReleasingGuide());

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
      publishConfig: { access: "public", registry: NPM_REGISTRY_URL },
      ...entrypointsFor(packageInfo)
    };
    mutatePackage?.(manifest, packageInfo);
    const packageDirectory = join(root, packageInfo.directory);
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(join(packageDirectory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(packageDirectory, "LICENSE"), licenseForPackage(packageInfo));
    writeFileSync(join(packageDirectory, "README.md"), createPackageReadme(packageInfo));
    mkdirSync(join(packageDirectory, "dist"), { recursive: true });
    writeFileSync(join(packageDirectory, "dist", "index.js"), "export {};\n", { flag: "w" });
    writeFileSync(join(packageDirectory, "dist", "index.d.ts"), "export {};\n", { flag: "w" });

    if (packageInfo.name === "@nest-batch/core") {
      for (const subpath of CORE_SUBPATHS) {
        mkdirSync(join(packageDirectory, "dist", subpath), { recursive: true });
        writeFileSync(join(packageDirectory, "dist", subpath, "index.js"), "export {};\n");
        writeFileSync(join(packageDirectory, "dist", subpath, "index.d.ts"), "export {};\n");
      }
    }

    if (packageInfo.name === "@nest-batch/cli") {
      writeFileSync(join(packageDirectory, "dist", "bin.js"), "export {};\n");
    }
  }

  mkdirSync(join(root, ".changeset"), { recursive: true });
  writeFileSync(join(root, ".changeset", "config.json"), `${JSON.stringify({ fixed: [PUBLIC_PACKAGES.map(({ name }) => name)] }, null, 2)}\n`);
  writeFileSync(join(root, "tsconfig.json"), `${JSON.stringify({ references: [
    ...PUBLIC_PACKAGES.map(({ directory }) => ({ path: `./${directory}` })),
    { path: "./examples/basic" },
    { path: "./examples/nestjs" }
  ] }, null, 2)}\n`);

  createWorkflowFixtures(root);

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
    expect(NPM_REGISTRY_URL).toBe("https://registry.npmjs.org/");
    expect(NPM_SCOPE_REGISTRY_ARGUMENT).toBe("--@nest-batch:registry=https://registry.npmjs.org/");
  });

  it("rejects missing public access / public access 누락을 거부한다", () => {
    expect(() => validateManifest({ name: "@nest-batch/core", version: "0.1.0" }, PUBLIC_PACKAGES[0]))
      .toThrow(/publishConfig\.access/);
  });

  it("reads JSON manifests / JSON manifest를 읽는다", () => {
    const root = createRepository();

    expect(release.readJson(join(root, "package.json"))).toMatchObject({ name: "nest-batch", version: "0.1.0" });
  });

  it("accepts a complete matching release repository / 완전히 일치하는 릴리즈 repository를 허용한다", async () => {
    await expect(release.verifyReleaseRepository(createRepository())).resolves.toBeUndefined();
  });

  it("rejects a repository with insecure publish workflow permissions / 안전하지 않은 publish workflow 권한을 거부한다", async () => {
    const root = createRepository();
    const publishWorkflow = join(root, ".github/workflows/publish.yml");
    writeFileSync(publishWorkflow, readFileSync(publishWorkflow, "utf8").replace("id-token: write", "id-token: read"));

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/exact approved release workflow schema/);
  });

  it("rejects a package version that differs from root / root와 다른 package version을 거부한다", async () => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@nest-batch/core") {
        manifest.version = "0.1.1";
      }
    });

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/version.*0\.1\.0|0\.1\.0.*version/);
  });

  it("rejects a mismatched repository directory / repository directory 불일치를 거부한다", async () => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@nest-batch/core") {
        manifest.repository = { type: "git", url: REPOSITORY_URL, directory: "packages/other" };
      }
    });

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/repository\.directory/);
  });

  it("rejects non-public package access / public이 아닌 package access를 거부한다", async () => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@nest-batch/core") {
        manifest.publishConfig = { access: "restricted" };
      }
    });

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/publishConfig\.access/);
  });

  it("rejects a package private registry / package의 사설 registry를 거부한다", async () => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@nest-batch/core") {
        manifest.publishConfig = { access: "public", registry: "https://registry.example.test/" };
      }
    });

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/publishConfig\.registry/u);
  });

  it.each([
    ["missing main", "main 누락", (manifest: Record<string, unknown>) => { delete manifest.main; }],
    ["wrong main", "잘못된 main", (manifest: Record<string, unknown>) => { manifest.main = "./dist/other.js"; }],
    ["traversing main", "상위 경로를 가리키는 main", (manifest: Record<string, unknown>) => { manifest.main = "./dist/../outside.js"; }],
    ["absolute main", "절대 경로 main", (manifest: Record<string, unknown>) => { manifest.main = "/dist/index.js"; }],
    ["backslash main", "backslash main", (manifest: Record<string, unknown>) => { manifest.main = ".\\dist\\index.js"; }],
    ["missing top-level types", "top-level types 누락", (manifest: Record<string, unknown>) => { delete manifest.types; }],
    ["wrong top-level types", "잘못된 top-level types", (manifest: Record<string, unknown>) => { manifest.types = "./dist/other.d.ts"; }],
    ["traversing top-level types", "상위 경로를 가리키는 top-level types", (manifest: Record<string, unknown>) => { manifest.types = "./dist/../outside.d.ts"; }],
    ["missing root export types", "root export types 누락", (manifest: Record<string, unknown>) => { delete (manifest.exports as Record<string, Record<string, unknown>>)["."].types; }],
    ["wrong root export types", "잘못된 root export types", (manifest: Record<string, unknown>) => { (manifest.exports as Record<string, Record<string, unknown>>)["."].types = "./dist/other.d.ts"; }],
    ["traversing root export types", "상위 경로를 가리키는 root export types", (manifest: Record<string, unknown>) => { (manifest.exports as Record<string, Record<string, unknown>>)["."].types = "./dist/../outside.d.ts"; }],
    ["missing root export import", "root export import 누락", (manifest: Record<string, unknown>) => { delete (manifest.exports as Record<string, Record<string, unknown>>)["."].import; }],
    ["wrong root export import", "잘못된 root export import", (manifest: Record<string, unknown>) => { (manifest.exports as Record<string, Record<string, unknown>>)["."].import = "./dist/other.js"; }],
    ["traversing root export import", "상위 경로를 가리키는 root export import", (manifest: Record<string, unknown>) => { (manifest.exports as Record<string, Record<string, unknown>>)["."].import = "./dist/../outside.js"; }]
  ])("rejects a source manifest with %s / %s source manifest를 거부한다", async (_english, _korean, mutate) => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@nest-batch/nest") {
        mutate(manifest);
      }
    });

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/main|types|exports|canonical/u);
  });

  it.each([
    ["missing subpath export types", "subpath export types 누락", (manifest: Record<string, unknown>) => { delete (manifest.exports as Record<string, Record<string, unknown>>)["./worker"].types; }],
    ["wrong subpath export types", "잘못된 subpath export types", (manifest: Record<string, unknown>) => { (manifest.exports as Record<string, Record<string, unknown>>)["./worker"].types = "./dist/worker/other.d.ts"; }],
    ["traversing subpath export types", "상위 경로를 가리키는 subpath export types", (manifest: Record<string, unknown>) => { (manifest.exports as Record<string, Record<string, unknown>>)["./worker"].types = "./dist/worker/../../outside.d.ts"; }],
    ["missing subpath export import", "subpath export import 누락", (manifest: Record<string, unknown>) => { delete (manifest.exports as Record<string, Record<string, unknown>>)["./worker"].import; }],
    ["wrong subpath export import", "잘못된 subpath export import", (manifest: Record<string, unknown>) => { (manifest.exports as Record<string, Record<string, unknown>>)["./worker"].import = "./dist/worker/other.js"; }],
    ["traversing subpath export import", "상위 경로를 가리키는 subpath export import", (manifest: Record<string, unknown>) => { (manifest.exports as Record<string, Record<string, unknown>>)["./worker"].import = "./dist/worker/../../outside.js"; }]
  ])("rejects core with %s / %s core manifest를 거부한다", async (_english, _korean, mutate) => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@nest-batch/core") {
        mutate(manifest);
      }
    });

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/exports|canonical/u);
  });

  it.each([
    ["missing CLI bin", "CLI bin 누락", (manifest: Record<string, unknown>) => { delete manifest.bin; }],
    ["wrong CLI bin", "잘못된 CLI bin", (manifest: Record<string, unknown>) => { manifest.bin = { "nest-batch": "./dist/other.js" }; }],
    ["traversing CLI bin", "상위 경로를 가리키는 CLI bin", (manifest: Record<string, unknown>) => { manifest.bin = { "nest-batch": "./dist/../outside.js" }; }]
  ])("rejects CLI with %s / %s CLI manifest를 거부한다", async (_english, _korean, mutate) => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@nest-batch/cli") {
        mutate(manifest);
      }
    });

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/bin|canonical/u);
  });

  it("rejects bin metadata on a non-CLI package / CLI가 아닌 package의 bin metadata를 거부한다", async () => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@nest-batch/nest") {
        manifest.bin = { unexpected: "./dist/index.js" };
      }
    });

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/bin/u);
  });

  it.each([
    ["an extra export subpath", "추가 export subpath", (manifest: Record<string, unknown>) => { (manifest.exports as Record<string, unknown>)["./extra"] = { types: "./dist/index.d.ts", import: "./dist/index.js" }; }],
    ["an extra export condition", "추가 export condition", (manifest: Record<string, unknown>) => { (manifest.exports as Record<string, Record<string, unknown>>)["."].default = "./dist/index.js"; }]
  ])("rejects a source manifest with %s / %s이 있는 source manifest를 거부한다", async (_english, _korean, mutate) => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@nest-batch/nest") {
        mutate(manifest);
      }
    });

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/exports/u);
  });

  it("rejects an extra CLI bin command / 추가 CLI bin command를 거부한다", async () => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@nest-batch/cli") {
        manifest.bin = { "nest-batch": "./dist/bin.js", unexpected: "./dist/bin.js" };
      }
    });

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/bin/u);
  });

  it("rejects a Changesets fixed group drift / Changesets fixed group 변경을 거부한다", async () => {
    const root = createRepository();
    const configPath = join(root, ".changeset/config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { fixed: string[][] };
    config.fixed[0].pop();
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/fixed group/u);
  });

  it("rejects a root TypeScript package reference drift / root TypeScript package reference 변경을 거부한다", async () => {
    const root = createRepository();
    const configPath = join(root, "tsconfig.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { references: Array<{ path: string }> };
    config.references.splice(1, 1);
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/public package references/u);
  });

  it("rejects a source internal dependency range / source 내부 dependency range를 거부한다", async () => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@nest-batch/nest") {
        manifest.dependencies = { "@nest-batch/core": "^0.1.0" };
      }
    });

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/workspace:\*/u);
  });

  it("rejects a removed package name outside historical docs / 과거 문서 밖의 제거된 package 이름을 거부한다", async () => {
    const root = createRepository();
    const removedName = ["@nest-batch", "queue-core"].join("/");
    mkdirSync(join(root, "packages/core/src"), { recursive: true });
    writeFileSync(join(root, "packages/core/src/legacy.ts"), `export * from "${removedName}";\n`);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/removed package name/u);
  });

  it("rejects a removed workspace package directory / 제거된 workspace package directory를 거부한다", async () => {
    const root = createRepository();
    const removedDirectory = ["packages", "worker-local"].join("/");
    mkdirSync(join(root, removedDirectory), { recursive: true });

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/removed workspace package directory/u);
  });

  it("rejects a removed import in root e2e tests / root e2e test의 제거된 import를 거부한다", async () => {
    const root = createRepository();
    const removedName = ["@nest-batch", "scheduler-core"].join("/");
    mkdirSync(join(root, "e2e"), { recursive: true });
    writeFileSync(join(root, "e2e/legacy.e2e.test.ts"), `import "${removedName}";\n`);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/e2e.*removed package name/u);
  });

  it("rejects a removed package name in a root document / root 문서의 제거된 package 이름을 거부한다", async () => {
    const root = createRepository();
    const removedName = ["@nest-batch", "polling-core"].join("/");
    writeFileSync(join(root, "DATABASE.md"), `Do not install ${removedName}.\n`);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/DATABASE\.md.*removed package name/u);
  });

  it("allows removed package history only under docs superpowers / docs superpowers 아래의 과거 package 기록만 허용한다", async () => {
    const root = createRepository();
    const removedName = ["@nest-batch", "worker-threads"].join("/");
    mkdirSync(join(root, "docs/superpowers/specs"), { recursive: true });
    writeFileSync(join(root, "docs/superpowers/specs/history.md"), `Historical package: ${removedName}.\n`);

    await expect(release.verifyReleaseRepository(root)).resolves.toBeUndefined();
  });

  it("rejects a package LICENSE that differs from root / root와 다른 package LICENSE를 거부한다", async () => {
    const root = createRepository(undefined, (packageInfo) =>
      packageInfo.name === "@nest-batch/core" ? "Different license\n" : LICENSE_TEXT
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/LICENSE/);
  });

  it("rejects a missing core subpath declaration / core subpath 선언 파일 누락을 거부한다", async () => {
    const root = createRepository();
    rmSync(join(root, "packages/core/dist/worker/index.d.ts"));

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/dist\/worker\/index\.d\.ts/);
  });

  it("rejects a missing CLI binary / CLI 실행 파일 누락을 거부한다", async () => {
    const root = createRepository();
    rmSync(join(root, "packages/cli/dist/bin.js"));

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/dist\/bin\.js/);
  });

  it("rejects a release checklist that drifts from the package catalog / package catalog과 다른 릴리즈 checklist를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(releasingGuide, readFileSync(releasingGuide, "utf8").replace("`@nest-batch/cli`\n", ""));

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/docs\/releasing\.md.*@nest-batch\/cli/);
  });

  it("rejects a release checklist with a different publish workflow / 다른 publish workflow를 적은 릴리즈 checklist를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(releasingGuide, readFileSync(releasingGuide, "utf8").replace("workflow `publish.yml`", "workflow `publisher.yml`"));

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/docs\/releasing\.md.*publish\.yml/);
  });

  it("rejects a release checklist with a different npm environment / 다른 npm environment를 적은 릴리즈 checklist를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(releasingGuide, readFileSync(releasingGuide, "utf8").replace("environment `npm`", "environment `release`"));

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/docs\/releasing\.md.*environment.*npm/);
  });

  it("rejects a release checklist without Version PR workflow approval / Version PR workflow 승인이 없는 릴리즈 checklist를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(releasingGuide, readFileSync(releasingGuide, "utf8").replace("**Approve workflows to run**", "workflow 실행 승인"));

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/Approve workflows to run/u);
  });

  it.each([
    ["Node 20 quality", "Node 20 quality", "**Quality (Node 20.18.3)**"],
    ["Node 24 quality", "Node 24 quality", "**Quality (Node 24)**"],
    ["E2E", "E2E", "**E2E (Node 24)**"]
  ])("rejects a release checklist without the %s check / %s check가 없는 릴리즈 checklist를 거부한다", async (_english, _korean, checkName) => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(releasingGuide, readFileSync(releasingGuide, "utf8").replace(checkName, "**Skipped check**"));

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/docs\/releasing\.md.*Quality|E2E/u);
  });

  it("rejects a release checklist that tags before Version PR merge and local verification / Version PR merge와 local 검증 전에 tag하는 checklist를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(
      releasingGuide,
      readFileSync(releasingGuide, "utf8").replace(
        "Version PR merge commit을 release candidate로 정하고 아래 local 검증을 마친 뒤에만 release tag를 생성합니다.",
        "Version PR이 열리면 release tag를 먼저 생성합니다."
      )
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/release candidate|release tag/u);
  });

  it("rejects the obsolete bootstrap command / 이전 bootstrap 명령을 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(
      releasingGuide,
      readFileSync(releasingGuide, "utf8").replace(
        "pnpm run release:publish --tag v0.1.0",
        "pnpm run release:publish -- --tag v0.1.0"
      )
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/docs\/releasing\.md.*pnpm run release:publish --tag v0\.1\.0/);
  });

  it("rejects a release checklist without every catalog identity audit / 모든 catalog identity audit가 없는 릴리즈 checklist를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(
      releasingGuide,
      readFileSync(releasingGuide, "utf8").replace(
        `npm view @nest-batch/cli name version maintainers repository dist-tags --json --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}\n`,
        ""
      )
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/docs\/releasing\.md.*npm view @nest-batch\/cli/);
  });

  it("rejects a release checklist with an ambient npm registry audit / ambient npm registry를 쓰는 릴리즈 audit를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(
      releasingGuide,
      readFileSync(releasingGuide, "utf8").replace(` --registry ${NPM_REGISTRY_URL}`, "")
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/registry\.npmjs\.org/u);
  });

  it("rejects a release checklist without the scoped registry override / scoped registry override가 없는 릴리즈 checklist를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(
      releasingGuide,
      readFileSync(releasingGuide, "utf8").replace(` ${NPM_SCOPE_REGISTRY_ARGUMENT}`, "")
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/@nest-batch:registry/u);
  });

  it("rejects a release checklist without an explicit profile registry / 명시적인 profile registry가 없는 릴리즈 checklist를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(
      releasingGuide,
      readFileSync(releasingGuide, "utf8").replace(
        `npm profile get --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}`,
        "npm profile get"
      )
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/npm profile get/u);
  });

  it("rejects a release checklist without every explicit integrity confirmation / 모든 명시적인 integrity 확인이 없는 릴리즈 checklist를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(
      releasingGuide,
      readFileSync(releasingGuide, "utf8").replace(
        `npm view @nest-batch/cli@0.1.0 version dist.integrity --json --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}\n`,
        ""
      )
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/npm view @nest-batch\/cli@0\.1\.0/u);
  });

  it("rejects a release checklist without the bootstrap provenance exception / bootstrap provenance 예외가 없는 릴리즈 checklist를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(
      releasingGuide,
      readFileSync(releasingGuide, "utf8").replace("로컬에서 publish한 `0.1.0`은 provenance 예외입니다.", "로컬 bootstrap에도 provenance가 필요합니다.")
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/provenance 예외/u);
  });

  it("rejects a release checklist without later OIDC provenance / 후속 OIDC provenance 규칙이 없는 릴리즈 checklist를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(
      releasingGuide,
      readFileSync(releasingGuide, "utf8").replace("처음으로 OIDC publish되는 후속 version부터 provenance를 필수로 확인합니다.", "후속 provenance는 선택입니다.")
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/OIDC publish/u);
  });

  it("rejects a release checklist without idempotent GitHub release recovery / 멱등 GitHub release 복구 규칙이 없는 릴리즈 checklist를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(
      releasingGuide,
      readFileSync(releasingGuide, "utf8").replace("기존 GitHub Release가 있으면 검증 후 건너뛰고, 없을 때만 생성합니다.", "GitHub Release를 항상 다시 생성합니다.")
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/GitHub Release/u);
  });

  it.each([
    ["existing release state", "기존 release 상태", "기존 release는 tag 이름이 정확하고 draft/prerelease가 아니어야 합니다.", "기존 release는 그대로 사용합니다."],
    ["tag checkout SHA", "tag checkout SHA", "workflow checkout의 tag와 `HEAD`가 모두 `GITHUB_SHA`로 resolve되어야 하며, `target_commitish`가 40자리 commit SHA이면 그 값도 일치해야 합니다.", "workflow checkout은 생략합니다."],
    ["draft-aware GraphQL ID lookup", "draft 포함 GraphQL ID 조회", "`gh api graphql` 조회로 published와 draft release의 양의 `databaseId`를 찾으며, `data.repository.release`가 `null`인 경우에만 새 release를 생성합니다.", "조회 실패 시 새 release를 생성합니다."],
    ["REST by ID state lookup", "REST by ID 상태 조회", "GraphQL object가 있으면 REST `GET repos/{owner}/{repo}/releases/{databaseId}`로 tag, target, draft, prerelease를 검증합니다.", "GraphQL object만 신뢰합니다."],
    ["lookup failure", "조회 실패", "GraphQL `errors`, REST 인증·권한·network 오류 또는 malformed 응답은 생성으로 전환하지 않고 workflow를 실패시킵니다.", "조회 오류를 무시합니다."],
    ["create race recovery", "create 경합 복구", "create가 실패하면 같은 GraphQL ID → REST by ID 경로로 정확히 한 번 재조회합니다. 그 사이 생성된 release가 계약과 정확히 일치할 때만 성공으로 복구하고, 여전히 없거나 조회가 실패하면 원래 create 오류를 보존하며, 충돌 release면 충돌 오류로 실패합니다.", "create 실패를 그대로 무시합니다."]
  ])("rejects a release checklist without GitHub release contract: %s / GitHub release 계약이 없는 checklist를 거부한다: %s", async (_english, _korean, current, replacement) => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(
      releasingGuide,
      readFileSync(releasingGuide, "utf8").replace(current, replacement)
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/docs\/releasing\.md.*missing required/u);
  });

  it("rejects a release checklist that weakens the identity stop rule / identity 중단 규칙을 약화한 릴리즈 checklist를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(
      releasingGuide,
      readFileSync(releasingGuide, "utf8").replace(
        "그렇지 않으면 **STOP**합니다.",
        "그렇지 않으면 계속 진행합니다."
      )
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/docs\/releasing\.md.*STOP/);
  });

  it("rejects a release checklist that permits token publishing / token publish를 허용하는 릴리즈 checklist를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(
      releasingGuide,
      readFileSync(releasingGuide, "utf8").replace(
        "Require two-factor authentication and disallow tokens",
        "Require two-factor authentication and allow tokens"
      )
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/docs\/releasing\.md.*disallow tokens/);
  });

  it("verifies the checked-out release repository / 현재 checkout된 릴리즈 repository를 검증한다", async () => {
    await expect(release.verifyReleaseRepository(REPOSITORY_ROOT)).resolves.toBeUndefined();
  });
});

describe("package document validation / package 문서 검증", () => {
  it("rejects a package without a README / README가 없는 package를 거부한다", async () => {
    const root = await mkdtemp(join(tmpdir(), "nest-batch-readme-test-"));
    const packageInfo = PUBLIC_PACKAGES[0];
    const packageDirectory = join(root, packageInfo.directory);

    try {
      await mkdir(packageDirectory, { recursive: true });
      await writeFile(join(packageDirectory, "package.json"), `${JSON.stringify({ name: packageInfo.name })}\n`);
      await writeFile(join(packageDirectory, "LICENSE"), LICENSE_TEXT);

      await expect(verifyPackageDocuments(root, packageInfo)).rejects.toThrow(/README\.md/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an issue link used as the repository link / issue link을 repository link로 사용하면 거부한다", async () => {
    const root = await mkdtemp(join(tmpdir(), "nest-batch-readme-test-"));
    const packageInfo = PUBLIC_PACKAGES[0];
    const packageDirectory = join(root, packageInfo.directory);

    try {
      await mkdir(packageDirectory, { recursive: true });
      await writeFile(
        join(packageDirectory, "README.md"),
        createPackageReadme(packageInfo).replace("[Repository](https://github.com/kangjuhyup/nest-batch)\n\n", "")
      );

      await expect(verifyPackageDocuments(root, packageInfo)).rejects.toThrow(/repository link/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an install command with a package-name prefix / package name prefix를 가진 install command를 거부한다", async () => {
    const root = await mkdtemp(join(tmpdir(), "nest-batch-readme-test-"));
    const packageInfo = PUBLIC_PACKAGES[0];
    const packageDirectory = join(root, packageInfo.directory);

    try {
      await mkdir(packageDirectory, { recursive: true });
      await writeFile(
        join(packageDirectory, "README.md"),
        createPackageReadme(packageInfo).replace(
          `pnpm add ${packageInfo.name}`,
          `pnpm add ${packageInfo.name}-extra`
        )
      );

      await expect(verifyPackageDocuments(root, packageInfo)).rejects.toThrow(/pnpm install command/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
