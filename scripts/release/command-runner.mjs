import { execFile, spawn } from "node:child_process";
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

const windowsCommandArguments = (command, arguments_) => [
  "/d",
  "/s",
  "/c",
  windowsCommandLine(command, arguments_)
];

export const runCommand = (command, arguments_, options = {}) => {
  if (process.platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    return executeFile(
      process.env.ComSpec ?? "cmd.exe",
      windowsCommandArguments(command, arguments_),
      options
    );
  }

  return executeFile(command, arguments_, options);
};

const spawnCommand = (command, arguments_, options, spawnProcess) => {
  if (process.platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    return spawnProcess(
      process.env.ComSpec ?? "cmd.exe",
      windowsCommandArguments(command, arguments_),
      options
    );
  }

  return spawnProcess(command, arguments_, options);
};

export const runCommandInherited = (
  command,
  arguments_,
  options = {},
  { spawnProcess = spawn } = {}
) => new Promise((resolve, reject) => {
  const child = spawnCommand(command, arguments_, { ...options, stdio: "inherit" }, spawnProcess);

  child.once("error", reject);
  child.once("close", (code, signal) => {
    if (code === 0 && signal === null) {
      resolve();
      return;
    }

    const error = new Error(`Command failed: ${command} ${arguments_.join(" ")}`);
    error.code = code;
    error.signal = signal;
    reject(error);
  });
});
