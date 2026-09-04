import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_PACKAGES } from "./package-catalog.mjs";
import { versionPackages } from "./version-packages.mjs";

const createVersionFixture = async ({
  packageVersion = "0.1.0",
  rootVersion = "0.1.0",
  pendingChangeset = false
}: {
  packageVersion?: string;
  rootVersion?: string;
  pendingChangeset?: boolean;
} = {}): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "nest-batch-release-version-test-"));
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "fixture", private: true, version: rootVersion, scripts: { test: "vitest" } }, null, 2)}\n`
  );
  await mkdir(join(root, ".changeset"), { recursive: true });
  await writeFile(join(root, ".changeset", "README.md"), "# Changeset\n");

  if (pendingChangeset) {
    await writeFile(join(root, ".changeset", "pending.md"), "---\n\"@nest-batch/core\": minor\n---\n\nrelease\n");
  }

  await Promise.all(PUBLIC_PACKAGES.map(async ({ directory, name }) => {
    const packageDirectory = join(root, directory);
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(
      join(packageDirectory, "package.json"),
      `${JSON.stringify({ name, version: packageVersion }, null, 2)}\n`
    );
  }));

  return root;
};

const setPackageVersions = async (root: string, version: string) => {
  await Promise.all(PUBLIC_PACKAGES.map(async ({ directory, name }) => {
    await writeFile(join(root, directory, "package.json"), `${JSON.stringify({ name, version }, null, 2)}\n`);
  }));
};

const readRootManifest = async (root: string) => JSON.parse(await readFile(join(root, "package.json"), "utf8"));

describe("release version orchestration / release version orchestration을 검증한다", () => {
  it("runs pending changeset versioning before synchronizing the root version / pending Changeset versioning 후 root version을 동기화한다", async () => {
    const root = await createVersionFixture({ pendingChangeset: true });

    try {
      const run = async (command: string, arguments_: readonly string[], options: { cwd: string }) => {
        if (!command.endsWith("changeset") || arguments_.join(" ") !== "version" || options.cwd !== root) {
          throw new Error("expected changeset version command");
        }

        await setPackageVersions(root, "0.2.0");
      };

      await expect(versionPackages(root, { run })).resolves.toBe("0.2.0");
      await expect(readRootManifest(root)).resolves.toMatchObject({ version: "0.2.0" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("propagates a pending changeset versioning failure / pending Changeset versioning 실패를 전파한다", async () => {
    const root = await createVersionFixture({ pendingChangeset: true });

    try {
      await expect(versionPackages(root, {
        run: async () => {
          throw new Error("changeset failed");
        }
      })).rejects.toThrow("changeset failed");
      await expect(readRootManifest(root)).resolves.toMatchObject({ version: "0.1.0" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("recovers a partially applied version without pending changesets / pending Changeset 없이 부분 적용된 version을 복구한다", async () => {
    const root = await createVersionFixture({ packageVersion: "0.2.0" });

    try {
      await expect(versionPackages(root, {
        run: async () => {
          throw new Error("changeset version must not run without a pending changeset");
        }
      })).resolves.toBe("0.2.0");
      await expect(readFile(join(root, "package.json"), "utf8")).resolves.toBe(
        `${JSON.stringify({ name: "fixture", private: true, version: "0.2.0", scripts: { test: "vitest" } }, null, 2)}\n`
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
