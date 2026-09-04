import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";

const WORKFLOW_FILES = [".github/workflows/ci.yml", ".github/workflows/release-pr.yml", ".github/workflows/publish.yml"];
const FORBIDDEN_TOKEN_NAMES = ["NPM_TOKEN", "NODE_AUTH_TOKEN"];
const ACTION_PINS = {
  "actions/checkout": "d23441a48e516b6c34aea4fa41551a30e30af803",
  "actions/setup-node": "249970729cb0ef3589644e2896645e5dc5ba9c38",
  "pnpm/action-setup": "0977fd99725f1db4007ccb2928dbb4e90d06cc86",
  "changesets/action/version": "8488615a623b1b9c987934bb89eae8af6a946ac1"
};
const SHA_PIN = /^([^@\s]+)@([0-9a-f]{40})$/u;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const readYaml = async (path) => {
  let source;

  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`${path}: unable to read YAML: ${error instanceof Error ? error.message : String(error)}`);
  }

  const document = parseDocument(source, { prettyErrors: true, strict: true, uniqueKeys: true, version: "1.2" });

  if (document.errors.length > 0) {
    throw new Error(`${path}: invalid YAML 1.2: ${document.errors.map((error) => error.message).join("; ")}`);
  }

  const value = document.toJS({ maxAliasCount: 0 });

  if (!isRecord(value)) {
    throw new Error(`${path}: YAML document must be an object`);
  }

  return { source, value };
};

const workflowPushesToDevelop = (workflow) => {
  const push = isRecord(workflow.on) ? workflow.on.push : undefined;
  const branches = isRecord(push) ? push.branches : undefined;

  return Array.isArray(branches) && branches.includes("develop");
};

const workflowJobs = (workflow, name, errors) => {
  if (!isRecord(workflow.jobs)) {
    errors.push(`${name}: jobs must be an object`);
    return {};
  }

  return workflow.jobs;
};

const jobSteps = (job, name, errors) => {
  if (!isRecord(job) || !Array.isArray(job.steps)) {
    errors.push(`${name}: steps must be an array`);
    return [];
  }

  return job.steps.filter(isRecord);
};

const hasRun = (steps, command) => steps.some((step) => typeof step.run === "string" && step.run.includes(command));

const validateExactPermissions = (permissions, expected, name, errors) => {
  if (!isRecord(permissions)) {
    errors.push(`${name}: permissions must be an object`);
    return;
  }

  const actualKeys = Object.keys(permissions).sort();
  const expectedKeys = Object.keys(expected).sort();

  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    errors.push(`${name}: permissions must be exactly ${JSON.stringify(expected)}`);
    return;
  }

  for (const [permission, value] of Object.entries(expected)) {
    if (permissions[permission] !== value) {
      errors.push(`${name}: ${permission} permission must be ${value}`);
    }
  }
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

const validatePinnedActions = (workflow, name, errors) => {
  for (const reference of collectUses(workflow)) {
    if (typeof reference !== "string") {
      errors.push(`${name}: action reference must be a string`);
      continue;
    }

    const match = SHA_PIN.exec(reference);

    if (match === null) {
      errors.push(`${name}: ${reference} must use a 40-character commit SHA`);
      continue;
    }

    const [, action, sha] = match;

    if (ACTION_PINS[action] !== sha) {
      errors.push(`${name}: ${action} must be pinned to a reviewed commit SHA`);
    }
  }
};

const validateCiWorkflow = (workflow, errors) => {
  if (workflow.pull_request !== undefined) {
    errors.push("ci.yml: pull_request must be declared under YAML 1.2 on");
  }

  if (!isRecord(workflow.on) || workflow.on.pull_request === undefined || !workflowPushesToDevelop(workflow)) {
    errors.push("ci.yml: must run for pull_request and develop pushes");
  }
};

const validateReleasePrWorkflow = (workflow, errors) => {
  if (!workflowPushesToDevelop(workflow)) {
    errors.push("release-pr.yml: must run for develop pushes");
  }

  validateExactPermissions(workflow.permissions, {}, "release-pr.yml", errors);

  const jobs = workflowJobs(workflow, "release-pr.yml", errors);
  const versionJob = jobs.version;
  const steps = jobSteps(versionJob, "release-pr.yml version job", errors);

  validateExactPermissions(versionJob?.permissions, { contents: "write", "pull-requests": "write" }, "release-pr.yml version job", errors);

  const versionStep = steps.find((step) => step.uses === `changesets/action/version@${ACTION_PINS["changesets/action/version"]}`);

  if (versionStep === undefined) {
    errors.push("release-pr.yml: requires the version-only Changesets action");
    return;
  }

  if (versionStep.id !== "version") {
    errors.push("release-pr.yml: version-only Changesets action must use id version");
  }

  if (!isRecord(versionStep.with) || versionStep.with.script !== "pnpm release:version") {
    errors.push("release-pr.yml: version-only Changesets action requires with.script: pnpm release:version");
  }

  if (isRecord(versionStep.with)) {
    const supportedInputs = new Set(["script", "commit-message", "pr-title", "pr-draft", "pr-base-branch", "push-with-git-cli", "cwd"]);
    const unsupportedInputs = Object.keys(versionStep.with).filter((input) => !supportedInputs.has(input));

    if (unsupportedInputs.length > 0) {
      errors.push(`release-pr.yml: version-only Changesets action does not support ${unsupportedInputs.join(", ")}`);
    }
  }

  const labelStep = steps.find((step) => typeof step.run === "string" && step.run.includes("gh label create release --force"));

  if (labelStep === undefined) {
    errors.push("release-pr.yml: must create the release label before applying it");
    return;
  }

  if (typeof labelStep.if !== "string" || !labelStep.if.includes("steps.version.outputs.pr-number")) {
    errors.push("release-pr.yml: label step must use the version action pr-number output");
  }

  if (!isRecord(labelStep.env) || Object.keys(labelStep.env).length !== 1 || labelStep.env.GITHUB_TOKEN !== "${{ github.token }}") {
    errors.push("release-pr.yml: label step must use only repository GITHUB_TOKEN");
  }

  if (typeof labelStep.run !== "string" || !labelStep.run.includes("gh pr edit") || !labelStep.run.includes("--add-label release")) {
    errors.push("release-pr.yml: label step must apply the release label to the Version PR");
  }
};

const validatePublishWorkflow = (workflow, errors) => {
  const tagPatterns = isRecord(workflow.on) && isRecord(workflow.on.push) ? workflow.on.push.tags : undefined;

  if (!Array.isArray(tagPatterns) || tagPatterns.length !== 1 || tagPatterns[0] !== "v*.*.*") {
    errors.push("publish.yml: must trigger only for v*.*.* tags");
  }

  validateExactPermissions(workflow.permissions, {}, "publish.yml", errors);

  const jobs = workflowJobs(workflow, "publish.yml", errors);
  const publishJob = jobs.publish;
  const releaseJob = jobs["github-release"];
  const publishSteps = jobSteps(publishJob, "publish.yml publish job", errors);
  const releaseSteps = jobSteps(releaseJob, "publish.yml github-release job", errors);

  if (publishJob?.environment !== "npm") {
    errors.push("publish.yml publish job: environment must be npm");
  }

  validateExactPermissions(publishJob?.permissions, { contents: "read", "id-token": "write" }, "publish.yml publish job", errors);

  if (releaseJob?.needs !== "publish") {
    errors.push("publish.yml github-release job: must need publish");
  }

  validateExactPermissions(releaseJob?.permissions, { contents: "write" }, "publish.yml github-release job", errors);

  if (publishSteps.some((step) => typeof step.run === "string" && step.run.includes("pnpm install") && !step.run.includes("--frozen-lockfile"))) {
    errors.push("publish.yml publish job: pnpm install must use --frozen-lockfile");
  }

  for (const command of ["npm install --global npm@12.0.2", "pnpm install --frozen-lockfile", "pnpm release:check", "pnpm release:publish -- --tag \"$GITHUB_REF_NAME\""]) {
    if (!hasRun(publishSteps, command)) {
      errors.push(`publish.yml publish job: missing ${command}`);
    }
  }

  if (releaseSteps.some((step) => typeof step.uses === "string" && step.uses.startsWith("actions/checkout@"))) {
    errors.push("publish.yml github-release job: must not check out source");
  }

  const createReleaseStep = releaseSteps.find((step) =>
    typeof step.run === "string" && step.run.includes("gh release create \"$GITHUB_REF_NAME\"")
  );

  if (createReleaseStep === undefined ||
    !createReleaseStep.run.includes("--verify-tag") ||
    !createReleaseStep.run.includes("--generate-notes") ||
    !createReleaseStep.run.includes("--title \"$GITHUB_REF_NAME\"")) {
    errors.push("publish.yml github-release job: must create generated notes for the verified tag");
  } else if (!isRecord(createReleaseStep.env) || Object.keys(createReleaseStep.env).length !== 1 || createReleaseStep.env.GH_TOKEN !== "${{ github.token }}") {
    errors.push("publish.yml github-release job: must use only GH_TOKEN from github.token");
  }
};

export async function verifyWorkflowFiles(root) {
  const repositoryRoot = resolve(root);
  const entries = await Promise.all([...WORKFLOW_FILES, ".github/release.yml"].map(async (relativePath) => {
    const parsed = await readYaml(join(repositoryRoot, relativePath));
    return [relativePath, parsed];
  }));
  const files = Object.fromEntries(entries);
  const errors = [];

  for (const relativePath of WORKFLOW_FILES) {
    const source = files[relativePath].source;

    for (const tokenName of FORBIDDEN_TOKEN_NAMES) {
      if (source.includes(tokenName)) {
        errors.push(`${relativePath}: must not reference ${tokenName}`);
      }
    }

    validatePinnedActions(files[relativePath].value, relativePath, errors);
  }

  validateCiWorkflow(files[".github/workflows/ci.yml"].value, errors);
  validateReleasePrWorkflow(files[".github/workflows/release-pr.yml"].value, errors);
  validatePublishWorkflow(files[".github/workflows/publish.yml"].value, errors);

  if (errors.length > 0) {
    throw new Error(`Release workflow verification failed:\n- ${errors.join("\n- ")}`);
  }
}
