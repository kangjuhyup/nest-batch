import { access, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PUBLIC_PACKAGES } from "./package-catalog.mjs";
import { publicBuildInfoDirectories, runReleaseCheck } from "./release-check.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("release check cleanup / release check 정리", () => {
  it("removes catalog build metadata after a command fails / 명령 실패 후 catalog build metadata를 제거한다", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "nest-batch-release-check-test-"));
    temporaryRoots.push(repositoryRoot);
    const buildInfoDirectories = publicBuildInfoDirectories(repositoryRoot);

    expect(buildInfoDirectories).toHaveLength(PUBLIC_PACKAGES.length);
    await Promise.all(buildInfoDirectories.map((directory) => mkdir(directory, { recursive: true })));

    let attempts = 0;

    await expect(runReleaseCheck({
      repositoryRoot,
      run: async () => {
        attempts += 1;
        throw new Error("forced release command failure");
      }
    })).rejects.toThrow(/forced release command failure/u);

    expect(attempts).toBe(1);
    await Promise.all(buildInfoDirectories.map((directory) => expect(access(directory)).rejects.toThrow()));
  });
});
