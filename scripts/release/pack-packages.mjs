import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { commandForPlatform, runCommand } from "./command-runner.mjs";
import { CORE_SUBPATHS, PUBLIC_PACKAGES } from "./package-catalog.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ALLOWED_ROOT_FILES = new Set(["README.md", "LICENSE", "package.json"]);
const SENSITIVE_EXTENSIONS = new Set([".cer", ".crt", ".key", ".p12", ".pem", ".pfx"]);

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const isWithinDirectory = (directory, path) => {
  const pathFromDirectory = relative(directory, path);
  return pathFromDirectory !== ".." && !pathFromDirectory.startsWith(`..${sep}`) && !isAbsolute(pathFromDirectory);
};

const getFilePaths = (artifact) => {
  if (!isRecord(artifact) || typeof artifact.name !== "string") {
    throw new Error("Package artifact must include a package name.");
  }

  if (!Array.isArray(artifact.files)) {
    throw new Error(`${artifact.name}: packed file list must be an array.`);
  }

  return artifact.files.map((file) => {
    if (typeof file !== "string") {
      throw new Error(`${artifact.name}: packed file path must be a string.`);
    }

    return file;
  });
};

const validateCanonicalPackedPath = (packageName, path) => {
  const segments = path.split("/");

  if (
    path.length === 0 ||
    path.includes("\0") ||
    path.includes("\\") ||
    posix.isAbsolute(path) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    posix.normalize(path) !== path
  ) {
    throw new Error(`${packageName}: packed file path ${JSON.stringify(path)} must be a canonical POSIX relative path.`);
  }
};

const isForbiddenPath = (path) => {
  const segments = path.split("/");
  const basename = segments.at(-1)?.toLowerCase() ?? "";

  if (path.includes(".tsbuildinfo")) {
    return "TypeScript build metadata";
  }

  if (segments.includes("test")) {
    return "test files";
  }

  if (segments.some((segment) => segment === ".env" || segment.startsWith(".env."))) {
    return "environment files";
  }

  if (segments.some((segment) => segment === "npmrc" || segment.endsWith(".npmrc"))) {
    return "npm configuration";
  }

  if (SENSITIVE_EXTENSIONS.has(basename.slice(basename.lastIndexOf(".")))) {
    return "sensitive key or certificate files";
  }

  return undefined;
};

export function validatePackedFiles(artifact) {
  for (const path of getFilePaths(artifact)) {
    validateCanonicalPackedPath(artifact.name, path);
    const forbiddenReason = isForbiddenPath(path);

    if (forbiddenReason !== undefined) {
      throw new Error(`${artifact.name}: packed file ${path} contains ${forbiddenReason}.`);
    }

    if (ALLOWED_ROOT_FILES.has(path) || path.startsWith("dist/") || path.startsWith("src/")) {
      continue;
    }

    throw new Error(`${artifact.name}: packed file ${path} is not allowed.`);
  }
}

const validateRequiredEntrypoints = (artifact) => {
  const requiredFiles = ["dist/index.js", "dist/index.d.ts"];

  if (artifact.name === "@nest-batch/core") {
    for (const subpath of CORE_SUBPATHS) {
      requiredFiles.push(`dist/${subpath}/index.js`, `dist/${subpath}/index.d.ts`);
    }
  }

  if (artifact.name === "@nest-batch/cli") {
    requiredFiles.push("dist/bin.js");
  }

  const packedFiles = new Set(getFilePaths(artifact));
  const missing = requiredFiles.filter((path) => !packedFiles.has(path));

  if (missing.length > 0) {
    throw new Error(`${artifact.name}: packed artifact is missing ${missing.join(", ")}.`);
  }
};

const parsePackResult = (stdout, packageInfo) => {
  let results;

  try {
    results = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${packageInfo.name}: pnpm pack did not return JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const entries = Array.isArray(results) ? results : [results];

  if (entries.length !== 1 || !isRecord(entries[0])) {
    throw new Error(`${packageInfo.name}: pnpm pack must return exactly one package result.`);
  }

  const result = entries[0];

  if (result.name !== packageInfo.name || typeof result.version !== "string" || typeof result.filename !== "string") {
    throw new Error(`${packageInfo.name}: pnpm pack returned an invalid package result.`);
  }

  if (!Array.isArray(result.files)) {
    throw new Error(`${packageInfo.name}: pnpm pack result is missing its file list.`);
  }

  const files = result.files.map((file) => {
    if (!isRecord(file) || typeof file.path !== "string") {
      throw new Error(`${packageInfo.name}: pnpm pack result contains an invalid file path.`);
    }

    return file.path;
  });

  return { filename: result.filename, files, version: result.version };
};

export async function packPackages(destination) {
  const outputDirectory = resolve(destination);
  await mkdir(outputDirectory, { recursive: true });

  const artifacts = [];

  for (const packageInfo of PUBLIC_PACKAGES) {
    const { stdout } = await runCommand(
      commandForPlatform("pnpm"),
      ["--dir", join(REPOSITORY_ROOT, packageInfo.directory), "pack", "--pack-destination", outputDirectory, "--json"],
      { cwd: REPOSITORY_ROOT, maxBuffer: 10 * 1024 * 1024 }
    );
    const packed = parsePackResult(stdout, packageInfo);
    const tarball = resolve(outputDirectory, packed.filename);

    if (!isWithinDirectory(outputDirectory, tarball)) {
      throw new Error(`${packageInfo.name}: pnpm pack returned a tarball outside ${outputDirectory}.`);
    }

    const artifact = {
      name: packageInfo.name,
      version: packed.version,
      directory: packageInfo.directory,
      tarball,
      files: packed.files,
      integrity: `sha512-${createHash("sha512").update(await readFile(tarball)).digest("base64")}`
    };

    validatePackedFiles(artifact);
    validateRequiredEntrypoints(artifact);
    artifacts.push(artifact);
  }

  return artifacts;
}
