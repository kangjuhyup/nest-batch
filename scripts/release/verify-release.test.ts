import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CORE_SUBPATHS, PUBLIC_PACKAGES } from "./package-catalog.mjs";
import { validateManifest, verifyPackageDocuments } from "./verify-release.mjs";
import * as release from "./verify-release.mjs";

const REPOSITORY_URL = "https://github.com/kangjuhyup/nest-batch.git";
const HOMEPAGE = "https://github.com/kangjuhyup/nest-batch#readme";
const BUGS_URL = "https://github.com/kangjuhyup/nest-batch/issues";
const LICENSE_TEXT = "MIT License\n";
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const temporaryRoots: string[] = [];

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

- [ ] worktree가 clean이고 release commit이 \`develop\`에 포함됨
- [ ] 8개 package와 root version이 동일함
- [ ] \`pnpm release:check\` 성공
- [ ] \`pnpm test:e2e\` 성공

## 2. 최초 0.1.0 bootstrap

- [ ] npm에서 \`@nest-batch\` scope 권한 확인
  - 모든 catalog package의 identity를 먼저 read-only로 확인합니다.

\`\`\`bash
${PUBLIC_PACKAGES.map(({ name }) => `npm view ${name} name version maintainers repository dist-tags --json`).join("\n")}
\`\`\`

  - 기존 package는 승인된 repository identity와 ownership이 일치하거나 명시적인 transfer/rename 결정이 있어야 합니다. 그렇지 않으면 **STOP**합니다.
  - \`E404\`는 scope publish 권한을 확인한 뒤에만 bootstrap 후보입니다.
- [ ] \`npm whoami\`와 2FA 상태 확인
- [ ] \`pnpm run release:publish --tag v0.1.0\`을 maintainer가 직접 실행
- [ ] 8개 package의 \`0.1.0\`과 integrity 확인

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
      publishConfig: { access: "public" }
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
  });

  it("rejects missing public access / public access 누락을 거부한다", () => {
    expect(() => validateManifest({ name: "@nest-batch/core", version: "0.1.0" }, "packages/core"))
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
        "npm view @nest-batch/cli name version maintainers repository dist-tags --json\n",
        ""
      )
    );

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/docs\/releasing\.md.*npm view @nest-batch\/cli/);
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
