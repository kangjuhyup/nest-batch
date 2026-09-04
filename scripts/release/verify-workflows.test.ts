import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyWorkflowFiles } from "./verify-workflows.mjs";

const ACTION_PINS = {
  checkout: "d23441a48e516b6c34aea4fa41551a30e30af803",
  setupNode: "249970729cb0ef3589644e2896645e5dc5ba9c38",
  setupPnpm: "0977fd99725f1db4007ccb2928dbb4e90d06cc86",
  changesets: "8488615a623b1b9c987934bb89eae8af6a946ac1"
} as const;

type WorkflowSources = Record<string, string>;
type Mutation = (sources: WorkflowSources) => void;

const workflowSources = (): WorkflowSources => ({
  ".github/workflows/ci.yml": `name: CI
on:
  pull_request: {}
  push:
    branches:
      - develop
permissions: {}
jobs:
  quality:
    name: Quality (Node \${{ matrix.node }})
    runs-on: ubuntu-latest
    permissions:
      contents: read
    strategy:
      fail-fast: false
      matrix:
        node: ["20.18.3", "24"]
    steps:
      - name: Checkout
        uses: actions/checkout@${ACTION_PINS.checkout}
      - name: Setup pnpm
        uses: pnpm/action-setup@${ACTION_PINS.setupPnpm}
      - name: Setup Node.js
        uses: actions/setup-node@${ACTION_PINS.setupNode}
        with:
          node-version: \${{ matrix.node }}
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Typecheck
        run: pnpm typecheck
      - name: Unit test
        run: pnpm test
      - name: Build
        run: pnpm build
      - name: Verify release artifacts
        if: matrix.node == '24'
        run: |
          pnpm release:verify
          pnpm release:smoke
  e2e:
    name: E2E (Node 24)
    runs-on: ubuntu-latest
    permissions:
      contents: read
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: nest_batch
          POSTGRES_USER: nest_batch
          POSTGRES_PASSWORD: nest_batch
        ports: [15432:5432]
        options: >-
          --health-cmd "pg_isready -U nest_batch -d nest_batch"
          --health-interval 5s --health-timeout 5s --health-retries 12
      mysql:
        image: mysql:8.4
        env:
          MYSQL_DATABASE: nest_batch
          MYSQL_USER: nest_batch
          MYSQL_PASSWORD: nest_batch
          MYSQL_ROOT_PASSWORD: nest_batch_root
        ports: [13306:3306]
        options: >-
          --health-cmd "mysqladmin ping -h 127.0.0.1 -unest_batch -pnest_batch --silent"
          --health-interval 5s --health-timeout 5s --health-retries 20
      mariadb:
        image: mariadb:11.4
        env:
          MARIADB_DATABASE: nest_batch
          MARIADB_USER: nest_batch
          MARIADB_PASSWORD: nest_batch
          MARIADB_ROOT_PASSWORD: nest_batch_root
        ports: [13307:3306]
        options: >-
          --health-cmd "mariadb-admin ping -h 127.0.0.1 -unest_batch -pnest_batch --silent"
          --health-interval 5s --health-timeout 5s --health-retries 20
      redis:
        image: redis:7-alpine
        ports: [16379:6379]
        options: >-
          --health-cmd "redis-cli ping" --health-interval 5s
          --health-timeout 5s --health-retries 12
    steps:
      - name: Checkout
        uses: actions/checkout@${ACTION_PINS.checkout}
      - name: Setup pnpm
        uses: pnpm/action-setup@${ACTION_PINS.setupPnpm}
      - name: Setup Node.js
        uses: actions/setup-node@${ACTION_PINS.setupNode}
        with:
          node-version: "24"
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: E2E test
        run: pnpm test:e2e
`,
  ".github/workflows/release-pr.yml": `name: Version packages
on:
  push:
    branches:
      - develop
permissions: {}
jobs:
  version:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - name: Checkout
        uses: actions/checkout@${ACTION_PINS.checkout}
      - name: Setup pnpm
        uses: pnpm/action-setup@${ACTION_PINS.setupPnpm}
      - name: Setup Node.js
        uses: actions/setup-node@${ACTION_PINS.setupNode}
        with:
          node-version: "24"
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Create or update Version PR
        id: version
        uses: changesets/action@${ACTION_PINS.changesets}
        env:
          GITHUB_TOKEN: \${{ github.token }}
        with:
          version-script: pnpm release:version
          commit-message: "chore : package version 업데이트"
          pr-title: "chore : package version 업데이트"
          pr-base-branch: develop
          create-github-releases: false
          push-git-tags: false
      - name: Label Version PR
        if: steps.version.outputs.pr-number != ''
        env:
          GITHUB_TOKEN: \${{ github.token }}
        run: |
          gh label create release --force --color "5319e7" --description "Package version pull request"
          gh pr edit "\${{ steps.version.outputs.pr-number }}" --add-label release
`,
  ".github/workflows/publish.yml": `name: Publish packages
on:
  push:
    tags:
      - "v*.*.*"
permissions: {}
jobs:
  publish:
    runs-on: ubuntu-latest
    environment: npm
    permissions:
      contents: read
      id-token: write
    steps:
      - name: Checkout tag
        uses: actions/checkout@${ACTION_PINS.checkout}
      - name: Setup pnpm
        uses: pnpm/action-setup@${ACTION_PINS.setupPnpm}
      - name: Setup Node.js
        uses: actions/setup-node@${ACTION_PINS.setupNode}
        with:
          node-version: "24"
      - name: Install npm CLI with Trusted Publishing support
        run: npm install --global npm@12.0.2
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Verify release candidate
        run: pnpm release:check
      - name: Publish packages
        run: pnpm run release:publish --tag "$GITHUB_REF_NAME"
  github-release:
    needs: publish
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Create GitHub Release
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          if release_tag="$(gh release view "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" --json tagName --jq .tagName 2>/dev/null)"; then
            test "$release_tag" = "$GITHUB_REF_NAME"
            echo "GitHub Release already exists; skipping."
          else
            gh release create "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" --verify-tag --generate-notes --title "$GITHUB_REF_NAME"
          fi
`,
  ".github/release.yml": `changelog:
  exclude:
    labels:
      - release
  categories:
    - title: Features
      labels: [feature, enhancement]
    - title: Fixes
      labels: [bug, fix]
    - title: Documentation
      labels: [documentation]
    - title: Dependencies
      labels: [dependencies]
    - title: Maintenance
      labels: [chore, refactor]
    - title: Other Changes
      labels: ["*"]
`
});

const replace = (sources: WorkflowSources, path: string, current: string, replacement: string) => {
  if (!sources[path].includes(current)) {
    throw new Error(`Fixture mutation could not find ${JSON.stringify(current)} in ${path}.`);
  }

  sources[path] = sources[path].replace(current, replacement);
};

const temporaryRoots: string[] = [];

const createWorkflowRepository = async (mutate: Mutation = () => undefined) => {
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

const rejectsMutation = async (mutate: Mutation) => {
  await expect(verifyWorkflowFiles(await createWorkflowRepository(mutate))).rejects.toThrow(/Release workflow verification failed|YAML/u);
};

describe("release workflow validation / 릴리즈 workflow 검증", () => {
  it("accepts the exact release workflow topology / 정확한 릴리즈 workflow 구성을 허용한다", async () => {
    await expect(verifyWorkflowFiles(await createWorkflowRepository())).resolves.toBeUndefined();
  });

  it.each([
    ["adds an extra publish trigger", "publish trigger를 추가한다", (sources: WorkflowSources) => replace(sources, ".github/workflows/publish.yml", "on:\n  push:", "on:\n  pull_request: {}\n  push:")],
    ["adds a publish branch trigger", "publish branch trigger를 추가한다", (sources: WorkflowSources) => replace(sources, ".github/workflows/publish.yml", "    tags:\n", "    branches: [develop]\n    tags:\n")],
    ["changes the CI push branch", "CI push branch를 바꾼다", (sources: WorkflowSources) => replace(sources, ".github/workflows/ci.yml", "      - develop", "      - main")],
    ["changes the publish tag pattern", "publish tag pattern을 바꾼다", (sources: WorkflowSources) => replace(sources, ".github/workflows/publish.yml", '"v*.*.*"', '"release-*"')],
    ["makes pull request false", "pull request를 false로 만든다", (sources: WorkflowSources) => replace(sources, ".github/workflows/ci.yml", "pull_request: {}", "pull_request: false")],
    ["moves publish ahead of release verification", "release 검증보다 publish를 앞당긴다", (sources: WorkflowSources) => replace(sources, ".github/workflows/publish.yml", "      - name: Verify release candidate\n        run: pnpm release:check\n      - name: Publish packages\n        run: pnpm run release:publish --tag \"$GITHUB_REF_NAME\"", "      - name: Publish packages\n        run: pnpm run release:publish --tag \"$GITHUB_REF_NAME\"\n      - name: Verify release candidate\n        run: pnpm release:check")],
    ["replaces release check with echo", "release check를 echo로 바꾼다", (sources: WorkflowSources) => replace(sources, ".github/workflows/publish.yml", "run: pnpm release:check", "run: echo 'pnpm release:check'")],
    ["adds registry auth configuration", "registry auth 설정을 추가한다", (sources: WorkflowSources) => replace(sources, ".github/workflows/publish.yml", "          node-version: \"24\"", "          node-version: \"24\"\n          registry-url: https://registry.npmjs.org")],
    ["adds a secret credential", "secret credential을 추가한다", (sources: WorkflowSources) => replace(sources, ".github/workflows/publish.yml", "    steps:\n", "    env:\n      RELEASE_CREDENTIAL: \${{ secrets.RELEASE_CREDENTIAL }}\n    steps:\n")],
    ["adds a privileged rogue job", "권한 있는 rogue job을 추가한다", (sources: WorkflowSources) => {
      sources[".github/workflows/publish.yml"] += `  rogue-publish:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n      id-token: write\n    steps:\n      - run: npm publish\n`;
    }],
    ["runs GitHub release after failure", "실패 뒤 GitHub release를 실행한다", (sources: WorkflowSources) => replace(sources, ".github/workflows/publish.yml", "    runs-on: ubuntu-latest\n    permissions:\n      contents: write", "    runs-on: ubuntu-latest\n    if: always()\n    permissions:\n      contents: write")],
    ["allows release verification failure", "release 검증 실패를 허용한다", (sources: WorkflowSources) => replace(sources, ".github/workflows/publish.yml", "      - name: Verify release candidate\n        run: pnpm release:check", "      - name: Verify release candidate\n        continue-on-error: true\n        run: pnpm release:check")],
    ["removes explicit GitHub repository target", "명시 GitHub repository target을 제거한다", (sources: WorkflowSources) => replace(sources, ".github/workflows/publish.yml", " --repo \"$GITHUB_REPOSITORY\"", "")],
    ["removes the idempotent GitHub release lookup", "멱등 GitHub release 조회를 제거한다", (sources: WorkflowSources) => replace(sources, ".github/workflows/publish.yml", "gh release view", "gh release inspect")],
    ["removes the existing release tag check", "기존 release tag 검사를 제거한다", (sources: WorkflowSources) => replace(sources, ".github/workflows/publish.yml", "test \"$release_tag\" = \"$GITHUB_REF_NAME\"", "true")],
    ["changes the reviewed action owner", "검토한 action owner를 바꾼다", (sources: WorkflowSources) => replace(sources, ".github/workflows/ci.yml", `actions/checkout@${ACTION_PINS.checkout}`, `unreviewed/checkout@${ACTION_PINS.checkout}`)],
    ["uses a movable action tag", "이동 가능한 action tag를 사용한다", (sources: WorkflowSources) => replace(sources, ".github/workflows/ci.yml", `actions/checkout@${ACTION_PINS.checkout}`, "actions/checkout@v6")],
    ["uses a wrong reviewed action SHA", "검토한 action의 잘못된 SHA를 사용한다", (sources: WorkflowSources) => replace(sources, ".github/workflows/ci.yml", ACTION_PINS.checkout, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")],
    ["uses the version-only Changesets action", "version-only Changesets action을 사용한다", (sources: WorkflowSources) => replace(sources, ".github/workflows/release-pr.yml", `changesets/action@${ACTION_PINS.changesets}`, `changesets/action/version@${ACTION_PINS.changesets}`)],
    ["changes the Changesets no-op input", "Changesets no-op input을 바꾼다", (sources: WorkflowSources) => replace(sources, ".github/workflows/release-pr.yml", "create-github-releases: false", "create-github-releases: true")],
    ["changes the CI matrix", "CI matrix를 바꾼다", (sources: WorkflowSources) => replace(sources, ".github/workflows/ci.yml", 'node: ["20.18.3", "24"]', 'node: ["24"]')],
    ["changes an E2E service image", "E2E service image를 바꾼다", (sources: WorkflowSources) => replace(sources, ".github/workflows/ci.yml", "image: redis:7-alpine", "image: redis:6-alpine")],
    ["changes an E2E service environment", "E2E service environment를 바꾼다", (sources: WorkflowSources) => replace(sources, ".github/workflows/ci.yml", "POSTGRES_DB: nest_batch", "POSTGRES_DB: other")],
    ["changes a service healthcheck", "service healthcheck를 바꾼다", (sources: WorkflowSources) => replace(sources, ".github/workflows/ci.yml", "--health-retries 20", "--health-retries 19")],
    ["changes an E2E service port", "E2E service port를 바꾼다", (sources: WorkflowSources) => replace(sources, ".github/workflows/ci.yml", "ports: [16379:6379]", "ports: [16380:6379]")],
    ["changes setup action order", "setup action 순서를 바꾼다", (sources: WorkflowSources) => replace(sources, ".github/workflows/ci.yml", `      - name: Setup pnpm\n        uses: pnpm/action-setup@${ACTION_PINS.setupPnpm}\n      - name: Setup Node.js\n        uses: actions/setup-node@${ACTION_PINS.setupNode}`, `      - name: Setup Node.js\n        uses: actions/setup-node@${ACTION_PINS.setupNode}\n      - name: Setup pnpm\n        uses: pnpm/action-setup@${ACTION_PINS.setupPnpm}`)],
    ["adds publish setup-node cache", "publish setup-node cache를 추가한다", (sources: WorkflowSources) => replace(sources, ".github/workflows/publish.yml", "          node-version: \"24\"", "          node-version: \"24\"\n          cache: pnpm")],
    ["removes release categories", "release category를 제거한다", (sources: WorkflowSources) => replace(sources, ".github/release.yml", "  categories:\n", "  categories: []\n  #")],
    ["changes wildcard category", "wildcard category를 바꾼다", (sources: WorkflowSources) => replace(sources, ".github/release.yml", 'labels: ["*"]', "labels: [other]")]
  ])("rejects workflow mutation: %s / %s", async (_englishLabel, _koreanLabel, mutate) => {
    await rejectsMutation(mutate);
  });

  it.each([
    ["leading NBSP", "앞 NBSP", "\\u00A0pnpm release:check"],
    ["trailing NBSP", "뒤 NBSP", "pnpm release:check\\u00A0"],
    ["leading BOM", "앞 BOM", "\\uFEFFpnpm release:check"],
    ["trailing BOM", "뒤 BOM", "pnpm release:check\\uFEFF"],
    ["leading vertical tab", "앞 vertical tab", "\\u000Bpnpm release:check"],
    ["vertical tab", "vertical tab", "pnpm release:check\\u000B"],
    ["leading form feed", "앞 form feed", "\\u000Cpnpm release:check"],
    ["form feed", "form feed", "pnpm release:check\\u000C"],
    ["leading carriage return", "앞 carriage return", "\\rpnpm release:check"],
    ["carriage return", "carriage return", "pnpm release:check\\r"],
    ["Ogham space mark", "Ogham 공백", "pnpm release:check\\u1680"],
    ["en quad", "en quad 공백", "pnpm release:check\\u2000"],
    ["em quad", "em quad 공백", "pnpm release:check\\u2001"],
    ["en space", "en 공백", "pnpm release:check\\u2002"],
    ["em space", "em 공백", "pnpm release:check\\u2003"],
    ["three-per-em space", "3분의 1 em 공백", "pnpm release:check\\u2004"],
    ["four-per-em space", "4분의 1 em 공백", "pnpm release:check\\u2005"],
    ["six-per-em space", "6분의 1 em 공백", "pnpm release:check\\u2006"],
    ["figure space", "숫자 공백", "pnpm release:check\\u2007"],
    ["punctuation space", "구두점 공백", "pnpm release:check\\u2008"],
    ["thin space", "얇은 공백", "pnpm release:check\\u2009"],
    ["hair space", "hair 공백", "pnpm release:check\\u200A"],
    ["line separator", "줄 구분자", "pnpm release:check\\u2028"],
    ["paragraph separator", "문단 구분자", "pnpm release:check\\u2029"],
    ["narrow no-break space", "좁은 non-break 공백", "pnpm release:check\\u202F"],
    ["medium mathematical space", "중간 수학 공백", "pnpm release:check\\u205F"],
    ["ideographic space", "전각 공백", "pnpm release:check\\u3000"]
  ])("rejects shell-significant run whitespace: %s / %s", async (_englishLabel, _koreanLabel, command) => {
    await rejectsMutation((sources) => replace(
      sources,
      ".github/workflows/publish.yml",
      "run: pnpm release:check",
      `run: "${command}"`
    ));
  });

  it("rejects a block scalar without its final newline / block scalar 마지막 줄바꿈 누락을 거부한다", async () => {
    await rejectsMutation((sources) => replace(
      sources,
      ".github/workflows/ci.yml",
      "        run: |\n          pnpm release:verify",
      "        run: |-\n          pnpm release:verify"
    ));
  });

  it.each([
    ["rejects scalar permissions", "permissions scalar를 거부한다", (sources: WorkflowSources) => replace(sources, ".github/workflows/publish.yml", "permissions: {}", "permissions: read")],
    ["rejects scalar matrix values", "matrix scalar 값을 거부한다", (sources: WorkflowSources) => replace(sources, ".github/workflows/ci.yml", 'node: ["20.18.3", "24"]', 'node: "24"')],
    ["rejects duplicate YAML keys", "중복 YAML key를 거부한다", (sources: WorkflowSources) => replace(sources, ".github/workflows/ci.yml", "name: CI", "name: CI\nname: Duplicate")],
    ["rejects YAML anchors", "YAML anchor를 거부한다", (sources: WorkflowSources) => replace(sources, ".github/workflows/ci.yml", "name: CI", "name: &workflow CI")],
    ["rejects YAML aliases", "YAML alias를 거부한다", (sources: WorkflowSources) => replace(sources, ".github/workflows/ci.yml", "permissions: {}", "permissions: &permissions {}\ncopy: *permissions")]
  ])("rejects YAML structural mutation: %s / %s", async (_englishLabel, _koreanLabel, mutate) => {
    await rejectsMutation(mutate);
  });
});
