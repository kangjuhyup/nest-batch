import { describe, expect, it } from "vitest";
import { commandForPlatform, localBinaryForPlatform, windowsCommandLine } from "./command-runner.mjs";

describe("release command runner / release command 실행기", () => {
  it("selects Windows command launchers / Windows command launcher를 선택한다", () => {
    expect(commandForPlatform("pnpm", "win32")).toBe("pnpm.cmd");
    expect(commandForPlatform("npm", "win32")).toBe("npm.cmd");
    expect(commandForPlatform("pnpm", "darwin")).toBe("pnpm");
    expect(localBinaryForPlatform("/consumer", "nest-batch", "win32")).toMatch(/nest-batch\.cmd$/u);
    expect(localBinaryForPlatform("/consumer", "nest-batch", "linux")).toMatch(/nest-batch$/u);
  });

  it("quotes Windows command values and rejects shell metacharacters / Windows 명령 값을 인용하고 shell 메타문자를 거부한다", () => {
    expect(windowsCommandLine("pnpm.cmd", ["--dir", "C:\\release work", "pack"]))
      .toBe('"pnpm.cmd" "--dir" "C:\\release work" "pack"');
    expect(() => windowsCommandLine("pnpm.cmd", ["typecheck&whoami"]))
      .toThrow(/unsafe Windows command value/u);
  });
});
