import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { NPM_REGISTRY_URL, NPM_SCOPE_REGISTRY_ARGUMENT, PUBLIC_PACKAGE_SCOPE, PUBLIC_PACKAGES, REPOSITORY_URL } from "./package-catalog.mjs";
import { getPackageEntrypointTargets, validatePackageEntrypoints } from "./package-entrypoints.mjs";
import { verifyWorkflowFiles } from "./verify-workflows.mjs";

const EXPECTED_HOMEPAGE = "https://github.com/kangjuhyup/nest-batch#readme";
const EXPECTED_BUGS_URL = "https://github.com/kangjuhyup/nest-batch/issues";
const EXPECTED_REPOSITORY_URL = "https://github.com/kangjuhyup/nest-batch";
const EXPECTED_NODE_RANGE = ">=20.18.0";
const EXPECTED_FILES = ["dist", "src", "README.md", "LICENSE"];
const RELEASING_GUIDE_PATH = "docs/releasing.md";
const PUBLISH_WORKFLOW_FILENAME = "publish.yml";
const PUBLISH_ENVIRONMENT = "npm";
const BOOTSTRAP_PUBLISH_COMMAND = "pnpm release:start --tag v0.1.0 --bootstrap";
const BOOTSTRAP_PUBLISH_CHECKLIST_ITEM = `- [ ] \`${BOOTSTRAP_PUBLISH_COMMAND}\` 자동화 명령 실행`;
const BOOTSTRAP_VERSION = "0.1.0";
const IDENTITY_AUDIT_ARGUMENTS = "name version maintainers repository dist-tags --json";
const INTEGRITY_CONFIRMATION_ARGUMENTS = "version dist.integrity --json";
const IDENTITY_AUDIT_STOP_RULE = "기존 package는 승인된 repository identity와 ownership이 일치하거나 명시적인 transfer/rename 결정이 있어야 합니다. 그렇지 않으면 **STOP**합니다.";
const E404_BOOTSTRAP_RULE = "`E404`는 scope publish 권한을 확인한 뒤에만 bootstrap 후보입니다.";
const TOKEN_PUBLISHING_ACCESS_PATH = "Settings → Publishing access";
const TOKEN_PUBLISHING_ACCESS_SETTING = "Require two-factor authentication and disallow tokens";
const TOKEN_PUBLISHING_ACCESS_SAVE = "Save";
const PORTABLE_NVM_COMMAND = "nvm use";
const COREPACK_VERSION_CHECK = "corepack pnpm --version # 10.34.5";
const BOOTSTRAP_PROVENANCE_EXCEPTION = "로컬에서 publish한 `0.1.0`은 provenance 예외입니다.";
const LATER_PROVENANCE_REQUIREMENT = "처음으로 OIDC publish되는 후속 version부터 provenance를 필수로 확인합니다.";
const BOOTSTRAP_CANDIDATE_CHECKLIST_ITEM = "- [ ] 최초 `0.1.0` release candidate로 검토된 package-release-readiness merge commit 지정";
const BOOTSTRAP_CANDIDATE_RULE = "이 예외는 최초 `0.1.0`에 한 번만 적용하며, 새 Changeset이나 Version PR을 만들지 않습니다.";
const LATER_VERSION_PR_RULE = "최초 `0.1.0` 이후 모든 release에는 Changesets Version PR이 필수입니다.";
const ACTIONS_PR_SETTING_CHECKLIST_ITEM = "- [ ] 첫 post-bootstrap Version PR 전에 GitHub Actions의 pull request 생성 권한 수동 활성화";
const ACTIONS_PR_SETTING_PATH = "Settings → Actions → General → Workflow permissions";
const ACTIONS_PR_SETTING_NAME = "Allow GitHub Actions to create and approve pull requests";
const ACTIONS_PR_SETTING_AUDIT = "`can_approve_pull_request_reviews=false`";
const VERSION_PR_CHECKLIST_ITEM = "- [ ] Changesets Version PR workflow 승인과 CI 성공 확인 후 merge";
const VERSION_PR_APPROVAL_RULE = "각 Changesets Version PR이 생성되거나 갱신될 때마다 write 권한 maintainer가 PR merge box에서 **Approve workflows to run**을 클릭합니다.";
const VERSION_PR_CHECKS_RULE = "**Quality (Node 20.18.3)**, **Quality (Node 24)**, **E2E (Node 24)** check가 모두 성공한 뒤에만 Version PR을 merge합니다.";
const VERSION_PR_SEQUENCE_RULE = "Version PR merge commit을 release candidate로 정하고 아래 local 검증을 마친 뒤에만 release tag를 생성합니다.";
const LOCAL_CANDIDATE_CHECKLIST_ITEMS = [
  "- [ ] worktree가 clean이고 release commit이 `develop`에 포함됨",
  "- [ ] 8개 package와 root version이 동일함",
  "- [ ] `pnpm release:check` 성공",
  "- [ ] `pnpm test:e2e` 성공"
];
const TRUSTED_PUBLISHER_CHECKLIST_ITEM = `- [ ] owner \`kangjuhyup\`, repository \`nest-batch\`, workflow \`${PUBLISH_WORKFLOW_FILENAME}\`, environment \`${PUBLISH_ENVIRONMENT}\` 등록`;
const TAG_CREATION_CHECKLIST_ITEM = "- [ ] `pnpm release:start --tag vX.Y.Z` 실행";
const GITHUB_RELEASE_RERUN_RULE = "기존 GitHub Release가 있으면 검증 후 건너뛰고, 없을 때만 생성합니다.";
const GITHUB_RELEASE_EXISTING_RULE = "기존 release는 tag 이름이 정확하고 draft/prerelease가 아니어야 합니다.";
const GITHUB_RELEASE_CHECKOUT_RULE = "workflow checkout의 tag와 `HEAD`가 모두 `GITHUB_SHA`로 resolve되어야 하며, `target_commitish`가 40자리 commit SHA이면 그 값도 일치해야 합니다.";
const GITHUB_RELEASE_NOT_FOUND_RULE = "`gh api graphql` 조회로 published와 draft release의 양의 `databaseId`를 찾으며, `data.repository.release`가 `null`인 경우에만 새 release를 생성합니다.";
const GITHUB_RELEASE_REST_RULE = "GraphQL object가 있으면 REST `GET repos/{owner}/{repo}/releases/{databaseId}`로 tag, target, draft, prerelease를 검증합니다.";
const GITHUB_RELEASE_LOOKUP_FAILURE_RULE = "GraphQL `errors`, REST 인증·권한·network 오류 또는 malformed 응답은 생성으로 전환하지 않고 workflow를 실패시킵니다.";
const GITHUB_RELEASE_CREATE_RACE_RULE = "create가 실패하면 같은 GraphQL ID → REST by ID 경로로 정확히 한 번 재조회합니다. 그 사이 생성된 release가 계약과 정확히 일치할 때만 성공으로 복구하고, 여전히 없거나 조회가 실패하면 원래 create 오류를 보존하며, 충돌 release면 충돌 오류로 실패합니다.";
const PERSONAL_NVM_BOOTSTRAP_PATH = "source /Users/kangjuhyup/.nvm/nvm.sh";
const RELEASE_CHECKLIST_SECTIONS = {
  releaseCandidate: "## 1. Release candidate 준비",
  bootstrap: "## 2. 최초 0.1.0 bootstrap",
  trustedPublisher: "## 3. Trusted Publisher 등록",
  tagRelease: "## 4. Tag release",
  recovery: "## 5. 실패 복구"
};
const RELEASE_CHECKLIST_HEADINGS = Object.values(RELEASE_CHECKLIST_SECTIONS);
const NUMERIC_IDENTIFIER = "(?:0|[1-9]\\d*)";
const NON_NUMERIC_IDENTIFIER = "\\d*[A-Za-z-][0-9A-Za-z-]*";
const PRERELEASE_IDENTIFIER = `(?:${NUMERIC_IDENTIFIER}|${NON_NUMERIC_IDENTIFIER})`;
const SEMVER_PATTERN = new RegExp(
  `^${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}(?:-${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`
);
const PUBLIC_PACKAGE_NAMES = new Set(PUBLIC_PACKAGES.map(({ name }) => name));
const CLI_PACKAGE_NAME = `${PUBLIC_PACKAGE_SCOPE}/batch-cli`;
const CLI_README_DIRECT_DEPENDENCIES = [
  CLI_PACKAGE_NAME,
  `${PUBLIC_PACKAGE_SCOPE}/batch-core`,
  `${PUBLIC_PACKAGE_SCOPE}/batch-inmemory`
];
const PUBLIC_PACKAGE_NAME_PATTERN = new RegExp(`^${PUBLIC_PACKAGE_SCOPE}/batch-[a-z0-9][a-z0-9._-]*$`);
const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"];
const LEGACY_PACKAGE_PREFIXES = [
  `${"@nest"}-batch/`,
  `${"@rv-nest"}-batch/`
];
const REMOVED_PUBLIC_PACKAGE_SUFFIXES = [
  "queue-core",
  "scheduler-core",
  "scheduler-calendar",
  "polling-core",
  "worker-local",
  "worker-threads",
  "queue-bullmq"
];
const REMOVED_PUBLIC_PACKAGE_NAMES = REMOVED_PUBLIC_PACKAGE_SUFFIXES
  .map((suffix) => `${PUBLIC_PACKAGE_SCOPE}/batch-${suffix}`);
const ROOT_GENERATED_SCAN_DIRECTORIES = new Set([".git", ".superpowers", ".worktrees", "coverage", "node_modules"]);
const ACTIVE_TEXT_EXTENSIONS = new Set([
  ".cjs", ".css", ".csv", ".graphql", ".gql", ".html", ".js", ".json", ".jsx", ".md", ".mjs",
  ".mts", ".sh", ".sql", ".svg", ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml"
]);
const ACTIVE_TEXT_FILENAMES = new Set([".gitignore", ".gitmessage", ".npmignore", ".nvmrc", "Dockerfile", "LICENSE", "Makefile"]);
const EXPLICIT_BINARY_EXTENSIONS = new Set([
  ".avif", ".bmp", ".gif", ".gz", ".ico", ".jpeg", ".jpg", ".mov", ".mp3", ".mp4", ".ogg",
  ".otf", ".p12", ".pdf", ".pfx", ".png", ".psd", ".tgz", ".ttf", ".wasm", ".wav", ".webm",
  ".webp", ".woff", ".woff2", ".zip"
]);

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const isHistoricalDocsDirectory = (pathFromRoot) => pathFromRoot === join("docs", "superpowers");

const isGeneratedOrVendorDirectory = (pathFromRoot) => {
  if (ROOT_GENERATED_SCAN_DIRECTORIES.has(pathFromRoot)) {
    return true;
  }

  const segments = pathFromRoot.split(sep);
  const isWorkspaceOutput = segments.length === 3 &&
    (segments[0] === "packages" || segments[0] === "examples") &&
    (segments[2] === "dist" || (segments[0] === "packages" && segments[2] === ".tsbuildinfo"));

  return isWorkspaceOutput || segments.at(-1) === "node_modules";
};

const isKnownActiveTextPath = (path) =>
  ACTIVE_TEXT_FILENAMES.has(basename(path)) || ACTIVE_TEXT_EXTENSIONS.has(extname(path).toLowerCase());

const isExplicitBinaryPath = (path) => EXPLICIT_BINARY_EXTENSIONS.has(extname(path).toLowerCase());

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

const hasPublicImport = (readme, packageName) =>
  new RegExp(`from\\s+["']${escapeRegularExpression(packageName)}["']`, "u").test(readme);

const hasMarkdownLinkTarget = (readme, target) => {
  const escapedTarget = escapeRegularExpression(target);
  const targetPattern = `${escapedTarget}/?(?:#[^\\s)>]+)?`;
  const markdownLink = new RegExp(`\\[[^\\]]*\\]\\(\\s*<?${targetPattern}>?(?=\\s|\\))`, "u");
  const autoLink = new RegExp(`<${targetPattern}>`, "u");

  return markdownLink.test(readme) || autoLink.test(readme);
};

const SHELL_FENCE_LANGUAGES = new Set(["", "bash", "console", "sh", "shell", "zsh"]);
const BACKTICK_FENCE_OPENING_PATTERN = /^ {0,3}(`{3,})[ \t]*([A-Za-z0-9_-]*)[^`\r\n]*$/u;
const TILDE_FENCE_OPENING_PATTERN = /^ {0,3}(~{3,})[ \t]*([A-Za-z0-9_-]*)[^\r\n]*$/u;
const REGISTRY_NPM_COMMAND_PATTERN = /^npm\s+(?:whoami(?:\s|$)|profile\s+get(?:\s|$)|view(?:\s|$))/u;

const extractMarkdownCode = (markdown) => {
  const lines = markdown.split(/\r?\n/u);
  const outsideFences = [...lines];
  const shellFenceBodies = [];

  for (let openingIndex = 0; openingIndex < lines.length; openingIndex += 1) {
    const opening = BACKTICK_FENCE_OPENING_PATTERN.exec(lines[openingIndex])
      ?? TILDE_FENCE_OPENING_PATTERN.exec(lines[openingIndex]);
    if (!opening) {
      continue;
    }

    const marker = opening[1];
    const closingPattern = new RegExp(
      `^ {0,3}${escapeRegularExpression(marker[0])}{${marker.length},}[ \\t]*$`,
      "u"
    );
    let closingIndex = openingIndex + 1;
    while (closingIndex < lines.length && !closingPattern.test(lines[closingIndex])) {
      closingIndex += 1;
    }

    if (SHELL_FENCE_LANGUAGES.has(opening[2].toLowerCase())) {
      shellFenceBodies.push(lines.slice(openingIndex + 1, closingIndex).join("\n"));
    }

    const maskedThrough = Math.min(closingIndex, lines.length - 1);
    for (let index = openingIndex; index <= maskedThrough; index += 1) {
      outsideFences[index] = "";
    }
    openingIndex = closingIndex;
  }

  let paragraphOpen = false;
  for (let lineIndex = 0; lineIndex < outsideFences.length; lineIndex += 1) {
    const line = outsideFences[lineIndex];
    if (line.trim().length === 0) {
      paragraphOpen = false;
    } else if (/^(?: {4}| {0,3}\t)/u.test(line)) {
      if (!paragraphOpen) {
        outsideFences[lineIndex] = "";
      }
    } else {
      paragraphOpen = true;
    }
  }

  const inlineCodeSpans = [];
  const outsideMarkdown = outsideFences.join("\n");
  let index = 0;
  while (index < outsideMarkdown.length) {
    if (outsideMarkdown[index] !== "`") {
      index += 1;
      continue;
    }

    let openingLength = 1;
    while (outsideMarkdown[index + openingLength] === "`") {
      openingLength += 1;
    }

    let candidateIndex = index + openingLength;
    let closingIndex = -1;
    while (candidateIndex < outsideMarkdown.length) {
      candidateIndex = outsideMarkdown.indexOf("`", candidateIndex);
      if (candidateIndex === -1) {
        break;
      }

      let candidateLength = 1;
      while (outsideMarkdown[candidateIndex + candidateLength] === "`") {
        candidateLength += 1;
      }
      if (candidateLength === openingLength) {
        closingIndex = candidateIndex;
        break;
      }
      candidateIndex += candidateLength;
    }

    if (closingIndex === -1) {
      index += openingLength;
      continue;
    }

    let content = outsideMarkdown
      .slice(index + openingLength, closingIndex)
      .replace(/\r?\n/gu, " ");
    if (content.startsWith(" ") && content.endsWith(" ") && /\S/u.test(content.slice(1, -1))) {
      content = content.slice(1, -1);
    }
    inlineCodeSpans.push(content);
    index = closingIndex + openingLength;
  }

  return { inlineCodeSpans, shellFenceBodies };
};

const extractShellCommandSegments = (source) => {
  const segments = [];
  let current = "";
  let quote;
  let inComment = false;

  const pushCurrent = () => {
    const command = current.trim().replace(/^(?:\$|>)\s+/u, "");
    if (command.length > 0) {
      segments.push(command);
    }
    current = "";
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inComment) {
      if (character === "\n" || character === "\r") {
        inComment = false;
        pushCurrent();
        if (character === "\r" && source[index + 1] === "\n") {
          index += 1;
        }
      }
      continue;
    }

    if (quote) {
      current += character;
      if (character === quote) {
        quote = undefined;
      } else if (quote === '"' && character === "\\" && index + 1 < source.length) {
        current += source[index + 1];
        index += 1;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }

    if (character === "\\") {
      const newlineLength = source[index + 1] === "\r" && source[index + 2] === "\n"
        ? 2
        : source[index + 1] === "\n" ? 1 : 0;
      if (newlineLength > 0) {
        index += newlineLength;
        while (source[index + 1] === " " || source[index + 1] === "\t") {
          index += 1;
        }
        if (current.length > 0 && !/\s/u.test(current.at(-1))) {
          current += " ";
        }
      } else {
        current += character;
        if (index + 1 < source.length) {
          current += source[index + 1];
          index += 1;
        }
      }
      continue;
    }

    if (character === "#" && (current.length === 0 || /\s/u.test(current.at(-1)))) {
      inComment = true;
      continue;
    }

    if (character === "\n" || character === "\r" || character === ";" || character === "|" || character === "&") {
      pushCurrent();
      if ((character === "|" || character === "&") && source[index + 1] === character) {
        index += 1;
      } else if (character === "\r" && source[index + 1] === "\n") {
        index += 1;
      }
      continue;
    }

    current += character;
  }

  pushCurrent();
  return segments;
};

const extractShellArgumentValues = (command) => {
  const tokens = [];
  let current = "";
  let quote;
  let tokenStarted = false;

  const pushWord = () => {
    if (tokenStarted) {
      tokens.push({ type: "word", value: current });
    }
    current = "";
    tokenStarted = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (quote) {
      tokenStarted = true;
      if (character === quote) {
        quote = undefined;
      } else if (quote === '"' && character === "\\" && index + 1 < command.length) {
        const escapedCharacter = command[index + 1];
        if (escapedCharacter === "\r" && command[index + 2] === "\n") {
          index += 2;
        } else if (escapedCharacter === "\n") {
          index += 1;
        } else if (["$", "`", '"', "\\"].includes(escapedCharacter)) {
          current += escapedCharacter;
          index += 1;
        } else {
          current += character;
        }
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
      continue;
    }

    if (character === "\\" && index + 1 < command.length) {
      tokenStarted = true;
      current += command[index + 1];
      index += 1;
      continue;
    }

    if (/\s/u.test(character)) {
      pushWord();
      continue;
    }

    if (character === "<" || character === ">") {
      pushWord();
      const redirectMarker = character;
      while (command[index + 1] === redirectMarker) {
        index += 1;
      }
      tokens.push({ type: "redirect" });
      continue;
    }

    tokenStarted = true;
    current += character;
  }

  pushWord();

  const arguments_ = [];
  let expectsRedirectTarget = false;
  for (const token of tokens) {
    if (token.type === "redirect") {
      expectsRedirectTarget = true;
    } else if (expectsRedirectTarget) {
      expectsRedirectTarget = false;
    } else {
      arguments_.push(token.value);
    }
  }

  return arguments_;
};

const extractRegistryNpmCommands = (markdown) => {
  const { inlineCodeSpans, shellFenceBodies } = extractMarkdownCode(markdown);
  const commands = [...shellFenceBodies, ...inlineCodeSpans]
    .flatMap((source) => extractShellCommandSegments(source));

  return commands.filter((command) => REGISTRY_NPM_COMMAND_PATTERN.test(command));
};

const hasCanonicalRegistryArguments = (command) => {
  const arguments_ = extractShellArgumentValues(command);
  const hasPublicRegistry = arguments_.some((argument, index) =>
    argument === `--registry=${NPM_REGISTRY_URL}`
    || (argument === "--registry" && arguments_[index + 1] === NPM_REGISTRY_URL));
  const hasScopeRegistry = arguments_.includes(NPM_SCOPE_REGISTRY_ARGUMENT);

  return hasPublicRegistry && hasScopeRegistry;
};

const validateReleasingGuide = (root) => {
  const releasingGuidePath = join(root, RELEASING_GUIDE_PATH);
  let guide;

  try {
    guide = readFileSync(releasingGuidePath, "utf8");
  } catch (error) {
    throw new Error(`${RELEASING_GUIDE_PATH} is required: ${error instanceof Error ? error.message : String(error)}`);
  }

  const unsafeRegistryCommands = extractRegistryNpmCommands(guide)
    .filter((command) => !hasCanonicalRegistryArguments(command));

  if (unsafeRegistryCommands.length > 0) {
    throw new Error(
      `${RELEASING_GUIDE_PATH} unsafe or bare registry-touching npm commands: ${unsafeRegistryCommands.join(", ")}; `
      + `each command must include --registry ${NPM_REGISTRY_URL} and ${NPM_SCOPE_REGISTRY_ARGUMENT}`
    );
  }

  const expectedChecklistLines = [
    VERSION_PR_CHECKLIST_ITEM,
    ...LOCAL_CANDIDATE_CHECKLIST_ITEMS,
    BOOTSTRAP_PUBLISH_CHECKLIST_ITEM,
    TRUSTED_PUBLISHER_CHECKLIST_ITEM,
    TAG_CREATION_CHECKLIST_ITEM
  ];
  const identityAuditCommands = PUBLIC_PACKAGES.map(({ name }) => `npm view ${name} ${IDENTITY_AUDIT_ARGUMENTS} --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}`);
  const integrityConfirmationCommands = PUBLIC_PACKAGES.map(({ name }) => `npm view ${name}@${BOOTSTRAP_VERSION} ${INTEGRITY_CONFIRMATION_ARGUMENTS} --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}`);
  const requirements = [
    ...PUBLIC_PACKAGES.map(({ name }) => `\`${name}\``),
    ...expectedChecklistLines,
    ...identityAuditCommands,
    ...integrityConfirmationCommands,
    IDENTITY_AUDIT_STOP_RULE,
    E404_BOOTSTRAP_RULE,
    TOKEN_PUBLISHING_ACCESS_PATH,
    TOKEN_PUBLISHING_ACCESS_SETTING,
    TOKEN_PUBLISHING_ACCESS_SAVE,
    PORTABLE_NVM_COMMAND,
    COREPACK_VERSION_CHECK,
    BOOTSTRAP_CANDIDATE_CHECKLIST_ITEM,
    BOOTSTRAP_CANDIDATE_RULE,
    LATER_VERSION_PR_RULE,
    ACTIONS_PR_SETTING_CHECKLIST_ITEM,
    ACTIONS_PR_SETTING_PATH,
    ACTIONS_PR_SETTING_NAME,
    ACTIONS_PR_SETTING_AUDIT,
    VERSION_PR_APPROVAL_RULE,
    VERSION_PR_CHECKS_RULE,
    VERSION_PR_SEQUENCE_RULE,
    `npm whoami --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}`,
    `npm profile get --registry ${NPM_REGISTRY_URL} ${NPM_SCOPE_REGISTRY_ARGUMENT}`,
    BOOTSTRAP_PROVENANCE_EXCEPTION,
    LATER_PROVENANCE_REQUIREMENT,
    GITHUB_RELEASE_RERUN_RULE,
    GITHUB_RELEASE_EXISTING_RULE,
    GITHUB_RELEASE_CHECKOUT_RULE,
    GITHUB_RELEASE_NOT_FOUND_RULE,
    GITHUB_RELEASE_REST_RULE,
    GITHUB_RELEASE_LOOKUP_FAILURE_RULE,
    GITHUB_RELEASE_CREATE_RACE_RULE
  ];
  const missing = requirements.filter((requirement) => !guide.includes(requirement));
  const missingHeadings = RELEASE_CHECKLIST_HEADINGS.filter((heading) => !guide.includes(heading));

  if (missingHeadings.length > 0) {
    throw new Error(`${RELEASING_GUIDE_PATH} is missing required checklist sections: ${missingHeadings.join(", ")}`);
  }

  const sectionHeadings = guide.match(/^## .+$/gmu) ?? [];
  if (sectionHeadings.length !== RELEASE_CHECKLIST_HEADINGS.length) {
    throw new Error(`${RELEASING_GUIDE_PATH} must contain exactly five checklist sections`);
  }

  if (missing.length > 0) {
    throw new Error(`${RELEASING_GUIDE_PATH} is missing required release values: ${missing.join(", ")}`);
  }

  const releaseGuideFlow = [
    { name: "release candidate section", marker: RELEASE_CHECKLIST_SECTIONS.releaseCandidate },
    { name: "one-time bootstrap candidate", marker: BOOTSTRAP_CANDIDATE_CHECKLIST_ITEM },
    { name: "one-time bootstrap rule", marker: BOOTSTRAP_CANDIDATE_RULE },
    { name: "GitHub Actions pull request setting prerequisite", marker: ACTIONS_PR_SETTING_CHECKLIST_ITEM },
    { name: "GitHub Actions pull request setting path", marker: ACTIONS_PR_SETTING_PATH },
    { name: "GitHub Actions pull request setting name", marker: ACTIONS_PR_SETTING_NAME },
    { name: "GitHub Actions read-only audit", marker: ACTIONS_PR_SETTING_AUDIT },
    { name: "Version PR checklist", marker: VERSION_PR_CHECKLIST_ITEM },
    { name: "mandatory later Version PR", marker: LATER_VERSION_PR_RULE },
    { name: "Version PR workflow approval", marker: VERSION_PR_APPROVAL_RULE },
    { name: "Version PR required checks", marker: VERSION_PR_CHECKS_RULE },
    { name: "Version PR merge candidate", marker: VERSION_PR_SEQUENCE_RULE },
    ...LOCAL_CANDIDATE_CHECKLIST_ITEMS.map((marker) => ({ name: `local candidate check ${marker}`, marker })),
    { name: "bootstrap section", marker: RELEASE_CHECKLIST_SECTIONS.bootstrap },
    ...identityAuditCommands.map((marker) => ({ name: `identity audit ${marker}`, marker })),
    { name: "identity audit STOP rule", marker: IDENTITY_AUDIT_STOP_RULE },
    { name: "bootstrap publish", marker: BOOTSTRAP_PUBLISH_CHECKLIST_ITEM },
    { name: "Trusted Publisher section", marker: RELEASE_CHECKLIST_SECTIONS.trustedPublisher },
    { name: "Trusted Publisher setup", marker: TRUSTED_PUBLISHER_CHECKLIST_ITEM },
    { name: "tag release section", marker: RELEASE_CHECKLIST_SECTIONS.tagRelease },
    { name: "automated signed tag creation", marker: TAG_CREATION_CHECKLIST_ITEM },
    { name: "OIDC provenance confirmation", marker: LATER_PROVENANCE_REQUIREMENT },
    { name: "recovery section", marker: RELEASE_CHECKLIST_SECTIONS.recovery }
  ];
  let previousFlowMarker;

  for (const flowMarker of releaseGuideFlow) {
    const index = guide.indexOf(flowMarker.marker);

    if (index === -1) {
      throw new Error(`${RELEASING_GUIDE_PATH} cannot locate required release guide flow marker: ${flowMarker.name}`);
    }

    if (previousFlowMarker && index <= previousFlowMarker.index) {
      throw new Error(`${RELEASING_GUIDE_PATH} release guide flow must stay in the approved order: ${previousFlowMarker.name} before ${flowMarker.name}`);
    }

    previousFlowMarker = { name: flowMarker.name, index };
  }

  if (guide.includes(PERSONAL_NVM_BOOTSTRAP_PATH)) {
    throw new Error(`${RELEASING_GUIDE_PATH} must not contain a personal absolute nvm bootstrap path`);
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

  const brokenMainBranchLink = ["blob", "tree"]
    .map((linkType) => `${EXPECTED_REPOSITORY_URL}/${linkType}/main/`)
    .find((linkPrefix) => readme.includes(linkPrefix));

  if (brokenMainBranchLink !== undefined) {
    throw new Error(`${packageInfo.directory}/README.md must not link to the nonexistent main branch: ${brokenMainBranchLink}`);
  }

  const requirements = [
    [hasPackageToken(readme, packageInfo.name), "package name"],
    [hasPnpmAddPackage(readme, packageInfo.name), "pnpm install command"],
    [hasPublicImport(readme, packageInfo.name), "public import"],
    [hasMarkdownLinkTarget(readme, EXPECTED_REPOSITORY_URL), "repository link"],
    [readme.includes("MIT"), "MIT license"],
    [readme.includes(EXPECTED_BUGS_URL), "issue tracker link"],
    ...(packageInfo.name === CLI_PACKAGE_NAME
      ? CLI_README_DIRECT_DEPENDENCIES.flatMap((dependency) => [
        [hasPnpmAddPackage(readme, dependency), `direct install dependency ${dependency}`],
        [hasPublicImport(readme, dependency), `direct public import ${dependency}`]
      ])
      : [])
  ];

  const missing = requirements
    .filter(([isSatisfied]) => !isSatisfied)
    .map(([, description]) => description);

  if (missing.length > 0) {
    throw new Error(`${packageInfo.directory}/README.md is missing ${missing.join(", ")}`);
  }
};

const validateBuildArtifacts = (root, packageInfo, manifest) => {
  const requiredFiles = getPackageEntrypointTargets(manifest, packageInfo);

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

export function validateManifest(manifest, packageInfo) {
  const errors = [];
  const directory = packageInfo.directory;

  if (!isRecord(manifest)) {
    throw new Error(`${directory}: package manifest must be an object`);
  }

  if (typeof manifest.name !== "string" || !PUBLIC_PACKAGE_NAME_PATTERN.test(manifest.name)) {
    errors.push(`name must be an ${PUBLIC_PACKAGE_SCOPE} scoped package name`);
  } else if (manifest.name !== packageInfo.name) {
    errors.push(`name must equal ${packageInfo.name}`);
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

  try {
    validatePackageEntrypoints(manifest, packageInfo);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
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

const scanFiles = (root, directory = root) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    const pathFromRoot = relative(root, path);

    if (entry.isSymbolicLink()) {
      throw new Error(`${pathFromRoot}: symbolic links are not allowed in release scan paths`);
    }

    if (entry.isDirectory()) {
      if (isHistoricalDocsDirectory(pathFromRoot) || isGeneratedOrVendorDirectory(pathFromRoot)) {
        return [];
      }

      return scanFiles(root, path);
    }

    if (!entry.isFile()) {
      return [];
    }

    if (isExplicitBinaryPath(path)) {
      return [];
    }

    const contents = readFileSync(path);

    if (contents.includes(0) && isKnownActiveTextPath(path)) {
      throw new Error(`${pathFromRoot}: active text file must not contain NUL bytes`);
    }

    return [{ path, source: contents.toString("utf8") }];
  });

const validateLegacyPackageAbsence = (root) => {
  const files = scanFiles(root);
  const errors = [];

  for (const suffix of REMOVED_PUBLIC_PACKAGE_SUFFIXES) {
    const legacyDirectory = join(root, "packages", suffix);

    if (existsSync(legacyDirectory)) {
      errors.push(`${relative(root, legacyDirectory)} is a removed workspace package directory`);
    }
  }

  for (const { path, source } of files) {
    for (const prefix of LEGACY_PACKAGE_PREFIXES) {
      const matches = [...source.matchAll(new RegExp(`${escapeRegularExpression(prefix)}[A-Za-z0-9._-]+`, "gu"))]
        .map(([packageName]) => packageName);

      if (matches.length > 0) {
        for (const packageName of matches) {
          errors.push(`${relative(root, path)} contains previous package namespace ${packageName}`);
        }
      } else if (source.includes(prefix)) {
        errors.push(`${relative(root, path)} contains previous package namespace ${prefix}`);
      }
    }

    for (const removedName of REMOVED_PUBLIC_PACKAGE_NAMES) {
      if (source.includes(removedName)) {
        errors.push(`${relative(root, path)} contains removed package name ${removedName}`);
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
      validateManifest(manifest, packageInfo);
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
      validateBuildArtifacts(repositoryRoot, packageInfo, manifest);
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
