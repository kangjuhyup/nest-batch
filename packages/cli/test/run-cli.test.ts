import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

describe("runCli / runCli 동작을 검증한다", () => {
  it("prints help for empty args / 빈 인자에 대해 help를 출력한다", async () => {
    await expect(runCli([])).resolves.toEqual({
      exitCode: 0,
      output: "nest-batch commands: run, status, retry, list"
    });
  });

  it("rejects unknown commands / 알 수 없는 command를 거부한다", async () => {
    await expect(runCli(["unknown"])).resolves.toEqual({
      exitCode: 1,
      output: 'Unknown command "unknown".'
    });
  });
});
