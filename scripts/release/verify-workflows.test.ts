import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyWorkflowFiles } from "./verify-workflows.mjs";

const ACTION_PINS = {
  checkout: "d23441a48e516b6c34aea4fa41551a30e30af803",
  setupNode: "249970729cb0ef3589644e2896645e5dc5ba9c38",
  setupPnpm: "0977fd99725f1db4007ccb2928dbb4e90d06cc86",
  versionPackages: "8488615a623b1b9c987934bb89eae8af6a946ac1"
} as const;

const workflowSources = () => ({
  ".github/workflows/ci.yml": `name: CI
on:
  pull_request:
  push:
    branches: [develop]
jobs:
  quality:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    strategy:
      matrix:
        node: ["20.18.3", "24"]
    steps:
      - uses: actions/checkout@${ACTION_PINS.checkout}
      - uses: pnpm/action-setup@${ACTION_PINS.setupPnpm}
      - uses: actions/setup-node@${ACTION_PINS.setupNode}
        with:
          node-version: \${{ matrix.node }}
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
      - if: matrix.node == '24'
        run: |
          pnpm release:verify
          pnpm release:smoke
  e2e:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    services:
      postgres:
        image: postgres:16-alpine
      mysql:
        image: mysql:8.4
      mariadb:
        image: mariadb:11.4
      redis:
        image: redis:7-alpine
    steps:
      - uses: actions/checkout@${ACTION_PINS.checkout}
      - uses: pnpm/action-setup@${ACTION_PINS.setupPnpm}
      - uses: actions/setup-node@${ACTION_PINS.setupNode}
        with:
          node-version: "24"
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:e2e
`,
  ".github/workflows/release-pr.yml": `name: Version packages
on:
  push:
    branches: [develop]
permissions:
  {}
jobs:
  version:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: changesets/action/version@${ACTION_PINS.versionPackages}
        id: version
        with:
          script: pnpm release:version
          commit-message: "chore : package version 업데이트"
          pr-title: "chore : package version 업데이트"
          pr-base-branch: develop
      - if: steps.version.outputs.pr-number != ''
        env:
          GITHUB_TOKEN: \${{ github.token }}
        run: |
          gh label create release --force
          gh pr edit "\${{ steps.version.outputs.pr-number }}" --add-label release
`,
  ".github/workflows/publish.yml": `name: Publish packages
on:
  push:
    tags: ["v*.*.*"]
permissions:
  {}
jobs:
  publish:
    runs-on: ubuntu-latest
    environment: npm
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@${ACTION_PINS.checkout}
      - uses: pnpm/action-setup@${ACTION_PINS.setupPnpm}
      - uses: actions/setup-node@${ACTION_PINS.setupNode}
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
`,
  ".github/release.yml": `changelog:
  exclude:
    labels: [release]
  categories:
    - title: Features
      labels: [feature, enhancement]
    - title: Other Changes
      labels: ["*"]
`
});

const temporaryRoots: string[] = [];

const createWorkflowRepository = async (
  mutate: (sources: Record<string, string>) => void = () => undefined
) => {
  const root = await mkdtemp(join(tmpdir(), "nest-batch-workflow-test-"));
  temporaryRoots.push(root);
  const sources = workflowSources();
  mutate(sources);

  for (const [path, source] of Object.entries(sources)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), source);
  }

  return root;
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("release workflow validation / 릴리즈 workflow 검증", () => {
  it("accepts minimally complete pinned workflows / 최소 완성 pinned workflow를 허용한다", async () => {
    await expect(verifyWorkflowFiles(await createWorkflowRepository())).resolves.toBeUndefined();
  });

  it("rejects a workflow that exposes a token environment variable / token 환경 변수를 노출한 workflow를 거부한다", async () => {
    const root = await createWorkflowRepository((sources) => {
      sources[".github/workflows/publish.yml"] = sources[".github/workflows/publish.yml"].replace(
        "    steps:\n",
        "    env:\n      NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}\n    steps:\n"
      );
    });

    await expect(verifyWorkflowFiles(root)).rejects.toThrow(/NODE_AUTH_TOKEN|NPM_TOKEN/);
  });

  it("rejects an action referenced by a major tag / major tag로 참조한 action을 거부한다", async () => {
    const root = await createWorkflowRepository((sources) => {
      sources[".github/workflows/ci.yml"] = sources[".github/workflows/ci.yml"].replace(
        `actions/checkout@${ACTION_PINS.checkout}`,
        "actions/checkout@v6"
      );
    });

    await expect(verifyWorkflowFiles(root)).rejects.toThrow(/40-character commit SHA|actions\/checkout/);
  });

  it("rejects publish without OIDC permission / OIDC 권한이 없는 publish를 거부한다", async () => {
    const root = await createWorkflowRepository((sources) => {
      sources[".github/workflows/publish.yml"] = sources[".github/workflows/publish.yml"].replace(
        "id-token: write",
        "id-token: read"
      );
    });

    await expect(verifyWorkflowFiles(root)).rejects.toThrow(/id-token.*write/);
  });

  it("rejects unsupported root-action version input / 지원하지 않는 root action version input을 거부한다", async () => {
    const root = await createWorkflowRepository((sources) => {
      sources[".github/workflows/release-pr.yml"] = sources[".github/workflows/release-pr.yml"].replace(
        "script: pnpm release:version",
        "version-script: pnpm release:version"
      );
    });

    await expect(verifyWorkflowFiles(root)).rejects.toThrow(/version-only Changesets action.*script/);
  });
});
