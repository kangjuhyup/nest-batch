import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CORE_SUBPATHS,
  NPM_REGISTRY_URL,
  NPM_SCOPE_REGISTRY_ARGUMENT,
  PUBLIC_PACKAGE_SCOPE,
  PUBLIC_PACKAGES
} from "./package-catalog.mjs";
import { validateManifest, verifyPackageDocuments } from "./verify-release.mjs";
import * as release from "./verify-release.mjs";

const REPOSITORY_URL = "https://github.com/kangjuhyup/nest-batch.git";
const HOMEPAGE = "https://github.com/kangjuhyup/nest-batch#readme";
const BUGS_URL = "https://github.com/kangjuhyup/nest-batch/issues";
const LICENSE_TEXT = "MIT License\n";
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const temporaryRoots: string[] = [];
const BOOTSTRAP_CANDIDATE_CHECKLIST_ITEM = "- [ ] 최초 `0.1.0` release candidate로 검토된 package-release-readiness merge commit 지정";
const BOOTSTRAP_CANDIDATE_RULE = "이 예외는 최초 `0.1.0`에 한 번만 적용하며, 새 Changeset이나 Version PR을 만들지 않습니다.";
const LATER_VERSION_PR_RULE = "최초 `0.1.0` 이후 모든 release에는 Changesets Version PR이 필수입니다.";
const ACTIONS_PR_SETTING_CHECKLIST_ITEM = "- [ ] 첫 post-bootstrap Version PR 전에 GitHub Actions의 pull request 생성 권한 수동 활성화";
const ACTIONS_PR_SETTING_PATH = "Settings → Actions → General → Workflow permissions";
const ACTIONS_PR_SETTING_NAME = "Allow GitHub Actions to create and approve pull requests";
const ACTIONS_PR_SETTING_AUDIT = "`can_approve_pull_request_reviews=false`";

const entrypointsFor = (packageInfo: (typeof PUBLIC_PACKAGES)[number]) => {
  const exports: Record<string, { types: string; import: string }> = {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }
  };

  if (packageInfo.name === "@rv-nest-batch/core") {
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
    ...(packageInfo.name === "@rv-nest-batch/cli" ? { bin: { "nest-batch": "./dist/bin.js" } } : {})
  };
};

const createPackageReadme = (packageInfo: (typeof PUBLIC_PACKAGES)[number]) => {
  const packageNames = packageInfo.name === `${PUBLIC_PACKAGE_SCOPE}/cli`
    ? [`${PUBLIC_PACKAGE_SCOPE}/cli`, `${PUBLIC_PACKAGE_SCOPE}/core`, `${PUBLIC_PACKAGE_SCOPE}/inmemory`]
    : [packageInfo.name];

  return `# ${packageInfo.name}

\`\`\`bash
pnpm add ${packageNames.join(" ")}
\`\`\`

\`\`\`ts
${packageNames.map((name) => `import {} from "${name}";`).join("\n")}
\`\`\`

[Repository](https://github.com/kangjuhyup/nest-batch)

## License

MIT. Report issues at https://github.com/kangjuhyup/nest-batch/issues.
`;
};

const createReleasingGuide = () => `# Releasing nest-batch

nvm은 maintainer shell에 설치·로드되어 있어야 합니다.

\`\`\`bash
nvm use
corepack enable
corepack pnpm --version # 10.34.5
pnpm install --frozen-lockfile
\`\`\`

## 1. Release candidate 준비

### 최초 0.1.0 release candidate

${BOOTSTRAP_CANDIDATE_CHECKLIST_ITEM}
  - 검토가 끝난 package-release-readiness merge commit을 최초 \`0.1.0\` release candidate로 사용합니다.
  - ${BOOTSTRAP_CANDIDATE_RULE}

### 후속 release candidate

${ACTIONS_PR_SETTING_CHECKLIST_ITEM}
  - GitHub repository의 **${ACTIONS_PR_SETTING_PATH}**에서 **${ACTIONS_PR_SETTING_NAME}**를 선택하고 저장합니다.
  - 2026-09-05 read-only audit에서는 ${ACTIONS_PR_SETTING_AUDIT}였으므로, maintainer가 직접 활성화하기 전에는 첫 post-bootstrap Version PR을 생성하지 않습니다.
- [ ] Changesets Version PR workflow 승인과 CI 성공 확인 후 merge
  - ${LATER_VERSION_PR_RULE}
  - 각 Changesets Version PR이 생성되거나 갱신될 때마다 write 권한 maintainer가 PR merge box에서 **Approve workflows to run**을 클릭합니다.
  - **Quality (Node 20.18.3)**, **Quality (Node 24)**, **E2E (Node 24)** check가 모두 성공한 뒤에만 Version PR을 merge합니다.
  - Version PR merge commit을 release candidate로 정하고 아래 local 검증을 마친 뒤에만 release tag를 생성합니다.

### 공통 local candidate 검증

- [ ] worktree가 clean이고 release commit이 \`develop\`에 포함됨
- [ ] 8개 package와 root version이 동일함
- [ ] \`pnpm release:check\` 성공
- [ ] \`pnpm test:e2e\` 성공

## 2. 최초 0.1.0 bootstrap

- [ ] npm에서 \`@rv-nest-batch\` scope 권한 확인
  - 모든 catalog package의 identity를 먼저 read-only로 확인합니다.

\`\`\`bash
${PUBLIC_PACKAGES.map(({ name }) => `npm view ${name} name version maintainers repository dist-tags --json --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}`).join("\n")}
\`\`\`

  - 기존 package는 승인된 repository identity와 ownership이 일치하거나 명시적인 transfer/rename 결정이 있어야 합니다. 그렇지 않으면 **STOP**합니다.
  - \`E404\`는 scope publish 권한을 확인한 뒤에만 bootstrap 후보입니다.
- [ ] npm 계정과 2FA 상태 확인
  - \`npm whoami --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}\`와 \`npm profile get --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}\`
- [ ] \`pnpm run release:publish --tag v0.1.0\`을 maintainer가 직접 실행
- 로컬에서 publish한 \`0.1.0\`은 provenance 예외입니다.
- [ ] 8개 package의 \`0.1.0\`과 integrity 확인

\`\`\`bash
${PUBLIC_PACKAGES.map(({ name }) => `npm view ${name}@0.1.0 version dist.integrity --json --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}`).join("\n")}
\`\`\`

\`@rv-nest-batch/core\`
\`@rv-nest-batch/nest\`
\`@rv-nest-batch/inmemory\`
\`@rv-nest-batch/postgres\`
\`@rv-nest-batch/mysql\`
\`@rv-nest-batch/mariadb\`
\`@rv-nest-batch/bullmq\`
\`@rv-nest-batch/cli\`

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

    if (packageInfo.name === "@rv-nest-batch/core") {
      for (const subpath of CORE_SUBPATHS) {
        mkdirSync(join(packageDirectory, "dist", subpath), { recursive: true });
        writeFileSync(join(packageDirectory, "dist", subpath, "index.js"), "export {};\n");
        writeFileSync(join(packageDirectory, "dist", subpath, "index.d.ts"), "export {};\n");
      }
    }

    if (packageInfo.name === "@rv-nest-batch/cli") {
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
  it("defines the rv-nest-batch public scope / rv-nest-batch 공개 scope를 정의한다", () => {
    expect(PUBLIC_PACKAGE_SCOPE).toBe("@rv-nest-batch");
    expect(PUBLIC_PACKAGES.map(({ name }) => name)).toEqual([
      "@rv-nest-batch/core",
      "@rv-nest-batch/nest",
      "@rv-nest-batch/inmemory",
      "@rv-nest-batch/postgres",
      "@rv-nest-batch/mysql",
      "@rv-nest-batch/mariadb",
      "@rv-nest-batch/bullmq",
      "@rv-nest-batch/cli"
    ]);
    expect(CORE_SUBPATHS).toEqual(["queue", "scheduler", "polling", "worker"]);
    expect(NPM_SCOPE_REGISTRY_ARGUMENT).toBe("--@rv-nest-batch:registry=https://registry.npmjs.org/");
  });

  it("rejects missing public access / public access 누락을 거부한다", () => {
    expect(() => validateManifest({ name: "@rv-nest-batch/core", version: "0.1.0" }, PUBLIC_PACKAGES[0]))
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
      if (packageInfo.name === "@rv-nest-batch/core") {
        manifest.version = "0.1.1";
      }
    });

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/version.*0\.1\.0|0\.1\.0.*version/);
  });

  it("rejects a mismatched repository directory / repository directory 불일치를 거부한다", async () => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@rv-nest-batch/core") {
        manifest.repository = { type: "git", url: REPOSITORY_URL, directory: "packages/other" };
      }
    });

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/repository\.directory/);
  });

  it("rejects non-public package access / public이 아닌 package access를 거부한다", async () => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@rv-nest-batch/core") {
        manifest.publishConfig = { access: "restricted" };
      }
    });

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/publishConfig\.access/);
  });

  it("rejects a package private registry / package의 사설 registry를 거부한다", async () => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@rv-nest-batch/core") {
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
      if (packageInfo.name === "@rv-nest-batch/nest") {
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
      if (packageInfo.name === "@rv-nest-batch/core") {
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
      if (packageInfo.name === "@rv-nest-batch/cli") {
        mutate(manifest);
      }
    });

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/bin|canonical/u);
  });

  it("rejects bin metadata on a non-CLI package / CLI가 아닌 package의 bin metadata를 거부한다", async () => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@rv-nest-batch/nest") {
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
      if (packageInfo.name === "@rv-nest-batch/nest") {
        mutate(manifest);
      }
    });

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/exports/u);
  });

  it("rejects an extra CLI bin command / 추가 CLI bin command를 거부한다", async () => {
    const root = createRepository((manifest, packageInfo) => {
      if (packageInfo.name === "@rv-nest-batch/cli") {
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
      if (packageInfo.name === "@rv-nest-batch/nest") {
        manifest.dependencies = { "@rv-nest-batch/core": "^0.1.0" };
      }
    });

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/workspace:\*/u);
  });

  it.each([
    ["an e2e import", "e2e import", (root: string, previousCore: string) => {
      mkdirSync(join(root, "e2e"), { recursive: true });
      writeFileSync(join(root, "e2e", "old-scope.e2e.test.ts"), `import { defineJob } from "${previousCore}";\nvoid defineJob;\n`);
    }],
    ["a package manifest dependency", "package manifest dependency", (root: string, previousCore: string) => {
      const manifestPath = join(root, "packages", "nest", "package.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      manifest.dependencies = { [previousCore]: "workspace:*" };
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }],
    ["a root Markdown file", "root Markdown", (root: string, previousCore: string) => {
      writeFileSync(join(root, "MIGRATION.md"), `Install ${previousCore}.\n`);
    }],
    ["the lockfile fixture", "lockfile fixture", (root: string, previousCore: string) => {
      writeFileSync(join(root, "pnpm-lock.yaml"), `lockfileVersion: '9.0'\npackages:\n  ${JSON.stringify(previousCore)}:\n`);
    }]
  ])("rejects the previous package namespace in %s / %s의 이전 package namespace를 거부한다", async (_english, _korean, mutate) => {
    const root = createRepository();
    const previousScope = ["@nest", "batch"].join("-");
    const previousCore = `${previousScope}/core`;
    mutate(root, previousCore);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(previousCore);
  });

  it("rejects NUL-obfuscated previous scope in a package README / package README의 NUL로 숨긴 이전 scope를 거부한다", async () => {
    const root = createRepository();
    const readmePath = join(root, "packages", "core", "README.md");
    const previousCore = `${["@nest", "batch"].join("-")}/core`;
    writeFileSync(
      readmePath,
      Buffer.concat([readFileSync(readmePath), Buffer.from([0]), Buffer.from(`Install ${previousCore}.\n`)])
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/README\.md.*NUL|README\.md.*previous package namespace/u);
  });

  it("allows NUL bytes in an explicit binary format / 명시적인 binary format의 NUL byte를 허용한다", async () => {
    const root = createRepository();
    writeFileSync(join(root, "logo.png"), Buffer.from([0, 1, 2, 3]));

    await expect(release.verifyReleaseRepository(root)).resolves.toBeUndefined();
  });

  it("rejects removed packages in the new scope / 새 scope의 제거된 package를 거부한다", async () => {
    const root = createRepository();
    const removedPackageName = `${PUBLIC_PACKAGE_SCOPE}/queue-core`;
    mkdirSync(join(root, "packages", "core", "src"), { recursive: true });
    writeFileSync(join(root, "packages", "core", "src", "legacy.ts"), `export * from "${removedPackageName}";\n`);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/@rv-nest-batch\/queue-core/u);
  });

  it("does not skip an active source subtree named dist / dist 이름의 active source subtree를 건너뛰지 않는다", async () => {
    const root = createRepository();
    const previousCore = `${["@nest", "batch"].join("-")}/core`;
    const legacyPath = join(root, "packages", "core", "src", "dist", "legacy.ts");
    mkdirSync(dirname(legacyPath), { recursive: true });
    writeFileSync(legacyPath, `export * from "${previousCore}";\n`);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(previousCore);
  });

  it("does not exempt a docs superpowers file / docs superpowers 일반 파일을 면제하지 않는다", async () => {
    const root = createRepository();
    const previousCore = `${["@nest", "batch"].join("-")}/core`;
    writeFileSync(join(root, "docs", "superpowers"), `Historical package: ${previousCore}.\n`);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(previousCore);
  });

  it("rejects a docs superpowers symlink / docs superpowers symlink를 거부한다", async () => {
    const root = createRepository();
    const target = join(root, "history.md");
    writeFileSync(target, "history\n");
    symlinkSync(target, join(root, "docs", "superpowers"));

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/docs[\\/]superpowers: symbolic links/u);
  });

  it("rejects a removed package name outside historical docs / 과거 문서 밖의 제거된 package 이름을 거부한다", async () => {
    const root = createRepository();
    const removedName = `${PUBLIC_PACKAGE_SCOPE}/queue-core`;
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
    const removedName = `${PUBLIC_PACKAGE_SCOPE}/scheduler-core`;
    mkdirSync(join(root, "e2e"), { recursive: true });
    writeFileSync(join(root, "e2e/legacy.e2e.test.ts"), `import "${removedName}";\n`);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/e2e.*removed package name/u);
  });

  it("rejects a removed package name in a root document / root 문서의 제거된 package 이름을 거부한다", async () => {
    const root = createRepository();
    const removedName = `${PUBLIC_PACKAGE_SCOPE}/polling-core`;
    writeFileSync(join(root, "DATABASE.md"), `Do not install ${removedName}.\n`);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/DATABASE\.md.*removed package name/u);
  });

  it("allows removed package history only under docs superpowers / docs superpowers 아래의 과거 package 기록만 허용한다", async () => {
    const root = createRepository();
    const removedName = `${PUBLIC_PACKAGE_SCOPE}/worker-threads`;
    const previousCore = `${["@nest", "batch"].join("-")}/core`;
    mkdirSync(join(root, "docs/superpowers/specs"), { recursive: true });
    writeFileSync(join(root, "docs/superpowers/specs/history.md"), `Historical packages: ${previousCore}, ${removedName}.\n`);

    await expect(release.verifyReleaseRepository(root)).resolves.toBeUndefined();
  });

  it("rejects a package LICENSE that differs from root / root와 다른 package LICENSE를 거부한다", async () => {
    const root = createRepository(undefined, (packageInfo) =>
      packageInfo.name === "@rv-nest-batch/core" ? "Different license\n" : LICENSE_TEXT
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
    writeFileSync(releasingGuide, readFileSync(releasingGuide, "utf8").replace("`@rv-nest-batch/cli`\n", ""));

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/docs\/releasing\.md.*@rv-nest-batch\/cli/);
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

  it.each([
    ["reviewed bootstrap candidate", "검토된 bootstrap candidate", BOOTSTRAP_CANDIDATE_CHECKLIST_ITEM],
    ["one-time bootstrap exception", "일회성 bootstrap 예외", BOOTSTRAP_CANDIDATE_RULE],
    ["mandatory later Version PR", "후속 Version PR 필수 규칙", LATER_VERSION_PR_RULE]
  ])("rejects a release checklist without the %s / %s이 없는 릴리즈 checklist를 거부한다", async (_english, _korean, requirement) => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(releasingGuide, readFileSync(releasingGuide, "utf8").replace(requirement, "누락된 release candidate 규칙"));

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/release candidate|Version PR|0\.1\.0/u);
  });

  it.each([
    ["manual prerequisite", "수동 prerequisite", ACTIONS_PR_SETTING_CHECKLIST_ITEM],
    ["repository setting path", "repository setting 경로", ACTIONS_PR_SETTING_PATH],
    ["repository setting name", "repository setting 이름", ACTIONS_PR_SETTING_NAME],
    ["read-only audit state", "read-only audit 상태", ACTIONS_PR_SETTING_AUDIT]
  ])("rejects a release checklist without the GitHub Actions pull request %s / GitHub Actions pull request %s이 없는 릴리즈 checklist를 거부한다", async (_english, _korean, requirement) => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(releasingGuide, readFileSync(releasingGuide, "utf8").replace(requirement, "누락된 GitHub Actions 설정"));

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/GitHub Actions|Workflow permissions|pull request|can_approve_pull_request_reviews/u);
  });

  it("rejects the GitHub Actions pull request prerequisite after the Version PR gate / Version PR gate 뒤의 GitHub Actions pull request prerequisite를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    const versionPrChecklistItem = "- [ ] Changesets Version PR workflow 승인과 CI 성공 확인 후 merge";
    const guide = readFileSync(releasingGuide, "utf8")
      .replace(`${ACTIONS_PR_SETTING_CHECKLIST_ITEM}\n`, "")
      .replace(`${versionPrChecklistItem}\n`, `${versionPrChecklistItem}\n${ACTIONS_PR_SETTING_CHECKLIST_ITEM}\n`);
    writeFileSync(releasingGuide, guide);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/approved order|GitHub Actions.*Version PR/u);
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

  it("rejects a Version PR checklist item moved after local candidate checks / local candidate 검증 뒤로 이동한 Version PR checklist를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    const versionItem = "- [ ] Changesets Version PR workflow 승인과 CI 성공 확인 후 merge";
    const localCheck = "- [ ] `pnpm release:check` 성공";
    const guide = readFileSync(releasingGuide, "utf8")
      .replace(`${versionItem}\n`, "")
      .replace(`${localCheck}\n`, `${localCheck}\n${versionItem}\n`);
    writeFileSync(releasingGuide, guide);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/Version PR.*local candidate|approved order/u);
  });

  it("rejects Version PR checks ordered before workflow approval / workflow 승인보다 앞선 Version PR check를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    const approval = "각 Changesets Version PR이 생성되거나 갱신될 때마다 write 권한 maintainer가 PR merge box에서 **Approve workflows to run**을 클릭합니다.";
    const checks = "**Quality (Node 20.18.3)**, **Quality (Node 24)**, **E2E (Node 24)** check가 모두 성공한 뒤에만 Version PR을 merge합니다.";
    const guide = readFileSync(releasingGuide, "utf8")
      .replace(approval, "__VERSION_PR_APPROVAL__")
      .replace(checks, approval)
      .replace("__VERSION_PR_APPROVAL__", checks);
    writeFileSync(releasingGuide, guide);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/release guide flow.*approved order/u);
  });

  it("rejects identity audits moved after bootstrap publish / bootstrap publish 뒤로 이동한 identity audit를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    const identityAuditBlock = PUBLIC_PACKAGES
      .map(({ name }) => `npm view ${name} name version maintainers repository dist-tags --json --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}`)
      .join("\n");
    const bootstrap = "- [ ] `pnpm run release:publish --tag v0.1.0`을 maintainer가 직접 실행";
    const guide = readFileSync(releasingGuide, "utf8")
      .replace(`${identityAuditBlock}\n`, "")
      .replace(`${bootstrap}\n`, `${bootstrap}\n${identityAuditBlock}\n`);
    writeFileSync(releasingGuide, guide);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/release guide flow.*identity audit/u);
  });

  it.each([
    ["Trusted Publisher setup", "Trusted Publisher 설정", "- [ ] owner `kangjuhyup`, repository `nest-batch`, workflow `publish.yml`, environment `npm` 등록"],
    ["release tag creation", "release tag 생성", "- [ ] `git tag -s vX.Y.Z <release-commit>`"],
    ["OIDC provenance confirmation", "OIDC provenance 확인", "처음으로 OIDC publish되는 후속 version부터 provenance를 필수로 확인합니다."]
  ])("rejects bootstrap publish moved after %s / %s 뒤로 이동한 bootstrap publish를 거부한다", async (_english, _korean, laterStep) => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    const bootstrap = "- [ ] `pnpm run release:publish --tag v0.1.0`을 maintainer가 직접 실행";
    const guide = readFileSync(releasingGuide, "utf8")
      .replace(`${bootstrap}\n`, "")
      .replace(laterStep, `${laterStep}\n${bootstrap}`);
    writeFileSync(releasingGuide, guide);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/bootstrap publish.*before/u);
  });

  it("rejects local E2E moved after signed tag creation / signed tag 생성 뒤로 이동한 local E2E를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    const localE2e = "- [ ] `pnpm test:e2e` 성공";
    const tagCreation = "- [ ] `git tag -s vX.Y.Z <release-commit>`";
    const guide = readFileSync(releasingGuide, "utf8")
      .replace(`${localE2e}\n`, "")
      .replace(`${tagCreation}\n`, `${tagCreation}\n${localE2e}\n`);
    writeFileSync(releasingGuide, guide);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/release guide flow|approved order/u);
  });

  it("rejects release check and E2E moved after signed tag creation / signed tag 생성 뒤로 함께 이동한 release check와 E2E를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    const localChecks = "- [ ] `pnpm release:check` 성공\n- [ ] `pnpm test:e2e` 성공";
    const tagCreation = "- [ ] `git tag -s vX.Y.Z <release-commit>`";
    const guide = readFileSync(releasingGuide, "utf8")
      .replace(`${localChecks}\n`, "")
      .replace(`${tagCreation}\n`, `${tagCreation}\n${localChecks}\n`);
    writeFileSync(releasingGuide, guide);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/release guide flow|approved order/u);
  });

  it("rejects identity audits moved before the bootstrap section / bootstrap section 앞쪽으로 이동한 identity audit를 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    const identityAuditBlock = PUBLIC_PACKAGES
      .map(({ name }) => `npm view ${name} name version maintainers repository dist-tags --json --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}`)
      .join("\n");
    const bootstrapHeading = "## 2. 최초 0.1.0 bootstrap";
    const guide = readFileSync(releasingGuide, "utf8")
      .replace(`${identityAuditBlock}\n`, "")
      .replace(bootstrapHeading, `${identityAuditBlock}\n\n${bootstrapHeading}`);
    writeFileSync(releasingGuide, guide);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/release guide flow|approved order/u);
  });

  it("rejects Trusted Publisher setup moved before its section / 해당 section 앞쪽으로 이동한 Trusted Publisher 설정을 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    const bootstrap = "- [ ] `pnpm run release:publish --tag v0.1.0`을 maintainer가 직접 실행";
    const trustedPublisher = "- [ ] owner `kangjuhyup`, repository `nest-batch`, workflow `publish.yml`, environment `npm` 등록";
    const guide = readFileSync(releasingGuide, "utf8")
      .replace(`${trustedPublisher}\n`, "")
      .replace(`${bootstrap}\n`, `${bootstrap}\n${trustedPublisher}\n`);
    writeFileSync(releasingGuide, guide);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/release guide flow|approved order/u);
  });

  it("rejects signed tag creation moved before the tag section / tag section 앞쪽으로 이동한 signed tag 생성을 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    const trustedPublisher = "- [ ] owner `kangjuhyup`, repository `nest-batch`, workflow `publish.yml`, environment `npm` 등록";
    const tagCreation = "- [ ] `git tag -s vX.Y.Z <release-commit>`";
    const guide = readFileSync(releasingGuide, "utf8")
      .replace(`${tagCreation}\n`, "")
      .replace(`${trustedPublisher}\n`, `${trustedPublisher}\n${tagCreation}\n`);
    writeFileSync(releasingGuide, guide);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/release guide flow|approved order/u);
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
        `npm view @rv-nest-batch/cli name version maintainers repository dist-tags --json --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}\n`,
        ""
      )
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/docs\/releasing\.md.*npm view @rv-nest-batch\/cli/);
  });

  it("rejects an old-scope npm audit command / 이전 scope npm audit 명령을 거부한다", async () => {
    const root = createRepository();
    const guide = join(root, "docs", "releasing.md");
    const previousCore = `${["@nest", "batch"].join("-")}/core`;
    writeFileSync(
      guide,
      readFileSync(guide, "utf8").replace(
        "npm view @rv-nest-batch/core",
        `npm view ${previousCore}`
      )
    );

    await expect(release.verifyReleaseRepository(root))
      .rejects.toThrow(/@rv-nest-batch\/core|@nest-batch\/core/u);
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

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/@rv-nest-batch:registry/u);
  });

  it("rejects a bare code-form npm whoami command / registry가 없는 code 형태 npm whoami 명령을 거부한다", async () => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(
      releasingGuide,
      readFileSync(releasingGuide, "utf8").replace(
        "npm 계정과 2FA 상태 확인",
        "`npm whoami`와 2FA 상태 확인"
      )
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/bare.*npm whoami|npm whoami.*registry/u);
  });

  it.each([
    ["fenced npm whoami", "fence의 npm whoami", "```bash\nnpm whoami\n```"],
    ["inline npm whoami", "inline npm whoami", "`npm whoami --json`"],
    ["fenced npm profile get", "fence의 npm profile get", "```sh\nnpm profile get\n```"],
    ["inline npm profile get", "inline npm profile get", "`npm profile get`"],
    ["fenced npm view", "fence의 npm view", `\`\`\`shell\nnpm view ${PUBLIC_PACKAGE_SCOPE}/core version\n\`\`\``],
    ["inline npm view", "inline npm view", `\`npm view ${PUBLIC_PACKAGE_SCOPE}/core version\``]
  ])("rejects an additional unsafe %s / 추가된 안전하지 않은 %s 명령을 거부한다", async (_english, _korean, unsafeCommand) => {
    const root = createRepository();
    const releasingGuide = join(root, "docs", "releasing.md");
    writeFileSync(releasingGuide, `${readFileSync(releasingGuide, "utf8")}\n${unsafeCommand}\n`);

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/registry-touching.*npm (?:whoami|profile get|view)|npm (?:whoami|profile get|view).*registry/u);
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
        `npm view @rv-nest-batch/cli@0.1.0 version dist.integrity --json --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}\n`,
        ""
      )
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/npm view @rv-nest-batch\/cli@0\.1\.0/u);
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

  it.each([
    ["source tree", "source tree", "https://github.com/kangjuhyup/nest-batch/tree/main/packages/core/src"],
    ["LICENSE blob", "LICENSE blob", "https://github.com/kangjuhyup/nest-batch/blob/main/LICENSE"]
  ])("rejects a package README %s link to the nonexistent main branch / 존재하지 않는 main branch를 가리키는 package README %s link를 거부한다", async (_english, _korean, brokenLink) => {
    const root = await mkdtemp(join(tmpdir(), "nest-batch-readme-test-"));
    const packageInfo = PUBLIC_PACKAGES[0];
    const packageDirectory = join(root, packageInfo.directory);

    try {
      await mkdir(packageDirectory, { recursive: true });
      await writeFile(
        join(packageDirectory, "README.md"),
        `${createPackageReadme(packageInfo)}\n[Broken branch link](${brokenLink})\n`
      );

      await expect(verifyPackageDocuments(root, packageInfo)).rejects.toThrow(/main branch|(?:tree|blob)\/main/u);
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

  it("rejects a CLI README missing a directly imported dependency from install / 직접 import한 dependency가 install에서 빠진 CLI README를 거부한다", async () => {
    const root = await mkdtemp(join(tmpdir(), "nest-batch-readme-test-"));
    const packageInfo = PUBLIC_PACKAGES.find(({ name }) => name === `${PUBLIC_PACKAGE_SCOPE}/cli`)!;
    const packageDirectory = join(root, packageInfo.directory);
    const fullInstall = `pnpm add ${PUBLIC_PACKAGE_SCOPE}/cli ${PUBLIC_PACKAGE_SCOPE}/core ${PUBLIC_PACKAGE_SCOPE}/inmemory`;

    try {
      await mkdir(packageDirectory, { recursive: true });
      await writeFile(
        join(packageDirectory, "README.md"),
        createPackageReadme(packageInfo).replace(
          fullInstall,
          `pnpm add ${PUBLIC_PACKAGE_SCOPE}/cli ${PUBLIC_PACKAGE_SCOPE}/core`
        )
      );

      await expect(verifyPackageDocuments(root, packageInfo)).rejects.toThrow(/inmemory|direct install dependency/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
