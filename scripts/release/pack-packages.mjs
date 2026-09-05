import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { commandForPlatform, runCommand } from "./command-runner.mjs";
import { NPM_REGISTRY_URL, PUBLIC_PACKAGES, REPOSITORY_URL } from "./package-catalog.mjs";
import { getPackageEntrypointTargets, validatePackageEntrypoints } from "./package-entrypoints.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ALLOWED_ROOT_FILES = new Set(["README.md", "LICENSE", "package.json"]);
const REQUIRED_ROOT_FILES = [...ALLOWED_ROOT_FILES];
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

export function validatePackedFiles(artifact, manifest, packageInfo) {
  const paths = getFilePaths(artifact);

  for (const path of paths) {
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

  const pathSet = new Set(paths);
  const missingRootFiles = REQUIRED_ROOT_FILES.filter((path) => !pathSet.has(path));

  if (missingRootFiles.length > 0) {
    throw new Error(`${artifact.name}: packed artifact is missing required root files ${missingRootFiles.join(", ")}.`);
  }

  const missingEntrypoints = getPackageEntrypointTargets(manifest, packageInfo).filter((path) => !pathSet.has(path));

  if (missingEntrypoints.length > 0) {
    throw new Error(`${artifact.name}: packed artifact is missing referenced entrypoints ${missingEntrypoints.join(", ")}.`);
  }
}

const PUBLIC_PACKAGE_NAMES = new Set(PUBLIC_PACKAGES.map(({ name }) => name));
const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];

export function validatePackedManifest(manifest, packageInfo, expectedVersion, sourceManifest = undefined) {
  if (!isRecord(manifest)) {
    throw new Error(`${packageInfo.name}: packed package.json must be an object.`);
  }

  const errors = [];

  if (manifest.name !== packageInfo.name) {
    errors.push(`name must equal ${packageInfo.name}`);
  }

  if (manifest.version !== expectedVersion) {
    errors.push(`version must equal ${expectedVersion}`);
  }

  if (!isRecord(manifest.repository) || manifest.repository.url !== REPOSITORY_URL || manifest.repository.directory !== packageInfo.directory) {
    errors.push("repository metadata must match the release catalog");
  }

  if (!isRecord(manifest.engines) || manifest.engines.node !== ">=20.18.0") {
    errors.push('engines.node must equal ">=20.18.0"');
  }

  if (!isRecord(manifest.publishConfig) || manifest.publishConfig.access !== "public" || manifest.publishConfig.registry !== NPM_REGISTRY_URL) {
    errors.push(`publishConfig must target ${NPM_REGISTRY_URL} with public access`);
  }

  try {
    validatePackageEntrypoints(manifest, packageInfo);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = manifest[field];

    if (dependencies === undefined) {
      continue;
    }

    if (!isRecord(dependencies)) {
      errors.push(`${field} must be an object`);
      continue;
    }

    for (const [name, version] of Object.entries(dependencies)) {
      if (PUBLIC_PACKAGE_NAMES.has(name) && version !== expectedVersion) {
        errors.push(`${field}.${name} must equal exact fixed version ${expectedVersion}`);
      }
    }

    if (sourceManifest !== undefined) {
      const sourceDependencies = isRecord(sourceManifest[field]) ? sourceManifest[field] : {};
      const expectedInternalNames = Object.keys(sourceDependencies).filter((name) => PUBLIC_PACKAGE_NAMES.has(name)).sort();
      const packedInternalNames = Object.keys(dependencies).filter((name) => PUBLIC_PACKAGE_NAMES.has(name)).sort();

      if (JSON.stringify(packedInternalNames) !== JSON.stringify(expectedInternalNames)) {
        errors.push(`${field} internal package names must match the source manifest`);
      }
    }
  }

  if (sourceManifest !== undefined) {
    for (const field of DEPENDENCY_FIELDS) {
      if (manifest[field] !== undefined) {
        continue;
      }

      const sourceDependencies = isRecord(sourceManifest[field]) ? sourceManifest[field] : {};
      const expectedInternalNames = Object.keys(sourceDependencies).filter((name) => PUBLIC_PACKAGE_NAMES.has(name));

      if (expectedInternalNames.length > 0) {
        errors.push(`${field} is missing internal packages from the source manifest`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`${packageInfo.name}: invalid packed package.json: ${errors.join("; ")}.`);
  }
}

const readTarString = (buffer, offset, length) => buffer.subarray(offset, offset + length).toString("utf8").replace(/\0.*$/u, "");

export const readPackedManifest = async (tarball) => {
  const archive = gunzipSync(await readFile(tarball));
  let offset = 0;
  let manifestSource;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);

    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const path = prefix.length > 0 ? `${prefix}/${name}` : name;
    const sizeSource = readTarString(header, 124, 12).trim();
    const size = sizeSource.length === 0 ? 0 : Number.parseInt(sizeSource, 8);

    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`Invalid tar entry size for ${path}.`);
    }

    const bodyOffset = offset + 512;
    const nextOffset = bodyOffset + Math.ceil(size / 512) * 512;

    if (nextOffset > archive.length) {
      throw new Error(`Truncated tar entry ${path}.`);
    }

    if (path === "package/package.json") {
      if (manifestSource !== undefined) {
        throw new Error("Packed artifact contains duplicate package/package.json entries.");
      }

      manifestSource = archive.subarray(bodyOffset, bodyOffset + size).toString("utf8");
    }

    offset = nextOffset;
  }

  if (manifestSource === undefined) {
    throw new Error("Packed artifact is missing package/package.json.");
  }

  try {
    return JSON.parse(manifestSource);
  } catch (error) {
    throw new Error(`Packed package.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
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

    const packedManifest = await readPackedManifest(tarball);
    const sourceManifest = JSON.parse(await readFile(join(REPOSITORY_ROOT, packageInfo.directory, "package.json"), "utf8"));
    validatePackedManifest(packedManifest, packageInfo, packed.version, sourceManifest);
    validatePackedFiles(artifact, packedManifest, packageInfo);
    artifact.manifest = packedManifest;
    artifacts.push(artifact);
  }

  return artifacts;
}
