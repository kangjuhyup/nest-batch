export interface CliResult {
  readonly exitCode: number;
  readonly output: string;
}

const commands = new Set(["run", "status", "retry", "list"]);

export const runCli = async (args: readonly string[]): Promise<CliResult> => {
  const [command] = args;

  if (command === undefined || command === "--help" || command === "-h") {
    return {
      exitCode: 0,
      output: "nest-batch commands: run, status, retry, list"
    };
  }

  if (!commands.has(command)) {
    return {
      exitCode: 1,
      output: `Unknown command "${command}".`
    };
  }

  return {
    exitCode: 0,
    output: `Command "${command}" is scaffolded but not implemented yet.`
  };
};
