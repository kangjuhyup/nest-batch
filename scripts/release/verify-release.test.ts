import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const CHECKOUT_ACTION = "d23441a48e516b6c34aea4fa41551a30e30af803";
const SETUP_NODE_ACTION = "249970729cb0ef3589644e2896645e5dc5ba9c38";
const SETUP_PNPM_ACTION = "0977fd99725f1db4007ccb2928dbb4e90d06cc86";
const VERSION_PACKAGES_ACTION = "8488615a623b1b9c987934bb89eae8af6a946ac1";

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

const createWorkflowFixtures = (root: string) => {
  const workflowsDirectory = join(root, ".github/workflows");
  mkdirSync(workflowsDirectory, { recursive: true });
  writeFileSync(
    join(workflowsDirectory, "ci.yml"),
    `name: CI
on:
  pull_request:
  push:
    branches: [develop]
jobs: {}
`
  );
  writeFileSync(
    join(workflowsDirectory, "release-pr.yml"),
    `name: Version packages
on:
  push:
    branches: [develop]
permissions: {}
jobs:
  version:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@${CHECKOUT_ACTION}
      - uses: changesets/action/version@${VERSION_PACKAGES_ACTION}
        id: version
        with:
          script: pnpm release:version
      - if: steps.version.outputs.pr-number != ''
        env:
          GITHUB_TOKEN: \${{ github.token }}
        run: |
          gh label create release --force
          gh pr edit "\${{ steps.version.outputs.pr-number }}" --add-label release
`
  );
  writeFileSync(
    join(workflowsDirectory, "publish.yml"),
    `name: Publish packages
on:
  push:
    tags: ["v*.*.*"]
permissions: {}
jobs:
  publish:
    runs-on: ubuntu-latest
    environment: npm
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@${CHECKOUT_ACTION}
      - uses: pnpm/action-setup@${SETUP_PNPM_ACTION}
      - uses: actions/setup-node@${SETUP_NODE_ACTION}
      - run: npm install --global npm@12.0.2
      - run: pnpm install --frozen-lockfile
      - run: pnpm release:check
      - run: pnpm release:publish -- --tag "$GITHUB_REF_NAME"
  github-release:
    needs: publish
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - env:
          GH_TOKEN: \${{ github.token }}
        run: gh release create "$GITHUB_REF_NAME" --verify-tag --generate-notes --title "$GITHUB_REF_NAME"
`
  );
  writeFileSync(join(root, ".github/release.yml"), "changelog: {}\n");
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

    await expect(release.verifyReleaseRepository(root)).rejects.toThrow(/id-token.*write/);
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
