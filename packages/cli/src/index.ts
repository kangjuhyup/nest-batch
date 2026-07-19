import { DefaultBatchRunner } from "@nest-batch/core";
import type {
  BatchRunner,
  DatabaseBatchStorage,
  JobDefinition,
  JobExecution,
  JobParameters,
  StepExecution
} from "@nest-batch/core";

export interface CliResult {
  readonly exitCode: number;
  readonly output: string;
}

export interface CliContext {
  readonly storage?: DatabaseBatchStorage;
  readonly jobs?: readonly JobDefinition[];
  readonly runner?: BatchRunner;
}

const commands = new Set(["run", "status", "retry", "list"]);

export const runCli = async (
  args: readonly string[],
  context: CliContext = {}
): Promise<CliResult> => {
  const [command, ...rawOptions] = args;

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

  try {
    const options = parseFlags(rawOptions);

    if (command === "list") {
      return listJobs(context);
    }

    if (command === "status") {
      return await printStatus(options, context);
    }

    return await runJob(command, options, context);
  } catch (error) {
    return {
      exitCode: 1,
      output: error instanceof Error ? error.message : String(error)
    };
  }
};

interface ParsedFlags {
  readonly values: ReadonlyMap<string, string | true>;
}

const parseFlags = (args: readonly string[]): ParsedFlags => {
  const values = new Map<string, string | true>();

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (!current?.startsWith("--")) {
      throw new Error(`Unexpected positional argument "${current ?? ""}".`);
    }

    const withoutPrefix = current.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    const key = equalsIndex >= 0 ? withoutPrefix.slice(0, equalsIndex) : withoutPrefix;

    if (key.length === 0) {
      throw new Error("CLI option name is required.");
    }

    if (equalsIndex >= 0) {
      values.set(key, withoutPrefix.slice(equalsIndex + 1));
      continue;
    }

    const next = args[index + 1];

    if (next !== undefined && !next.startsWith("--")) {
      values.set(key, next);
      index += 1;
      continue;
    }

    values.set(key, true);
  }

  return { values };
};

const listJobs = (context: CliContext): CliResult => {
  return {
    exitCode: 0,
    output: JSON.stringify(
      {
        jobs: [...toJobRegistry(context.jobs).keys()].sort()
      },
      null,
      2
    )
  };
};

const printStatus = async (options: ParsedFlags, context: CliContext): Promise<CliResult> => {
  const storage = requireStorage(context);
  const executionId = requireStringOption(options, "execution-id");
  const execution = await storage.repository.findById(executionId);

  if (!execution) {
    return {
      exitCode: 1,
      output: `Execution "${executionId}" was not found.`
    };
  }

  const steps = await storage.repository.findStepExecutions(execution.id);

  return {
    exitCode: 0,
    output: stringifyExecution("status", execution, steps)
  };
};

const runJob = async (
  command: string,
  options: ParsedFlags,
  context: CliContext
): Promise<CliResult> => {
  const storage = requireStorage(context);
  const jobName = requireStringOption(options, "job");
  const job = toJobRegistry(context.jobs).get(jobName);

  if (!job) {
    throw new Error(`Job "${jobName}" is not registered.`);
  }

  const parameters = parseJobParameters(job, getStringOption(options, "parameters"));
  const runner = context.runner ?? new DefaultBatchRunner(storage);
  const execution = await runner.run(job, parameters, {
    executionId: getStringOption(options, "execution-id"),
    ownerId: getStringOption(options, "owner-id"),
    lockTtlMs: getNumberOption(options, "lock-ttl-ms"),
    restart: command === "retry"
  });
  const steps = await storage.repository.findStepExecutions(execution.id);

  return {
    exitCode: execution.status === "completed" ? 0 : 1,
    output: stringifyExecution(command, execution, steps)
  };
};

const requireStorage = (context: CliContext): DatabaseBatchStorage => {
  if (!context.storage) {
    throw new Error("DatabaseBatchStorage is required for this command.");
  }

  return context.storage;
};

const toJobRegistry = (
  jobs: readonly JobDefinition[] | undefined
): ReadonlyMap<string, JobDefinition> => {
  const registry = new Map<string, JobDefinition>();

  for (const job of jobs ?? []) {
    registry.set(job.name, job);
  }

  return registry;
};

const requireStringOption = (options: ParsedFlags, name: string): string => {
  const value = getStringOption(options, name);

  if (value === undefined || value.trim().length === 0) {
    throw new Error(`--${name} is required.`);
  }

  return value;
};

const getStringOption = (options: ParsedFlags, name: string): string | undefined => {
  const value = options.values.get(name);

  if (value === true) {
    throw new Error(`--${name} requires a value.`);
  }

  return value;
};

const getNumberOption = (options: ParsedFlags, name: string): number | undefined => {
  const value = getStringOption(options, name);

  if (value === undefined) {
    return undefined;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(`--${name} must be a finite number.`);
  }

  return number;
};

const parseJobParameters = (
  job: JobDefinition,
  rawParameters: string | undefined
): JobParameters => {
  const parsed = rawParameters === undefined ? {} : parseJsonObject(rawParameters, "--parameters");

  return job.parametersSchema ? job.parametersSchema(parsed) : parsed;
};

const parseJsonObject = (value: string, optionName: string): JobParameters => {
  const parsed = JSON.parse(value) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`${optionName} must be a JSON object.`);
  }

  return parsed;
};

const isRecord = (value: unknown): value is JobParameters => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const stringifyExecution = (
  command: string,
  execution: JobExecution,
  steps: readonly StepExecution[]
): string => {
  return JSON.stringify(
    {
      command,
      execution: serializeJobExecution(execution),
      steps: steps.map(serializeStepExecution)
    },
    null,
    2
  );
};

const serializeJobExecution = (execution: JobExecution): Record<string, unknown> => ({
  id: execution.id,
  instanceId: execution.instanceId,
  jobName: execution.jobName,
  status: execution.status,
  parameters: execution.parameters,
  createdAt: execution.createdAt.toISOString(),
  startedAt: execution.startedAt?.toISOString(),
  endedAt: execution.endedAt?.toISOString(),
  failureReason: execution.failureReason
});

const serializeStepExecution = (execution: StepExecution): Record<string, unknown> => ({
  id: execution.id,
  jobExecutionId: execution.jobExecutionId,
  stepName: execution.stepName,
  status: execution.status,
  readCount: execution.readCount,
  writeCount: execution.writeCount,
  skipCount: execution.skipCount,
  retryCount: execution.retryCount,
  createdAt: execution.createdAt.toISOString(),
  startedAt: execution.startedAt?.toISOString(),
  endedAt: execution.endedAt?.toISOString(),
  failureReason: execution.failureReason
});
