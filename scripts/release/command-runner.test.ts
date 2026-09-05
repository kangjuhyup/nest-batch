import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { commandForPlatform, localBinaryForPlatform, runCommandInherited, windowsCommandLine } from "./command-runner.mjs";

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

  it("streams child output and preserves a non-zero exit code / child 출력을 전달하고 non-zero exit code를 보존한다", async () => {
    const child = new EventEmitter();
    let invocation: { command: string; arguments_: readonly string[]; options: Record<string, unknown> } | undefined;
    const run = runCommandInherited("pnpm", ["typecheck"], { cwd: "/release" }, {
      spawnProcess: ((command: string, arguments_: readonly string[], options: Record<string, unknown>) => {
        invocation = { command, arguments_, options };
        queueMicrotask(() => child.emit("close", 7, null));
        return child;
      }) as never
    });

    await expect(run).rejects.toMatchObject({ code: 7 });
    expect(invocation).toMatchObject({
      command: "pnpm",
      arguments_: ["typecheck"],
      options: { cwd: "/release", stdio: "inherit" }
    });
  });
});
