import { DefaultBatchRunner } from "@nest-batch/core";
import type {
  BatchRunner,
  DatabaseBatchStorage,
  JobDefinition,
  JobExecution,
  JobParameters,
  StepExecution
} from "@nest-batch/core";
import { WorkerLoop } from "@nest-batch/queue-core";
import type { WorkHandler, WorkQueue, WorkUnit } from "@nest-batch/queue-core";
import {
  SchedulerLoop,
  createQueueScheduleDispatcher,
  createRunnerScheduleDispatcher
} from "@nest-batch/scheduler-core";
import type {
  ScheduleDefinition,
  ScheduleDispatcher,
  ScheduleOccurrence,
  ScheduleStore
} from "@nest-batch/scheduler-core";

export interface CliResult {
  readonly exitCode: number;
  readonly output: string;
}

export interface CliContext {
  readonly storage?: DatabaseBatchStorage;
  readonly jobs?: readonly JobDefinition[];
  readonly runner?: BatchRunner;
  readonly queue?: WorkQueue;
  readonly workerHandler?: WorkHandler;
  readonly workerLoop?: WorkerLoop;
  readonly schedules?: readonly ScheduleDefinition[];
  readonly scheduleStore?: ScheduleStore;
  readonly schedulerDispatcher?: ScheduleDispatcher;
  readonly schedulerLoop?: SchedulerLoop;
  readonly signal?: AbortSignal;
}

const commands = new Set(["run", "status", "retry", "list", "worker", "schedule"]);

export const runCli = async (
  args: readonly string[],
  context: CliContext = {}
): Promise<CliResult> => {
  const [command, ...rawOptions] = args;

  if (command === undefined || command === "--help" || command === "-h") {
    return {
      exitCode: 0,
      output: "nest-batch commands: run, status, retry, list, worker, schedule"
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

    if (command === "worker") {
      return await runWorker(options, context);
    }

    if (command === "schedule") {
      return await runScheduler(options, context);
    }

    return await runJob(command, options, context);
  } catch (error) {
    return {
      exitCode: 1,
      output: error instanceof Error ? error.message : String(error)
    };
  }
};

const runWorker = async (options: ParsedFlags, context: CliContext): Promise<CliResult> => {
  const once = getBooleanFlag(options, "once");
  const workerId = getStringOption(options, "worker-id") ?? "nest-batch-cli-worker";
  const loop =
    context.workerLoop ??
    new WorkerLoop({
      queue: requireQueue(context),
      workerId,
      pollIntervalMs: getNumberOption(options, "poll-interval-ms") ?? 1_000,
      handler: context.workerHandler ?? createDefaultWorkerHandler(context)
    });

  if (once) {
    const handled = await loop.runOnce({ signal: context.signal });

    return {
      exitCode: 0,
      output: stringifyWorkerResult(workerId, handled)
    };
  }

  await loop.runUntilStopped({ signal: context.signal });

  return {
    exitCode: 0,
    output: stringifyWorkerResult(workerId, false)
  };
};

const runScheduler = async (options: ParsedFlags, context: CliContext): Promise<CliResult> => {
  if (getBooleanFlag(options, "list")) {
    return listSchedules(context);
  }

  if (getBooleanFlag(options, "status")) {
    return await printScheduleStatus(options, context);
  }

  if (getBooleanFlag(options, "failed")) {
    return await listFailedScheduleOccurrences(options, context);
  }

  const once = getBooleanFlag(options, "once");
  const schedulerId = getStringOption(options, "scheduler-id") ?? "nest-batch-cli-scheduler";
  const loop = context.schedulerLoop ?? createSchedulerLoop(options, context, schedulerId);

  if (once) {
    const result = await loop.tick({ signal: context.signal });

    return {
      exitCode: result.failedOccurrences === 0 ? 0 : 1,
      output: stringifyScheduleResult(schedulerId, result)
    };
  }

  await loop.runUntilStopped({ signal: context.signal });

  return {
    exitCode: 0,
    output: stringifyScheduleResult(schedulerId, {
      scannedSchedules: 0,
      claimedOccurrences: 0,
      dispatchedOccurrences: 0,
      failedOccurrences: 0
    })
  };
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

const listSchedules = (context: CliContext): CliResult => {
  return {
    exitCode: 0,
    output: JSON.stringify(
      {
        command: "schedule",
        schedules: [...toScheduleRegistry(context.schedules).values()]
          .map(serializeScheduleDefinition)
          .sort((left, right) => String(left.name).localeCompare(String(right.name)))
      },
      null,
      2
    )
  };
};

const printScheduleStatus = async (
  options: ParsedFlags,
  context: CliContext
): Promise<CliResult> => {
  const scheduleName = requireScheduleNameOption(options, "status");
  const schedule = requireConfiguredSchedule(context, scheduleName);
  const latestOccurrence = await requireScheduleStore(context).findLatestOccurrence(scheduleName);

  return {
    exitCode: 0,
    output: JSON.stringify(
      {
        command: "schedule",
        schedule: serializeScheduleDefinition(schedule),
        latestOccurrence: latestOccurrence ? serializeScheduleOccurrence(latestOccurrence) : null
      },
      null,
      2
    )
  };
};

const listFailedScheduleOccurrences = async (
  options: ParsedFlags,
  context: CliContext
): Promise<CliResult> => {
  const scheduleName = getStringOption(options, "schedule");
  const limit = getPositiveIntegerOption(options, "limit");
  const store = requireScheduleStore(context);
  const query: {
    scheduleName?: string;
    status: ScheduleOccurrence["status"];
    limit?: number;
  } = { status: "failed" };

  if (scheduleName !== undefined) {
    query.scheduleName = scheduleName;
  }

  if (limit !== undefined) {
    query.limit = limit;
  }

  const occurrences = await store.listOccurrences(query);

  return {
    exitCode: 0,
    output: JSON.stringify(
      {
        command: "schedule",
        ...query,
        occurrences: occurrences.map(serializeScheduleOccurrence)
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

const requireQueue = (context: CliContext): WorkQueue => {
  if (!context.queue) {
    throw new Error("WorkQueue is required for the worker command.");
  }

  return context.queue;
};

const requireScheduleStore = (context: CliContext): ScheduleStore => {
  if (!context.scheduleStore) {
    throw new Error("ScheduleStore is required for the schedule command.");
  }

  return context.scheduleStore;
};

const createSchedulerLoop = (
  options: ParsedFlags,
  context: CliContext,
  ownerId: string
): SchedulerLoop => {
  const storage = requireStorage(context);
  const store = requireScheduleStore(context);
  const dispatcher =
    context.schedulerDispatcher ??
    (context.queue
      ? createQueueScheduleDispatcher({ queue: context.queue })
      : createRunnerScheduleDispatcher({
          jobs: context.jobs ?? [],
          runner: context.runner ?? new DefaultBatchRunner(storage),
          ownerId
        }));

  return new SchedulerLoop({
    schedules: context.schedules ?? [],
    store,
    lockManager: storage.lockManager,
    dispatcher,
    ownerId,
    lockTtlMs: getNumberOption(options, "lock-ttl-ms"),
    claimTtlMs: getNumberOption(options, "claim-ttl-ms"),
    pollIntervalMs: getNumberOption(options, "poll-interval-ms")
  });
};

const createDefaultWorkerHandler = (context: CliContext): WorkHandler => {
  const storage = requireStorage(context);

  return async (work) => {
    const payload = parseWorkerJobPayload(work);
    const job = toJobRegistry(context.jobs).get(payload.jobName);

    if (!job) {
      throw new Error(`Job "${payload.jobName}" is not registered.`);
    }

    const runner = context.runner ?? new DefaultBatchRunner(storage);
    await runner.run(job, payload.parameters, {
      executionId: payload.executionId,
      ownerId: payload.ownerId,
      lockTtlMs: payload.lockTtlMs,
      restart: payload.restart
    });
  };
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

const toScheduleRegistry = (
  schedules: readonly ScheduleDefinition[] | undefined
): ReadonlyMap<string, ScheduleDefinition> => {
  const registry = new Map<string, ScheduleDefinition>();

  for (const schedule of schedules ?? []) {
    registry.set(schedule.name, schedule);
  }

  return registry;
};

const requireConfiguredSchedule = (
  context: CliContext,
  scheduleName: string
): ScheduleDefinition => {
  const schedule = toScheduleRegistry(context.schedules).get(scheduleName);

  if (!schedule) {
    throw new Error(`Schedule "${scheduleName}" is not configured.`);
  }

  return schedule;
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

const requireScheduleNameOption = (options: ParsedFlags, command: string): string => {
  const value = getStringOption(options, "schedule");

  if (value === undefined || value.trim().length === 0) {
    throw new Error(`--schedule is required for schedule --${command}.`);
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

const getPositiveIntegerOption = (options: ParsedFlags, name: string): number | undefined => {
  const value = getStringOption(options, name);

  if (value === undefined) {
    return undefined;
  }

  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`--${name} must be a positive integer.`);
  }

  return number;
};

const getBooleanFlag = (options: ParsedFlags, name: string): boolean => {
  const value = options.values.get(name);

  if (value === undefined) {
    return false;
  }

  if (value === true) {
    return true;
  }

  throw new Error(`--${name} does not take a value.`);
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

interface WorkerJobPayload {
  readonly jobName: string;
  readonly parameters: JobParameters;
  readonly executionId?: string;
  readonly ownerId?: string;
  readonly lockTtlMs?: number;
  readonly restart?: boolean;
}

const parseWorkerJobPayload = (work: WorkUnit): WorkerJobPayload => {
  const payload = work.payload;

  if (!isRecord(payload)) {
    throw new Error(`Worker work "${work.id}" payload must be a JSON object.`);
  }

  const jobName = payload.jobName;

  if (typeof jobName !== "string" || jobName.length === 0) {
    throw new Error(`Worker work "${work.id}" payload requires jobName.`);
  }

  return {
    jobName,
    parameters: parseOptionalWorkerParameters(payload.parameters),
    executionId: parseOptionalWorkerString(payload.executionId, "executionId"),
    ownerId: parseOptionalWorkerString(payload.ownerId, "ownerId"),
    lockTtlMs: parseOptionalWorkerNumber(payload.lockTtlMs, "lockTtlMs"),
    restart: parseOptionalWorkerBoolean(payload.restart, "restart")
  };
};

const parseOptionalWorkerParameters = (value: unknown): JobParameters => {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new Error("Worker work payload parameters must be a JSON object.");
  }

  return value;
};

const parseOptionalWorkerString = (value: unknown, fieldName: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Worker work payload ${fieldName} must be a string.`);
  }

  return value;
};

const parseOptionalWorkerNumber = (value: unknown, fieldName: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Worker work payload ${fieldName} must be a finite number.`);
  }

  return value;
};

const parseOptionalWorkerBoolean = (value: unknown, fieldName: string): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Worker work payload ${fieldName} must be a boolean.`);
  }

  return value;
};

const stringifyWorkerResult = (workerId: string, handled: boolean): string => {
  return JSON.stringify(
    {
      command: "worker",
      workerId,
      handled
    },
    null,
    2
  );
};

const stringifyScheduleResult = (
  schedulerId: string,
  result: {
    readonly scannedSchedules: number;
    readonly claimedOccurrences: number;
    readonly dispatchedOccurrences: number;
    readonly failedOccurrences: number;
  }
): string => {
  return JSON.stringify(
    {
      command: "schedule",
      schedulerId,
      result
    },
    null,
    2
  );
};

const serializeScheduleDefinition = (schedule: ScheduleDefinition): Record<string, unknown> => {
  const serialized: Record<string, unknown> = {
    name: schedule.name,
    jobName: schedule.jobName,
    hasParameters: schedule.parameters !== undefined
  };

  if (schedule.misfirePolicy !== undefined) {
    serialized.misfirePolicy = schedule.misfirePolicy;
  }

  if (schedule.maxCatchUpOccurrences !== undefined) {
    serialized.maxCatchUpOccurrences = schedule.maxCatchUpOccurrences;
  }

  if (schedule.runOptions !== undefined) {
    serialized.runOptions = schedule.runOptions;
  }

  return serialized;
};

const serializeScheduleOccurrence = (occurrence: ScheduleOccurrence): Record<string, unknown> => ({
  scheduleName: occurrence.scheduleName,
  occurrenceId: occurrence.occurrenceId,
  scheduledAt: occurrence.scheduledAt.toISOString(),
  status: occurrence.status,
  ownerId: occurrence.ownerId,
  claimedAt: occurrence.claimedAt?.toISOString(),
  claimExpiresAt: occurrence.claimExpiresAt?.toISOString(),
  dispatchedAt: occurrence.dispatchedAt?.toISOString(),
  failedAt: occurrence.failedAt?.toISOString(),
  failureReason: occurrence.failureReason
});

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
