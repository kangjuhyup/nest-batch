import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

describe("runCli", () => {
  it("prints help for empty args", async () => {
    await expect(runCli([])).resolves.toEqual({
      exitCode: 0,
      output: "nest-batch commands: run, status, retry, list"
    });
  });

  it("rejects unknown commands", async () => {
    await expect(runCli(["unknown"])).resolves.toEqual({
      exitCode: 1,
      output: 'Unknown command "unknown".'
    });
  });
});
