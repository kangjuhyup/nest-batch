import { lstat, readFile, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { commandForPlatform, runCommandInherited } from "./command-runner.mjs";
import { PUBLIC_PACKAGE_SCOPE, PUBLIC_PACKAGES } from "./package-catalog.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RELEASE_CHECK_SCRIPTS = ["typecheck", "test", "build", "release:verify", "release:smoke"];
const PUBLIC_PACKAGE_NAME = new RegExp(`^${PUBLIC_PACKAGE_SCOPE}/([a-z0-9-]+)$`, "u");

const isCanonicalPosixRelativePath = (path) => {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0") || path.includes("\\")) {
    return false;
  }

  const segments = path.split("/");
  return !posix.isAbsolute(path) &&
    !segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") &&
    posix.normalize(path) === path;
};

const canonicalReferencePath = (path) => {
  const normalized = typeof path === "string" && path.startsWith("./") ? path.slice(2) : path;

  if (!isCanonicalPosixRelativePath(normalized)) {
    throw new Error(`${JSON.stringify(path)}: invalid root project reference.`);
  }

  return normalized;
};

const publicPackageDirectory = (packageInfo) => {
  const match = typeof packageInfo?.name === "string" ? PUBLIC_PACKAGE_NAME.exec(packageInfo.name) : undefined;
  const directory = packageInfo?.directory;
  const expectedDirectory = match === null || match === undefined ? undefined : `packages/${match[1]}`;

  if (!isCanonicalPosixRelativePath(directory) || directory !== expectedDirectory) {
    throw new Error(`${JSON.stringify(directory)}: invalid public package directory.`);
  }

  return directory;
};

const isWithinDirectory = (directory, path) => {
  const pathFromDirectory = relative(directory, path);
  return pathFromDirectory.length > 0 &&
    pathFromDirectory !== ".." &&
    !pathFromDirectory.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromDirectory);
};

const assertContainedPath = async (repositoryRoot, target, label) => {
  if (!isWithinDirectory(repositoryRoot, target)) {
    throw new Error(`${label}: cleanup target is outside the canonical repository.`);
  }

  const pathFromRoot = relative(repositoryRoot, target);
  let currentPath = repositoryRoot;

  for (const segment of pathFromRoot.split(sep)) {
    currentPath = join(currentPath, segment);

    try {
      const stats = await lstat(currentPath);

      if (stats.isSymbolicLink()) {
        throw new Error(`${label}: symbolic link is not allowed in cleanup paths.`);
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return;
      }

      throw error;
    }
  }
};

const assertProjectBoundary = (projectPath, target, projectDirectory) => {
  if (!isWithinDirectory(projectPath, target)) {
    throw new Error(`${projectDirectory}: cleanup target is outside the approved project boundary.`);
  }
};

const readJson = async (path, label) => {
  let source;

  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`${label}: unable to read tsconfig.json: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label}: invalid tsconfig.json: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const projectBuildInfoTarget = async (repositoryRoot, projectDirectory) => {
  const projectPath = resolve(repositoryRoot, projectDirectory);
  await assertContainedPath(repositoryRoot, projectPath, projectDirectory);

  const configPath = join(projectPath, "tsconfig.json");
  await assertContainedPath(repositoryRoot, configPath, projectDirectory);
  const config = await readJson(configPath, projectDirectory);
  const configuredPath = config?.compilerOptions?.tsBuildInfoFile;
  const buildInfoPath = configuredPath === undefined ? "tsconfig.tsbuildinfo" : configuredPath;

  if (!isCanonicalPosixRelativePath(buildInfoPath)) {
    throw new Error(`${projectDirectory}: invalid tsBuildInfoFile cleanup target.`);
  }

  const segments = buildInfoPath.split("/");
  const buildInfoDirectoryIndex = segments.indexOf(".tsbuildinfo");
  const cleanupPath = resolve(
    projectPath,
    ...(buildInfoDirectoryIndex === -1 ? segments : segments.slice(0, buildInfoDirectoryIndex + 1))
  );
  assertProjectBoundary(projectPath, cleanupPath, projectDirectory);
  await assertContainedPath(repositoryRoot, cleanupPath, projectDirectory);

  return cleanupPath;
};

const projectDistTarget = async (repositoryRoot, projectDirectory) => {
  const projectPath = resolve(repositoryRoot, projectDirectory);
  await assertContainedPath(repositoryRoot, projectPath, projectDirectory);
  const cleanupPath = resolve(projectPath, "dist");
  assertProjectBoundary(projectPath, cleanupPath, projectDirectory);
  await assertContainedPath(repositoryRoot, cleanupPath, projectDirectory);
  return cleanupPath;
};

const exampleDirectoriesFromRootConfig = async (repositoryRoot) => {
  const rootConfigPath = join(repositoryRoot, "tsconfig.json");
  await assertContainedPath(repositoryRoot, rootConfigPath, "root tsconfig");
  const rootConfig = await readJson(rootConfigPath, "root");

  if (rootConfig.references === undefined) {
    return [];
  }

  if (!Array.isArray(rootConfig.references)) {
    throw new Error("root tsconfig: references must be an array.");
  }

  return rootConfig.references.flatMap((reference) => {
    if (reference === null || typeof reference !== "object" || Array.isArray(reference)) {
      throw new Error("root tsconfig: project references must be objects.");
    }

    const directory = canonicalReferencePath(reference.path);

    if (!directory.startsWith("examples/")) {
      return [];
    }

    const segments = directory.split("/");

    if (segments.length !== 2) {
      throw new Error(`${directory}: invalid example project directory.`);
    }

    return [directory];
  });
};

const unique = (values) => [...new Set(values)];

export const releaseBuildInfoTargets = async (
  root = REPOSITORY_ROOT,
  { publicPackages = PUBLIC_PACKAGES } = {}
) => {
  const repositoryRoot = await realpath(resolve(root));
  const packageDirectories = publicPackages.map(publicPackageDirectory);
  const packageTargets = await Promise.all(packageDirectories.map((projectDirectory) =>
    projectBuildInfoTarget(repositoryRoot, projectDirectory)
  ));
  const exampleDirectories = await exampleDirectoriesFromRootConfig(repositoryRoot);
  const projectDirectories = unique(exampleDirectories);
  const exampleTargets = await Promise.all(projectDirectories.map((projectDirectory) =>
    projectBuildInfoTarget(repositoryRoot, projectDirectory)
  ));

  return [...packageTargets, ...exampleTargets];
};

export const cleanupReleaseBuildInfo = async (root = REPOSITORY_ROOT, options = {}) => {
  const targets = await releaseBuildInfoTargets(root, options);

  for (const target of targets) {
    await rm(target, { recursive: true, force: true });
  }
};

export const releaseOutputTargets = async (
  root = REPOSITORY_ROOT,
  { publicPackages = PUBLIC_PACKAGES } = {}
) => {
  const repositoryRoot = await realpath(resolve(root));
  const packageDirectories = publicPackages.map(publicPackageDirectory);
  return Promise.all(packageDirectories.map((projectDirectory) => projectDistTarget(repositoryRoot, projectDirectory)));
};

export const cleanupReleaseOutputs = async (root = REPOSITORY_ROOT, options = {}) => {
  const targets = await releaseOutputTargets(root, options);

  for (const target of targets) {
    await rm(target, { recursive: true, force: true });
  }
};

export const runReleaseCheck = async ({ repositoryRoot = REPOSITORY_ROOT, run = runCommandInherited } = {}) => {
  const root = resolve(repositoryRoot);

  try {
    await cleanupReleaseOutputs(root);
    await cleanupReleaseBuildInfo(root);

    for (const script of RELEASE_CHECK_SCRIPTS) {
      await run(commandForPlatform("pnpm"), [script], { cwd: root });
    }
  } finally {
    await cleanupReleaseBuildInfo(root);
  }
};

const isDirectExecution = () =>
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution()) {
  try {
    await runReleaseCheck();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
