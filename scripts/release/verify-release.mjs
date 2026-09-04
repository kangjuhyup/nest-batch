import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_SUBPATHS, NPM_REGISTRY_URL, PUBLIC_PACKAGES, REPOSITORY_URL } from "./package-catalog.mjs";
import { verifyWorkflowFiles } from "./verify-workflows.mjs";

const EXPECTED_HOMEPAGE = "https://github.com/kangjuhyup/nest-batch#readme";
const EXPECTED_BUGS_URL = "https://github.com/kangjuhyup/nest-batch/issues";
const EXPECTED_REPOSITORY_URL = "https://github.com/kangjuhyup/nest-batch";
const EXPECTED_NODE_RANGE = ">=20.18.0";
const EXPECTED_FILES = ["dist", "src", "README.md", "LICENSE"];
const RELEASING_GUIDE_PATH = "docs/releasing.md";
const PUBLISH_WORKFLOW_FILENAME = "publish.yml";
const PUBLISH_ENVIRONMENT = "npm";
const BOOTSTRAP_PUBLISH_COMMAND = "pnpm run release:publish --tag v0.1.0";
const IDENTITY_AUDIT_ARGUMENTS = "name version maintainers repository dist-tags --json";
const IDENTITY_AUDIT_STOP_RULE = "기존 package는 승인된 repository identity와 ownership이 일치하거나 명시적인 transfer/rename 결정이 있어야 합니다. 그렇지 않으면 **STOP**합니다.";
const E404_BOOTSTRAP_RULE = "`E404`는 scope publish 권한을 확인한 뒤에만 bootstrap 후보입니다.";
const TOKEN_PUBLISHING_ACCESS_PATH = "Settings → Publishing access";
const TOKEN_PUBLISHING_ACCESS_SETTING = "Require two-factor authentication and disallow tokens";
const TOKEN_PUBLISHING_ACCESS_SAVE = "Save";
const PORTABLE_NVM_COMMAND = "nvm use";
const COREPACK_VERSION_CHECK = "corepack pnpm --version # 10.34.5";
const BOOTSTRAP_PROVENANCE_EXCEPTION = "로컬에서 publish한 `0.1.0`은 provenance 예외입니다.";
const LATER_PROVENANCE_REQUIREMENT = "처음으로 OIDC publish되는 후속 version부터 provenance를 필수로 확인합니다.";
const GITHUB_RELEASE_RERUN_RULE = "기존 GitHub Release가 있으면 검증 후 건너뛰고, 없을 때만 생성합니다.";
const PERSONAL_NVM_BOOTSTRAP_PATH = "source /Users/kangjuhyup/.nvm/nvm.sh";
const RELEASE_CHECKLIST_HEADINGS = [
  "## 1. Release candidate 준비",
  "## 2. 최초 0.1.0 bootstrap",
  "## 3. Trusted Publisher 등록",
  "## 4. Tag release",
  "## 5. 실패 복구"
];
const NUMERIC_IDENTIFIER = "(?:0|[1-9]\\d*)";
const NON_NUMERIC_IDENTIFIER = "\\d*[A-Za-z-][0-9A-Za-z-]*";
const PRERELEASE_IDENTIFIER = `(?:${NUMERIC_IDENTIFIER}|${NON_NUMERIC_IDENTIFIER})`;
const SEMVER_PATTERN = new RegExp(
  `^${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}(?:-${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`
);
const PUBLIC_PACKAGE_NAMES = new Set(PUBLIC_PACKAGES.map(({ name }) => name));
const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"];
const LEGACY_PACKAGE_NAMES = [
  "queue-core",
  "scheduler-core",
  "scheduler-calendar",
  "polling-core",
  "worker-local",
  "worker-threads",
  "queue-bullmq"
].map((name) => ["@nest-batch", name].join("/"));
const SCANNED_EXTENSIONS = new Set([".js", ".json", ".md", ".mjs", ".ts", ".yaml", ".yml"]);
const IGNORED_SCAN_DIRECTORIES = new Set([".git", ".superpowers", ".tsbuildinfo", ".worktrees", "dist", "node_modules"]);

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const hasExactFiles = (files) =>
  Array.isArray(files) && files.length === EXPECTED_FILES.length && files.every((file, index) => file === EXPECTED_FILES[index]);

const escapeRegularExpression = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasPackageToken = (value, packageName) => {
  const escapedPackageName = escapeRegularExpression(packageName);
  return new RegExp(`(?:^|\\s)${escapedPackageName}(?=\\s|$)`, "u").test(value);
};

const hasPnpmAddPackage = (readme, packageName) => {
  const commands = readme.matchAll(/(?:^|\n)\s*(?:[$>]\s*)?`?pnpm\s+add\s+([^\n`]+)`?/gu);

  return Array.from(commands, (command) => hasPackageToken(command[1], packageName)).some(Boolean);
};

const hasMarkdownLinkTarget = (readme, target) => {
  const escapedTarget = escapeRegularExpression(target);
  const targetPattern = `${escapedTarget}/?(?:#[^\\s)>]+)?`;
  const markdownLink = new RegExp(`\\[[^\\]]*\\]\\(\\s*<?${targetPattern}>?(?=\\s|\\))`, "u");
  const autoLink = new RegExp(`<${targetPattern}>`, "u");

  return markdownLink.test(readme) || autoLink.test(readme);
};

const validateReleasingGuide = (root) => {
  const releasingGuidePath = join(root, RELEASING_GUIDE_PATH);
  let guide;

  try {
    guide = readFileSync(releasingGuidePath, "utf8");
  } catch (error) {
    throw new Error(`${RELEASING_GUIDE_PATH} is required: ${error instanceof Error ? error.message : String(error)}`);
  }

  const expectedChecklistLines = [
    "- [ ] `pnpm release:check` 성공",
    `- [ ] owner \`kangjuhyup\`, repository \`nest-batch\`, workflow \`${PUBLISH_WORKFLOW_FILENAME}\`, environment \`${PUBLISH_ENVIRONMENT}\` 등록`,
    `- [ ] \`${BOOTSTRAP_PUBLISH_COMMAND}\`을 maintainer가 직접 실행`
  ];
  const identityAuditCommands = PUBLIC_PACKAGES.map(({ name }) => `npm view ${name} ${IDENTITY_AUDIT_ARGUMENTS} --registry ${NPM_REGISTRY_URL}`);
  const requirements = [
    ...PUBLIC_PACKAGES.map(({ name }) => `\`${name}\``),
    ...expectedChecklistLines,
    ...identityAuditCommands,
    IDENTITY_AUDIT_STOP_RULE,
    E404_BOOTSTRAP_RULE,
    TOKEN_PUBLISHING_ACCESS_PATH,
    TOKEN_PUBLISHING_ACCESS_SETTING,
    TOKEN_PUBLISHING_ACCESS_SAVE,
    PORTABLE_NVM_COMMAND,
    COREPACK_VERSION_CHECK,
    `npm whoami --registry ${NPM_REGISTRY_URL}`,
    BOOTSTRAP_PROVENANCE_EXCEPTION,
    LATER_PROVENANCE_REQUIREMENT,
    GITHUB_RELEASE_RERUN_RULE
  ];
  const missing = requirements.filter((requirement) => !guide.includes(requirement));
  const headingIndexes = RELEASE_CHECKLIST_HEADINGS.map((heading) => guide.indexOf(heading));
  const firstIdentityAuditIndex = guide.indexOf(identityAuditCommands[0]);
  const bootstrapPublishChecklistIndex = guide.indexOf(expectedChecklistLines[2]);

  if (headingIndexes.some((index) => index === -1)) {
    const missingHeadings = RELEASE_CHECKLIST_HEADINGS.filter((_, index) => headingIndexes[index] === -1);
    throw new Error(`${RELEASING_GUIDE_PATH} is missing required checklist sections: ${missingHeadings.join(", ")}`);
  }

  if (headingIndexes.some((index, position) => position > 0 && index <= headingIndexes[position - 1])) {
    throw new Error(`${RELEASING_GUIDE_PATH} checklist sections must stay in the approved order`);
  }

  const sectionHeadings = guide.match(/^## .+$/gmu) ?? [];
  if (sectionHeadings.length !== RELEASE_CHECKLIST_HEADINGS.length) {
    throw new Error(`${RELEASING_GUIDE_PATH} must contain exactly five checklist sections`);
  }

  if (firstIdentityAuditIndex !== -1 && bootstrapPublishChecklistIndex !== -1 && firstIdentityAuditIndex > bootstrapPublishChecklistIndex) {
    throw new Error(`${RELEASING_GUIDE_PATH} catalog identity audit must appear before the bootstrap publish checkbox`);
  }

  if (guide.includes(PERSONAL_NVM_BOOTSTRAP_PATH)) {
    throw new Error(`${RELEASING_GUIDE_PATH} must not contain a personal absolute nvm bootstrap path`);
  }

  if (missing.length > 0) {
    throw new Error(`${RELEASING_GUIDE_PATH} is missing required release values: ${missing.join(", ")}`);
  }
};

const validatePackageDocuments = (root, packageInfo) => {
  const readmePath = join(root, packageInfo.directory, "README.md");
  let readme;

  try {
    readme = readFileSync(readmePath, "utf8");
  } catch (error) {
    throw new Error(`${packageInfo.directory}/README.md is required: ${error instanceof Error ? error.message : String(error)}`);
  }

  const requirements = [
    [hasPackageToken(readme, packageInfo.name), "package name"],
    [hasPnpmAddPackage(readme, packageInfo.name), "pnpm install command"],
    [new RegExp(`from\\s+[\"']${escapeRegularExpression(packageInfo.name)}[\"']`, "u").test(readme), "public import"],
    [hasMarkdownLinkTarget(readme, EXPECTED_REPOSITORY_URL), "repository link"],
    [readme.includes("MIT"), "MIT license"],
    [readme.includes(EXPECTED_BUGS_URL), "issue tracker link"]
  ];

  const missing = requirements
    .filter(([isSatisfied]) => !isSatisfied)
    .map(([, description]) => description);

  if (missing.length > 0) {
    throw new Error(`${packageInfo.directory}/README.md is missing ${missing.join(", ")}`);
  }
};

const validateBuildArtifacts = (root, packageInfo) => {
  const requiredFiles = ["dist/index.js", "dist/index.d.ts"];

  if (packageInfo.name === "@nest-batch/core") {
    for (const subpath of CORE_SUBPATHS) {
      requiredFiles.push(`dist/${subpath}/index.js`, `dist/${subpath}/index.d.ts`);
    }
  }

  if (packageInfo.name === "@nest-batch/cli") {
    requiredFiles.push("dist/bin.js");
  }

  const missing = requiredFiles.filter((path) => !existsSync(join(root, packageInfo.directory, path)));

  if (missing.length > 0) {
    throw new Error(`${packageInfo.directory}: missing build artifacts ${missing.join(", ")}`);
  }
};

export async function verifyPackageDocuments(root, packageInfo) {
  validatePackageDocuments(resolve(root), packageInfo);
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validateManifest(manifest, directory) {
  const errors = [];

  if (!isRecord(manifest)) {
    throw new Error(`${directory}: package manifest must be an object`);
  }

  if (typeof manifest.name !== "string" || !/^@nest-batch\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(manifest.name)) {
    errors.push("name must be an @nest-batch scoped package name");
  }

  if (typeof manifest.version !== "string" || !SEMVER_PATTERN.test(manifest.version)) {
    errors.push("version must be strict SemVer");
  }

  if (manifest.type !== "module") {
    errors.push('type must be "module"');
  }

  if (manifest.license !== "MIT") {
    errors.push('license must be "MIT"');
  }

  if (manifest.author !== "kangjuhyup") {
    errors.push('author must be "kangjuhyup"');
  }

  if (!isRecord(manifest.repository) || manifest.repository.type !== "git" || manifest.repository.url !== REPOSITORY_URL) {
    errors.push(`repository must identify ${REPOSITORY_URL}`);
  }

  if (!isRecord(manifest.repository) || manifest.repository.directory !== directory) {
    errors.push(`repository.directory must equal ${directory}`);
  }

  if (manifest.homepage !== EXPECTED_HOMEPAGE) {
    errors.push(`homepage must equal ${EXPECTED_HOMEPAGE}`);
  }

  if (!isRecord(manifest.bugs) || manifest.bugs.url !== EXPECTED_BUGS_URL) {
    errors.push(`bugs.url must equal ${EXPECTED_BUGS_URL}`);
  }

  if (!isRecord(manifest.engines) || manifest.engines.node !== EXPECTED_NODE_RANGE) {
    errors.push(`engines.node must equal ${EXPECTED_NODE_RANGE}`);
  }

  if (!hasExactFiles(manifest.files)) {
    errors.push(`files must equal ${JSON.stringify(EXPECTED_FILES)}`);
  }

  if (!isRecord(manifest.publishConfig) || manifest.publishConfig.access !== "public") {
    errors.push('publishConfig.access must equal "public"');
  }

  if (!isRecord(manifest.publishConfig) || manifest.publishConfig.registry !== NPM_REGISTRY_URL) {
    errors.push(`publishConfig.registry must equal ${NPM_REGISTRY_URL}`);
  }

  if (typeof manifest.description !== "string" || manifest.description.trim().length === 0) {
    errors.push("description must be a non-empty string");
  }

  if (!Array.isArray(manifest.keywords) || manifest.keywords.length === 0 || manifest.keywords.some((keyword) => typeof keyword !== "string" || keyword.trim().length === 0)) {
    errors.push("keywords must be a non-empty string array");
  }

  if (errors.length > 0) {
    throw new Error(`${directory}: ${errors.join("; ")}`);
  }
}

const validateReleaseTopology = (root) => {
  const errors = [];
  const expectedNames = PUBLIC_PACKAGES.map(({ name }) => name);
  const expectedDirectories = PUBLIC_PACKAGES.map(({ directory }) => directory);
  const changesetConfig = readJson(join(root, ".changeset/config.json"));
  const fixed = changesetConfig?.fixed;

  if (!Array.isArray(fixed) || fixed.length !== 1 || JSON.stringify(fixed[0]) !== JSON.stringify(expectedNames)) {
    errors.push(`.changeset/config.json fixed group must exactly equal ${JSON.stringify(expectedNames)}`);
  }

  const rootTsconfig = readJson(join(root, "tsconfig.json"));
  const references = rootTsconfig?.references;

  if (!Array.isArray(references)) {
    errors.push("tsconfig.json references must be an array");
  } else {
    const packageReferences = references.flatMap((reference) => {
      if (!isRecord(reference) || typeof reference.path !== "string") {
        errors.push("tsconfig.json references must contain string paths");
        return [];
      }

      const path = reference.path.startsWith("./") ? reference.path.slice(2) : reference.path;
      return path.startsWith("packages/") ? [path] : [];
    });

    if (JSON.stringify(packageReferences) !== JSON.stringify(expectedDirectories)) {
      errors.push(`tsconfig.json public package references must exactly equal ${JSON.stringify(expectedDirectories)}`);
    }
  }

  return errors;
};

const validateSourceInternalDependencies = (manifest, packageInfo) => {
  const errors = [];

  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = manifest[field];

    if (dependencies === undefined) {
      continue;
    }

    if (!isRecord(dependencies)) {
      errors.push(`${packageInfo.directory}: ${field} must be an object`);
      continue;
    }

    for (const [name, version] of Object.entries(dependencies)) {
      if (PUBLIC_PACKAGE_NAMES.has(name) && version !== "workspace:*") {
        errors.push(`${packageInfo.directory}: ${field}.${name} must equal workspace:*`);
      }
    }
  }

  return errors;
};

const scanFiles = (directory) => {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) {
      throw new Error(`${entry.name}: symbolic links are not allowed in release scan paths`);
    }

    if (entry.isDirectory()) {
      return IGNORED_SCAN_DIRECTORIES.has(entry.name) ? [] : scanFiles(join(directory, entry.name));
    }

    return entry.isFile() && SCANNED_EXTENSIONS.has(extname(entry.name)) ? [join(directory, entry.name)] : [];
  });
};

const validateLegacyPackageAbsence = (root) => {
  const scanRoots = ["packages", "examples", "scripts", ".github", "docs"];
  const rootFiles = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "README.md", "README-kr.md"];
  const files = [
    ...scanRoots.flatMap((directory) => directory === "docs"
      ? readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => entry.name === "superpowers" ? [] : entry.isDirectory() ? scanFiles(join(root, directory, entry.name)) : SCANNED_EXTENSIONS.has(extname(entry.name)) ? [join(root, directory, entry.name)] : [])
      : scanFiles(join(root, directory))),
    ...rootFiles.map((path) => join(root, path)).filter(existsSync)
  ];
  const errors = [];

  for (const legacyName of LEGACY_PACKAGE_NAMES) {
    const legacyDirectory = join(root, "packages", legacyName.slice("@nest-batch/".length));

    if (existsSync(legacyDirectory)) {
      errors.push(`${relative(root, legacyDirectory)} is a removed workspace package directory`);
    }
  }

  for (const file of files) {
    const source = readFileSync(file, "utf8");

    for (const legacyName of LEGACY_PACKAGE_NAMES) {
      if (source.includes(legacyName)) {
        errors.push(`${relative(root, file)} contains removed package name ${legacyName}`);
      }
    }
  }

  return errors;
};

function validateRootManifest(manifest) {
  const errors = [];

  if (!isRecord(manifest)) {
    return ["root package manifest must be an object"];
  }

  if (manifest.name !== "nest-batch") {
    errors.push('root name must be "nest-batch"');
  }

  if (typeof manifest.version !== "string" || !SEMVER_PATTERN.test(manifest.version)) {
    errors.push("root version must be strict SemVer");
  }

  if (manifest.private !== true) {
    errors.push("root package must remain private");
  }

  if (manifest.type !== "module") {
    errors.push('root type must be "module"');
  }

  if (manifest.license !== "MIT") {
    errors.push('root license must be "MIT"');
  }

  if (manifest.author !== "kangjuhyup") {
    errors.push('root author must be "kangjuhyup"');
  }

  if (!isRecord(manifest.repository) || manifest.repository.type !== "git" || manifest.repository.url !== REPOSITORY_URL) {
    errors.push(`root repository must identify ${REPOSITORY_URL}`);
  }

  if (manifest.homepage !== EXPECTED_HOMEPAGE) {
    errors.push(`root homepage must equal ${EXPECTED_HOMEPAGE}`);
  }

  if (!isRecord(manifest.bugs) || manifest.bugs.url !== EXPECTED_BUGS_URL) {
    errors.push(`root bugs.url must equal ${EXPECTED_BUGS_URL}`);
  }

  if (!isRecord(manifest.engines) || manifest.engines.node !== EXPECTED_NODE_RANGE) {
    errors.push(`root engines.node must equal ${EXPECTED_NODE_RANGE}`);
  }

  return errors;
}

export async function verifyReleaseRepository(root) {
  const repositoryRoot = resolve(root);
  const errors = [];
  const rootManifestPath = join(repositoryRoot, "package.json");
  const rootManifest = readJson(rootManifestPath);
  const rootManifestErrors = validateRootManifest(rootManifest);
  errors.push(...rootManifestErrors.map((error) => `package.json: ${error}`));

  try {
    errors.push(...validateReleaseTopology(repositoryRoot));
    errors.push(...validateLegacyPackageAbsence(repositoryRoot));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const rootLicense = readFileSync(join(repositoryRoot, "LICENSE"), "utf8");

  try {
    validateReleasingGuide(repositoryRoot);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  for (const packageInfo of PUBLIC_PACKAGES) {
    const manifestPath = join(repositoryRoot, packageInfo.directory, "package.json");
    let manifest;

    try {
      manifest = readJson(manifestPath);
      validateManifest(manifest, packageInfo.directory);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    if (manifest.name !== packageInfo.name) {
      errors.push(`${packageInfo.directory}: name ${manifest.name} must equal ${packageInfo.name}`);
    }

    if (manifest.version !== rootManifest.version) {
      errors.push(`${packageInfo.directory}: version ${manifest.version} must match root version ${rootManifest.version}`);
    }

    errors.push(...validateSourceInternalDependencies(manifest, packageInfo));

    const packageLicensePath = join(repositoryRoot, packageInfo.directory, "LICENSE");
    try {
      if (readFileSync(packageLicensePath, "utf8") !== rootLicense) {
        errors.push(`${packageInfo.directory}/LICENSE must exactly match root LICENSE`);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    try {
      validatePackageDocuments(repositoryRoot, packageInfo);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    try {
      validateBuildArtifacts(repositoryRoot, packageInfo);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  try {
    await verifyWorkflowFiles(repositoryRoot);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (errors.length > 0) {
    throw new Error(`Release repository verification failed:\n- ${errors.join("\n- ")}`);
  }
}

const isDirectExecution = () =>
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution()) {
  try {
    await verifyReleaseRepository(process.cwd());
    console.log("Release repository verification passed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
