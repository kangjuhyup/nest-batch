import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandForPlatform, localBinaryForPlatform, runCommandInherited } from "./command-runner.mjs";
import { CORE_SUBPATHS, PUBLIC_PACKAGE_SCOPE, PUBLIC_PACKAGES } from "./package-catalog.mjs";
import { packPackages, validatePackedManifest } from "./pack-packages.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const consumerSource = `import { DefaultBatchRunner, defineJob } from "${PUBLIC_PACKAGE_SCOPE}/batch-core";
import { WorkerLoop } from "${PUBLIC_PACKAGE_SCOPE}/batch-core/queue";
import { SchedulerLoop } from "${PUBLIC_PACKAGE_SCOPE}/batch-core/scheduler";
import { ContinuousPollingLoop } from "${PUBLIC_PACKAGE_SCOPE}/batch-core/polling";
import { LocalWorkerPool, WorkerThreadPool } from "${PUBLIC_PACKAGE_SCOPE}/batch-core/worker";
import { NestBatchModule } from "${PUBLIC_PACKAGE_SCOPE}/batch-nest";
import { InMemoryBatchStorage } from "${PUBLIC_PACKAGE_SCOPE}/batch-inmemory";
import { PostgresBatchStorage } from "${PUBLIC_PACKAGE_SCOPE}/batch-postgres";
import { MySqlBatchStorage } from "${PUBLIC_PACKAGE_SCOPE}/batch-mysql";
import { MariaDbBatchStorage } from "${PUBLIC_PACKAGE_SCOPE}/batch-mariadb";
import { BullMqWorkQueue } from "${PUBLIC_PACKAGE_SCOPE}/batch-bullmq";
import { runCli } from "${PUBLIC_PACKAGE_SCOPE}/batch-cli";

void [DefaultBatchRunner, defineJob, WorkerLoop, SchedulerLoop, ContinuousPollingLoop,
  LocalWorkerPool, WorkerThreadPool, NestBatchModule, InMemoryBatchStorage,
  PostgresBatchStorage, MySqlBatchStorage, MariaDbBatchStorage, BullMqWorkQueue, runCli];
`;

const runtimeImportsSource = `const specifiers = ${JSON.stringify([
  ...PUBLIC_PACKAGES.map(({ name }) => name),
  ...CORE_SUBPATHS.map((subpath) => `${PUBLIC_PACKAGE_SCOPE}/batch-core/${subpath}`)
])};

await Promise.all(specifiers.map(async (specifier) => {
  const module = await import(specifier);

  if (Object.keys(module).length === 0) {
    throw new Error(specifier + " has no runtime exports.");
  }
}));
`;

export const createConsumerTsconfig = () => ({
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    noEmit: true
  },
  files: ["consumer.ts"]
});

const run = (command, arguments_, options) => runCommandInherited(command, arguments_, options);

export const validateInstalledPackageMetadata = async (consumerRoot, artifacts) => {
  if (!Array.isArray(artifacts) || artifacts.length !== PUBLIC_PACKAGES.length) {
    throw new Error(`Installed metadata validation requires ${PUBLIC_PACKAGES.length} catalog artifacts.`);
  }

  for (let index = 0; index < PUBLIC_PACKAGES.length; index += 1) {
    const packageInfo = PUBLIC_PACKAGES[index];
    const artifact = artifacts[index];

    if (artifact?.name !== packageInfo.name || typeof artifact.version !== "string") {
      throw new Error(`Installed metadata artifact at catalog order ${index} must be ${packageInfo.name}.`);
    }

    const packagePath = join(consumerRoot, "node_modules", ...packageInfo.name.split("/"), "package.json");
    let manifest;

    try {
      manifest = JSON.parse(await readFile(packagePath, "utf8"));
    } catch (error) {
      throw new Error(`${packageInfo.name}: unable to read installed package metadata: ${error instanceof Error ? error.message : String(error)}`);
    }

    validatePackedManifest(manifest, packageInfo, artifact.version, artifact.manifest);
  }
};

export async function smokePackages() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "nest-batch-consumer-"));

  try {
    const tarballDirectory = join(temporaryRoot, "tarballs");
    const artifacts = await packPackages(tarballDirectory);
    const dependencies = Object.fromEntries(artifacts.map((artifact) => [artifact.name, `file:${artifact.tarball}`]));
    const consumerManifest = {
      name: "nest-batch-release-smoke-consumer",
      private: true,
      type: "module",
      dependencies
    };
    const consumerTsconfig = createConsumerTsconfig();

    await writeFile(join(temporaryRoot, "package.json"), `${JSON.stringify(consumerManifest, null, 2)}\n`);
    await writeFile(join(temporaryRoot, "tsconfig.json"), `${JSON.stringify(consumerTsconfig, null, 2)}\n`);
    await writeFile(join(temporaryRoot, "consumer.ts"), consumerSource);
    await writeFile(join(temporaryRoot, "runtime-imports.mjs"), runtimeImportsSource);

    await run(commandForPlatform("npm"), ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: temporaryRoot });
    await validateInstalledPackageMetadata(temporaryRoot, artifacts);
    await run(process.execPath, [join(REPOSITORY_ROOT, "node_modules", "typescript", "bin", "tsc"), "--project", "tsconfig.json"], {
      cwd: temporaryRoot
    });
    await run(process.execPath, ["runtime-imports.mjs"], { cwd: temporaryRoot });
    await run(localBinaryForPlatform(temporaryRoot, "nest-batch"), ["--help"], { cwd: temporaryRoot });

    return artifacts;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

const isDirectExecution = () =>
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution()) {
  try {
    const artifacts = await smokePackages();
    console.log(`Release smoke test passed for ${artifacts.length} packages.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
