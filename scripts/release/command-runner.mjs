import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const WINDOWS_SHELL_METACHARACTERS = /[\0\r\n"&|<>^%!]/u;

export const commandForPlatform = (command, platform = process.platform) =>
  platform === "win32" ? `${command}.cmd` : command;

export const localBinaryForPlatform = (directory, binary, platform = process.platform) =>
  join(directory, "node_modules", ".bin", `${binary}${platform === "win32" ? ".cmd" : ""}`);

const quoteWindowsCommandValue = (value) => {
  if (typeof value !== "string" || WINDOWS_SHELL_METACHARACTERS.test(value)) {
    throw new Error(`unsafe Windows command value: ${JSON.stringify(value)}`);
  }

  return `"${value}"`;
};

export const windowsCommandLine = (command, arguments_) =>
  [command, ...arguments_].map(quoteWindowsCommandValue).join(" ");

export const runCommand = (command, arguments_, options = {}) => {
  if (process.platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    return executeFile(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", windowsCommandLine(command, arguments_)],
      options
    );
  }

  return executeFile(command, arguments_, options);
};
