import { posix } from "node:path";
import { CORE_SUBPATHS, PUBLIC_PACKAGE_SCOPE } from "./package-catalog.mjs";

const ROOT_EXPORT = {
  types: "./dist/index.d.ts",
  import: "./dist/index.js"
};

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const hasExactKeys = (value, expectedKeys) => {
  if (!isRecord(value)) {
    return false;
  }

  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return actualKeys.length === sortedExpectedKeys.length && actualKeys.every((key, index) => key === sortedExpectedKeys[index]);
};

const expectedEntrypoints = (packageInfo) => {
  const exports = { ".": { ...ROOT_EXPORT } };

  if (packageInfo.name === `${PUBLIC_PACKAGE_SCOPE}/core`) {
    for (const subpath of CORE_SUBPATHS) {
      exports[`./${subpath}`] = {
        types: `./dist/${subpath}/index.d.ts`,
        import: `./dist/${subpath}/index.js`
      };
    }
  }

  return {
    main: ROOT_EXPORT.import,
    types: ROOT_EXPORT.types,
    exports,
    bin: packageInfo.name === `${PUBLIC_PACKAGE_SCOPE}/cli` ? { "nest-batch": "./dist/bin.js" } : undefined
  };
};

const validateCanonicalTarget = (target, label, errors) => {
  if (typeof target !== "string") {
    errors.push(`${label} must be a string`);
    return;
  }

  const relativeTarget = target.startsWith("./") ? target.slice(2) : "";
  const segments = relativeTarget.split("/");

  if (
    !target.startsWith("./dist/") ||
    target.includes("\0") ||
    target.includes("\\") ||
    posix.isAbsolute(target) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    `./${posix.normalize(relativeTarget)}` !== target
  ) {
    errors.push(`${label} must be a canonical package-relative ./dist/ target`);
  }
};

export const validatePackageEntrypoints = (manifest, packageInfo) => {
  if (!isRecord(manifest)) {
    throw new Error(`${packageInfo.name}: package manifest must be an object`);
  }

  const expected = expectedEntrypoints(packageInfo);
  const errors = [];

  validateCanonicalTarget(manifest.main, "main", errors);
  if (manifest.main !== expected.main) {
    errors.push(`main must equal ${expected.main}`);
  }

  validateCanonicalTarget(manifest.types, "types", errors);
  if (manifest.types !== expected.types) {
    errors.push(`types must equal ${expected.types}`);
  }

  const expectedExportKeys = Object.keys(expected.exports);
  if (!hasExactKeys(manifest.exports, expectedExportKeys)) {
    errors.push(`exports keys must exactly equal ${JSON.stringify(expectedExportKeys)}`);
  }

  if (isRecord(manifest.exports)) {
    for (const [subpath, expectedExport] of Object.entries(expected.exports)) {
      const actualExport = manifest.exports[subpath];

      if (!hasExactKeys(actualExport, ["types", "import"])) {
        errors.push(`exports.${subpath} must contain exactly types and import`);
        continue;
      }

      for (const condition of ["types", "import"]) {
        const label = `exports.${subpath}.${condition}`;
        const actualTarget = actualExport[condition];
        validateCanonicalTarget(actualTarget, label, errors);
        if (actualTarget !== expectedExport[condition]) {
          errors.push(`${label} must equal ${expectedExport[condition]}`);
        }
      }
    }
  }

  if (expected.bin === undefined) {
    if (manifest.bin !== undefined) {
      errors.push("bin must be absent for non-CLI packages");
    }
  } else if (!hasExactKeys(manifest.bin, ["nest-batch"])) {
    errors.push("bin must contain exactly nest-batch");
  } else {
    validateCanonicalTarget(manifest.bin["nest-batch"], "bin.nest-batch", errors);
    if (manifest.bin["nest-batch"] !== expected.bin["nest-batch"]) {
      errors.push(`bin.nest-batch must equal ${expected.bin["nest-batch"]}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`${packageInfo.name}: invalid package entrypoints: ${errors.join("; ")}`);
  }
};

export const getPackageEntrypointTargets = (manifest, packageInfo) => {
  validatePackageEntrypoints(manifest, packageInfo);
  const expected = expectedEntrypoints(packageInfo);
  const targets = [expected.main, expected.types];

  for (const entry of Object.values(expected.exports)) {
    targets.push(entry.types, entry.import);
  }

  if (expected.bin !== undefined) {
    targets.push(expected.bin["nest-batch"]);
  }

  return [...new Set(targets)].map((target) => target.slice(2));
};
