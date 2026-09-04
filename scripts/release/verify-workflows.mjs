import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseDocument, visit } from "yaml";

const WORKFLOW_FILES = [".github/workflows/ci.yml", ".github/workflows/release-pr.yml", ".github/workflows/publish.yml"];
const RELEASE_FILES = [...WORKFLOW_FILES, ".github/release.yml"];
const ACTION_PINS = {
  "actions/checkout": "d23441a48e516b6c34aea4fa41551a30e30af803",
  "actions/setup-node": "249970729cb0ef3589644e2896645e5dc5ba9c38",
  "pnpm/action-setup": "0977fd99725f1db4007ccb2928dbb4e90d06cc86",
  "changesets/action": "8488615a623b1b9c987934bb89eae8af6a946ac1"
};
const SHA_PIN = /^([^@\s]+)@([0-9a-f]{40})$/u;
const FORBIDDEN_WORKFLOW_CONFIGURATION = [
  /\$\{\{\s*secrets\.[^}]+\}\}/iu,
  /\b(?:NPM_TOKEN|NODE_AUTH_TOKEN)\b/u,
  /(?:\b(?:registry-url|always-auth|_auth(?:Token)?|npm_config_[A-Za-z0-9_]*(?:auth|token))\b|\.npmrc)/iu
];

const EXPECTED_FILES = {
  ".github/workflows/ci.yml": {
    name: "CI",
    on: {
      pull_request: {},
      push: { branches: ["develop"] }
    },
    permissions: {},
    jobs: {
      quality: {
        name: "Quality (Node ${{ matrix.node }})",
        "runs-on": "ubuntu-latest",
        permissions: { contents: "read" },
        strategy: {
          "fail-fast": false,
          matrix: { node: ["20.18.3", "24"] }
        },
        steps: [
          { name: "Checkout", uses: `actions/checkout@${ACTION_PINS["actions/checkout"]}` },
          { name: "Setup pnpm", uses: `pnpm/action-setup@${ACTION_PINS["pnpm/action-setup"]}` },
          {
            name: "Setup Node.js",
            uses: `actions/setup-node@${ACTION_PINS["actions/setup-node"]}`,
            with: { "node-version": "${{ matrix.node }}", cache: "pnpm" }
          },
          { name: "Install dependencies", run: "pnpm install --frozen-lockfile" },
          { name: "Typecheck", run: "pnpm typecheck" },
          { name: "Unit test", run: "pnpm test" },
          { name: "Build", run: "pnpm build" },
          {
            name: "Verify release artifacts",
            if: "matrix.node == '24'",
            run: "pnpm release:verify\npnpm release:smoke\n"
          }
        ]
      },
      e2e: {
        name: "E2E (Node 24)",
        "runs-on": "ubuntu-latest",
        permissions: { contents: "read" },
        services: {
          postgres: {
            image: "postgres:16-alpine",
            env: {
              POSTGRES_DB: "nest_batch",
              POSTGRES_USER: "nest_batch",
              POSTGRES_PASSWORD: "nest_batch"
            },
            ports: ["15432:5432"],
            options: "--health-cmd \"pg_isready -U nest_batch -d nest_batch\" --health-interval 5s --health-timeout 5s --health-retries 12"
          },
          mysql: {
            image: "mysql:8.4",
            env: {
              MYSQL_DATABASE: "nest_batch",
              MYSQL_USER: "nest_batch",
              MYSQL_PASSWORD: "nest_batch",
              MYSQL_ROOT_PASSWORD: "nest_batch_root"
            },
            ports: ["13306:3306"],
            options: "--health-cmd \"mysqladmin ping -h 127.0.0.1 -unest_batch -pnest_batch --silent\" --health-interval 5s --health-timeout 5s --health-retries 20"
          },
          mariadb: {
            image: "mariadb:11.4",
            env: {
              MARIADB_DATABASE: "nest_batch",
              MARIADB_USER: "nest_batch",
              MARIADB_PASSWORD: "nest_batch",
              MARIADB_ROOT_PASSWORD: "nest_batch_root"
            },
            ports: ["13307:3306"],
            options: "--health-cmd \"mariadb-admin ping -h 127.0.0.1 -unest_batch -pnest_batch --silent\" --health-interval 5s --health-timeout 5s --health-retries 20"
          },
          redis: {
            image: "redis:7-alpine",
            ports: ["16379:6379"],
            options: "--health-cmd \"redis-cli ping\" --health-interval 5s --health-timeout 5s --health-retries 12"
          }
        },
        steps: [
          { name: "Checkout", uses: `actions/checkout@${ACTION_PINS["actions/checkout"]}` },
          { name: "Setup pnpm", uses: `pnpm/action-setup@${ACTION_PINS["pnpm/action-setup"]}` },
          {
            name: "Setup Node.js",
            uses: `actions/setup-node@${ACTION_PINS["actions/setup-node"]}`,
            with: { "node-version": "24", cache: "pnpm" }
          },
          { name: "Install dependencies", run: "pnpm install --frozen-lockfile" },
          { name: "E2E test", run: "pnpm test:e2e" }
        ]
      }
    }
  },
  ".github/workflows/release-pr.yml": {
    name: "Version packages",
    on: { push: { branches: ["develop"] } },
    permissions: {},
    jobs: {
      version: {
        "runs-on": "ubuntu-latest",
        permissions: { contents: "write", "pull-requests": "write" },
        steps: [
          { name: "Checkout", uses: `actions/checkout@${ACTION_PINS["actions/checkout"]}` },
          { name: "Setup pnpm", uses: `pnpm/action-setup@${ACTION_PINS["pnpm/action-setup"]}` },
          {
            name: "Setup Node.js",
            uses: `actions/setup-node@${ACTION_PINS["actions/setup-node"]}`,
            with: { "node-version": "24", cache: "pnpm" }
          },
          { name: "Install dependencies", run: "pnpm install --frozen-lockfile" },
          {
            name: "Create or update Version PR",
            id: "version",
            uses: `changesets/action@${ACTION_PINS["changesets/action"]}`,
            env: { GITHUB_TOKEN: "${{ github.token }}" },
            with: {
              "version-script": "pnpm release:version",
              "commit-message": "chore : package version 업데이트",
              "pr-title": "chore : package version 업데이트",
              "pr-base-branch": "develop",
              "create-github-releases": false,
              "push-git-tags": false
            }
          },
          {
            name: "Label Version PR",
            if: "steps.version.outputs.pr-number != ''",
            env: { GITHUB_TOKEN: "${{ github.token }}" },
            run: "gh label create release --force --color \"5319e7\" --description \"Package version pull request\"\ngh pr edit \"${{ steps.version.outputs.pr-number }}\" --add-label release\n"
          }
        ]
      }
    }
  },
  ".github/workflows/publish.yml": {
    name: "Publish packages",
    on: { push: { tags: ["v*.*.*"] } },
    permissions: {},
    jobs: {
      publish: {
        "runs-on": "ubuntu-latest",
        environment: "npm",
        permissions: { contents: "read", "id-token": "write" },
        steps: [
          { name: "Checkout tag", uses: `actions/checkout@${ACTION_PINS["actions/checkout"]}` },
          { name: "Setup pnpm", uses: `pnpm/action-setup@${ACTION_PINS["pnpm/action-setup"]}` },
          {
            name: "Setup Node.js",
            uses: `actions/setup-node@${ACTION_PINS["actions/setup-node"]}`,
            with: { "node-version": "24" }
          },
          { name: "Install npm CLI with Trusted Publishing support", run: "npm install --global npm@12.0.2" },
          { name: "Install dependencies", run: "pnpm install --frozen-lockfile" },
          { name: "Verify release candidate", run: "pnpm release:check" },
          { name: "Publish packages", run: "pnpm run release:publish --tag \"$GITHUB_REF_NAME\"" }
        ]
      },
      "github-release": {
        needs: "publish",
        "runs-on": "ubuntu-latest",
        permissions: { contents: "write" },
        steps: [
          {
            name: "Create GitHub Release",
            env: { GH_TOKEN: "${{ github.token }}" },
            run: "if release_tag=\"$(gh release view \"$GITHUB_REF_NAME\" --repo \"$GITHUB_REPOSITORY\" --json tagName --jq .tagName 2>/dev/null)\"; then\n  test \"$release_tag\" = \"$GITHUB_REF_NAME\"\n  echo \"GitHub Release already exists; skipping.\"\nelse\n  gh release create \"$GITHUB_REF_NAME\" --repo \"$GITHUB_REPOSITORY\" --verify-tag --generate-notes --title \"$GITHUB_REF_NAME\"\nfi\n"
          }
        ]
      }
    }
  },
  ".github/release.yml": {
    changelog: {
      exclude: { labels: ["release"] },
      categories: [
        { title: "Features", labels: ["feature", "enhancement"] },
        { title: "Fixes", labels: ["bug", "fix"] },
        { title: "Documentation", labels: ["documentation"] },
        { title: "Dependencies", labels: ["dependencies"] },
        { title: "Maintenance", labels: ["chore", "refactor"] },
        { title: "Other Changes", labels: ["*"] }
      ]
    }
  }
};

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const hasExactShape = (actual, expected) => {
  if (Object.is(actual, expected)) {
    return true;
  }

  if (Array.isArray(actual) || Array.isArray(expected)) {
    return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length && actual.every((value, index) => hasExactShape(value, expected[index]));
  }

  if (!isRecord(actual) || !isRecord(expected)) {
    return false;
  }

  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();

  return actualKeys.length === expectedKeys.length && actualKeys.every((key, index) => key === expectedKeys[index]) && actualKeys.every((key) => hasExactShape(actual[key], expected[key]));
};

const readYaml = async (path) => {
  let source;

  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`unable to read YAML: ${error instanceof Error ? error.message : String(error)}`);
  }

  const document = parseDocument(source, { prettyErrors: true, strict: true, uniqueKeys: true, version: "1.2" });
  const structuralErrors = [];

  visit(document, {
    Alias() {
      structuralErrors.push("YAML aliases are not allowed");
    },
    Node(_key, node) {
      if (node.anchor !== undefined) {
        structuralErrors.push("YAML anchors are not allowed");
      }
    }
  });

  if (document.errors.length > 0 || document.warnings.length > 0 || structuralErrors.length > 0) {
    const errors = [
      ...document.errors.map((error) => error.message),
      ...document.warnings.map((warning) => warning.message),
      ...structuralErrors
    ];
    throw new Error(`invalid YAML 1.2: ${errors.join("; ")}`);
  }

  let value;

  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new Error(`invalid YAML 1.2: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(value)) {
    throw new Error("YAML document must be an object");
  }

  return { source, value };
};

const collectUses = (value, results = []) => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectUses(item, results);
    }
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (key === "uses") {
        results.push(child);
      } else {
        collectUses(child, results);
      }
    }
  }

  return results;
};

const validateReviewedActions = (workflow, relativePath, errors) => {
  for (const reference of collectUses(workflow)) {
    if (typeof reference !== "string") {
      errors.push(`${relativePath}: action reference must be a string`);
      continue;
    }

    const match = SHA_PIN.exec(reference);

    if (match === null) {
      errors.push(`${relativePath}: ${reference} must use a 40-character commit SHA`);
      continue;
    }

    const [, action, sha] = match;

    if (ACTION_PINS[action] !== sha) {
      errors.push(`${relativePath}: ${action} must be pinned to its reviewed commit SHA`);
    }
  }
};

const validateSourceSecurity = (source, relativePath, errors) => {
  for (const pattern of FORBIDDEN_WORKFLOW_CONFIGURATION) {
    if (pattern.test(source)) {
      errors.push(`${relativePath}: contains forbidden registry authentication or credential configuration`);
      return;
    }
  }
};

export async function verifyWorkflowFiles(root) {
  const repositoryRoot = resolve(root);
  const files = {};
  const errors = [];

  for (const relativePath of RELEASE_FILES) {
    try {
      files[relativePath] = await readYaml(join(repositoryRoot, relativePath));
    } catch (error) {
      errors.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const relativePath of WORKFLOW_FILES) {
    const file = files[relativePath];

    if (file === undefined) {
      continue;
    }

    validateSourceSecurity(file.source, relativePath, errors);
    validateReviewedActions(file.value, relativePath, errors);
  }

  for (const [relativePath, expected] of Object.entries(EXPECTED_FILES)) {
    const file = files[relativePath];

    if (file !== undefined && !hasExactShape(file.value, expected)) {
      errors.push(`${relativePath}: does not match the exact approved release workflow schema`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Release workflow verification failed:\n- ${errors.join("\n- ")}`);
  }
}
