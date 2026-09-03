# nest-batch

`nest-batch` is a Node-native batch framework project for the NestJS ecosystem.

This repository is currently in early implementation stage. The package
boundaries and public entry points are present, and Postgres/MySQL/MariaDB
persistence adapters provide initial driver-backed repository, checkpoint, and
lock storage. `DefaultBatchRunner` provides the first durable execution slice
for sequential tasklet/chunk steps with `JobInstance` identity and duplicate
active execution prevention. It can restart from the latest failed execution for
the same `JobInstance`, skip steps that already completed, and resume the failed
step from its checkpoint. Chunk steps support processor/writer retry policy,
processor skip policy, and `BatchObserver` lifecycle events. The CLI can run,
retry, inspect, and list jobs when an application supplies storage and a job
registry. `@nest-batch/nest` can discover decorated job and batch component
providers, expose a `BATCH_RUNNER` provider, and run discovered jobs through
`NestBatchRunner`. Distributed worker contracts, the BullMQ queue adapter
boundary, continuous polling workers, and a first production scheduling slice
are available.

## Packages

- `@nest-batch/core`: framework-independent job and step contracts.
- `@nest-batch/nest`: NestJS module and decorator integration.
- `@nest-batch/inmemory`: non-durable in-memory repository, lock, and checkpoint storage for tests and examples.
- `@nest-batch/postgres`: Postgres driver-backed repository, lock, and checkpoint storage.
- `@nest-batch/mysql`: MySQL driver-backed repository, lock, and checkpoint storage.
- `@nest-batch/mariadb`: MariaDB driver-backed repository, lock, and checkpoint storage.
- `@nest-batch/queue-core`: queue-neutral `WorkQueue` contract and worker loop.
- `@nest-batch/queue-bullmq`: BullMQ-compatible `WorkQueue` adapter boundary.
- `@nest-batch/polling-core`: framework-independent continuous polling task loop.
- `@nest-batch/scheduler-core`: framework-independent schedule definitions, trigger evaluation, occurrence claim orchestration, and dispatch helpers.
- `@nest-batch/scheduler-calendar`: dependency-light UTC daily, weekly, and monthly trigger helpers.
- `@nest-batch/cli`: operational CLI boundary.

## Distributed Workers

`@nest-batch/queue-core` defines a pull-based `WorkQueue` contract and
`WorkerLoop`. Queue adapters deliver work; repository state remains the source
of truth for job, step, checkpoint, and partition status. Distributed execution
is at-least-once, so writers and external side effects should be idempotent.

`@nest-batch/queue-bullmq` maps each `WorkUnit.id` to a stable BullMQ job id and
disables BullMQ retry by default (`attempts: 1`) so retry policy stays owned by
the batch runtime. Applications can wrap real BullMQ `Queue`/worker instances
and pass them into `BullMqWorkQueue`. When a work id contains `:`, the adapter
encodes only the BullMQ custom job id; the `WorkUnit.id` stored in the payload
remains unchanged.

## Continuous Polling Workers

`@nest-batch/polling-core` provides a framework-independent loop for long-lived
polling tasks such as Transactional Outbox dispatchers. It does not create
`JobExecution`, `StepExecution`, checkpoint rows, or scheduler occurrences per
polling tick. The task owns store-specific claim, lease, retry, dead-letter, and
ordering semantics; nest-batch owns only worker lifecycle, idle sleep, system
error backoff, observer events, and graceful shutdown.

```ts
import { ContinuousPollingLoop } from "@nest-batch/polling-core";

const loop = new ContinuousPollingLoop({
  workerId: "vote-outbox-worker-1",
  pollIntervalMs: 1_000,
  task: async ({ workerId, signal }) => {
    const { claimedCount } = await integrationEventOutboxDispatcher.dispatchBatch({
      workerId,
      signal
    });

    return claimedCount > 0;
  }
});

await loop.runUntilStopped({ signal });
```

When `task` returns `true` or a positive processed count, the loop immediately
starts the next iteration to drain busy outbox work. When it returns `false`,
`0`, or `undefined`, the loop waits for `pollIntervalMs`. Unhandled task errors
are treated as worker/system errors and retried with bounded exponential
backoff and jitter; message-level failures and retry policy should stay inside
the outbox repository/dispatcher.

Nest polling integration can run without `DatabaseBatchStorage` through
`NestBatchPollingModule`. `autoStart` is opt-in per worker, so API and worker
process roles can share the same application module without starting polling in
the API role:

```ts
import { Module } from "@nestjs/common";
import { NestBatchPollingModule } from "@nest-batch/nest";

@Module({
  imports: [
    NestBatchPollingModule.forRootAsync({
      inject: [IntegrationEventOutboxDispatcher],
      useFactory: (outboxDispatcher: IntegrationEventOutboxDispatcher) => ({
        pollingWorkers: [
          {
            workerId: process.env.VOTE_OUTBOX_WORKER_ID ?? "vote-outbox-worker-1",
            pollIntervalMs: 1_000,
            autoStart: process.env.NEST_BATCH_PROCESS_ROLE === "vote-outbox-worker",
            task: async ({ workerId, signal }) => {
              const { claimedCount } = await outboxDispatcher.dispatchBatch({
                workerId,
                signal
              });

              return claimedCount > 0;
            }
          }
        ]
      })
    })
  ]
})
class AppModule {}
```

`NestBatchModule` still accepts `pollingWorkers` for compatibility when the same
process already needs batch job storage and `NestBatchRunner`. Polling-only
processes should import `NestBatchPollingModule` instead.

The polling loop intentionally does not acquire a global singleton worker lock.
For horizontally scaled outbox workers, use repository-level primitives such as
`FOR UPDATE SKIP LOCKED`, DB-clock leases, and lease-token compare-and-swap in
the task implementation. Pass the polling `AbortSignal` through dispatcher and
publisher layers. If the external publish client cannot observe `AbortSignal`,
wrap publish calls in a hard timeout owned by the task/dispatcher so shutdown
cannot wait forever on in-flight I/O.

## Production Scheduling

`@nest-batch/scheduler-core` evaluates code-defined schedules, claims durable
occurrences through a `ScheduleStore`, and dispatches them to either
`BatchRunner` or `WorkQueue`. Schedule definitions stay in application code; the
database stores occurrence state for duplicate-dispatch reduction and catch-up
decisions.

```ts
import { PostgresScheduleStore } from "@nest-batch/postgres";
import {
  SchedulerLoop,
  createIntervalTrigger,
  createQueueScheduleDispatcher,
  defineSchedule
} from "@nest-batch/scheduler-core";

const scheduleStore = new PostgresScheduleStore({
  connectionString: process.env.NEST_BATCH_POSTGRES_URL,
  schema: "batch"
});
await scheduleStore.initialize();

const schedule = defineSchedule({
  name: "billing.daily",
  jobName: "billing",
  trigger: createIntervalTrigger({
    everyMs: 86_400_000,
    startAt: new Date("2026-01-01T00:00:00.000Z")
  }),
  parameters: ({ scheduledAt }) => ({
    billingDate: scheduledAt.toISOString().slice(0, 10)
  })
});

const scheduler = new SchedulerLoop({
  schedules: [schedule],
  store: scheduleStore,
  lockManager: storage.lockManager,
  dispatcher: createQueueScheduleDispatcher({ queue }),
  ownerId: "scheduler-1"
});

await scheduler.tick();
```

Scheduler dispatch is at-least-once. A scheduler crash, queue redelivery, or
worker crash can dispatch the same occurrence again, so writers and external
side effects should use an idempotency key or a natural unique constraint.
The scheduler uses the latest terminal occurrence (`dispatched` or `failed`) as
the trigger boundary, so a stale `claimed` occurrence can be reclaimed after its
claim TTL instead of being skipped forever.

For UTC calendar schedules, keep calendar math outside `scheduler-core` and use
the optional helper package:

```ts
import { createUtcDailyTrigger } from "@nest-batch/scheduler-calendar";

const trigger = createUtcDailyTrigger({
  startAt: new Date("2026-01-01T00:00:00.000Z"),
  time: { hour: 9, minute: 30 }
});
```

```bash
nest-batch schedule --once
nest-batch schedule --poll-interval-ms 1000 --scheduler-id scheduler-1
nest-batch schedule --list
nest-batch schedule --status --schedule billing.daily
nest-batch schedule --failed --schedule billing.daily --limit 10
```

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Test Services

The repository uses Docker Compose for local database and queue integration
tests. A single `compose.yaml` starts Postgres, MySQL, MariaDB, and Redis with
separate host ports so they can run together on one machine.

```bash
docker compose up -d postgres mysql mariadb redis
docker compose ps
docker compose down
```

Default adapter test connection values:

```bash
NEST_BATCH_POSTGRES_URL=postgresql://nest_batch:nest_batch@localhost:15432/nest_batch
NEST_BATCH_POSTGRES_SCHEMA=batch
NEST_BATCH_MYSQL_URL=mysql://nest_batch:nest_batch@localhost:13306/nest_batch
NEST_BATCH_MYSQL_DATABASE=nest_batch
NEST_BATCH_MARIADB_URL=mariadb://nest_batch:nest_batch@localhost:13307/nest_batch
NEST_BATCH_MARIADB_DATABASE=nest_batch
NEST_BATCH_E2E_REDIS_URL=redis://127.0.0.1:16379
```

From another Compose service, use `postgres:5432`, `mysql:3306`, and
`mariadb:3306`, and `redis:6379` instead of the localhost ports above. A custom `Dockerfile` is
not needed because the test environment only depends on official service
images.

Use `docker compose down -v` when you need to reset all database state.

### E2E Tests

E2E tests are excluded from the default `pnpm test` command. Start the needed
database or queue service first, then run the e2e script explicitly.

```bash
docker compose up -d postgres mysql mariadb redis
pnpm test:e2e
pnpm test:e2e:adapters
pnpm test:e2e:system
pnpm test:e2e:examples
pnpm test:e2e:postgres
pnpm test:e2e:redis
```

E2E tests are organized by ownership boundary:

- `packages/*/test/*.e2e.test.ts`: package-local adapter e2e tests.
- `e2e/*.e2e.test.ts`: system e2e tests that cross package boundaries.
- `examples/*/test/*.e2e.test.ts`: example app e2e tests.

Postgres e2e tests use a disposable schema named `batch_e2e` by default. To
override it, use a schema name that starts with `batch_e2e`:

```bash
NEST_BATCH_E2E_POSTGRES_URL=postgresql://nest_batch:nest_batch@127.0.0.1:15432/nest_batch \
NEST_BATCH_E2E_POSTGRES_SCHEMA=batch_e2e_local \
pnpm test:e2e:postgres
```

System e2e tests include a full runtime flow across in-memory, Postgres, MySQL,
and MariaDB storage. Postgres system tests use disposable schemas named
`batch_system_e2e` and `batch_full_e2e` by default. Custom system schemas must
start with the matching prefix. MySQL and MariaDB full-flow tests drop only
tables whose prefix starts with `nb_full_e2e`; override the defaults with
`NEST_BATCH_FULL_E2E_MYSQL_*` and `NEST_BATCH_FULL_E2E_MARIADB_*` environment
variables when needed.

### Performance Tests

Performance tests are also excluded from the default `pnpm test` command. They
cover repeatable core runtime baselines and adapter micro-benchmarks without
changing the normal test path.

```bash
pnpm test:perf
```

The core runtime baseline does not require Docker. It measures chunk throughput,
checkpoint overhead, and retry/skip overhead without asserting
machine-specific throughput numbers. Recorded baseline runs are kept in
[`docs/performance.md`](docs/performance.md). Tune local runs with:

```bash
NEST_BATCH_PERF_ITEMS=20000 \
NEST_BATCH_PERF_CHUNK_SIZE=250 \
pnpm test:perf -- packages/core/test/performance-baseline.perf.test.ts
```

Adapter performance tests may require external services. For Postgres:

```bash
docker compose up -d postgres
pnpm test:perf:postgres
```

Postgres performance tests use a disposable schema named `batch_perf` by
default. The result table reports operations, total duration, average latency,
and operations per second. Tune local runs with these environment variables:

```bash
NEST_BATCH_PERF_POSTGRES_URL=postgresql://nest_batch:nest_batch@127.0.0.1:15432/nest_batch \
NEST_BATCH_PERF_POSTGRES_SCHEMA=batch_perf_local \
NEST_BATCH_PERF_ITERATIONS=1000 \
NEST_BATCH_PERF_WARMUP_ITERATIONS=100 \
pnpm test:perf:postgres
```

Custom performance schemas must start with `batch_perf` so cleanup cannot drop
shared schemas. Future lock contention and stale-lock load tests should use the
same `*.perf.test.ts` pattern and `test:perf` script.

## In-Memory Storage

`@nest-batch/inmemory` provides non-durable implementations of `JobRepository`,
`CheckpointStore`, and `LockManager`. State lives only in process memory, so do
not use it for restart, multi-process worker, or production durability
validation. It is intended for example e2e tests, runner unit tests, and fast
local smoke tests where a database fixture is not the behavior under test.

```ts
import { InMemoryBatchStorage } from "@nest-batch/inmemory";

const storage = new InMemoryBatchStorage();
```

## SQL Storage

Postgres, MySQL, MariaDB adapter는 driver pool을 통해 `JobRepository`,
`CheckpointStore`, `LockManager`를 제공합니다. `JobRepository`는 job
name과 parameters hash로 식별되는 `JobInstance`, 실제 실행 시도인
`JobExecution`, 그리고 `StepExecution` 상태를 저장합니다. 같은 instance의
active execution과 마지막 failed execution을 조회할 수 있어 중복 실행 방지와
restart 준비 흐름의 source of truth가 됩니다. runner가 새 실행을 만들 때는
`createExecutionAttempt()`를 사용하며, SQL adapter는 가능한 경우 driver
transaction 안에서 instance 생성, active execution 확인, execution 생성을 함께
처리합니다. `initialize()`는 필요한 schema와 table을 idempotent하게 준비합니다.

```ts
import { PostgresBatchStorage } from "@nest-batch/postgres";
import { MySqlBatchStorage } from "@nest-batch/mysql";
import { createJobInstanceId, hashJobParameters } from "@nest-batch/core";

const postgresStorage = new PostgresBatchStorage({
  connectionString: process.env.NEST_BATCH_POSTGRES_URL,
  schema: "batch"
});

const mysqlStorage = new MySqlBatchStorage({
  connectionString: process.env.NEST_BATCH_MYSQL_URL,
  database: "nest_batch"
});

await postgresStorage.initialize();
const parameters = { tenant: "acme" };
const parametersHash = hashJobParameters(parameters);
const instance = await postgresStorage.repository.createJobInstance({
  id: createJobInstanceId("daily-user-import", parametersHash),
  jobName: "daily-user-import",
  parametersHash,
  parameters,
  createdAt: new Date()
});
await postgresStorage.repository.create({
  id: "execution-1",
  instanceId: instance.id,
  jobName: "daily-user-import",
  status: "created",
  parameters,
  createdAt: new Date()
});
await postgresStorage.close();
```

## Default Runner

`DefaultBatchRunner`는 `DatabaseBatchStorage`에만 의존합니다. 실행 시 job
name과 parameters를 안정적으로 hash해 `JobInstance`를 찾거나 만들고,
`job-instance:{instanceId}` lock으로 같은 instance의 active execution을
거부합니다. 이후 job/step 상태 전이를 repository에 저장합니다. chunk step은
writer가 성공한 뒤 step-level `checkpoint()` callback이 있으면 그 값을, 없으면
`ReaderSession.checkpoint()` 값을 `CheckpointStore`에 저장합니다. `restart:
true`를 넘기면 같은 instance의 최신 failed execution에서 checkpoint를 읽고,
이전 execution에서 이미 completed 상태였던 step은 새 execution에 completed
기록만 남긴 뒤 다시 실행하지 않습니다. 재시작된 step은 새 execution id로
checkpoint를 다시 저장합니다.

```ts
import { DefaultBatchRunner, defineJob, defineStep } from "@nest-batch/core";
import { PostgresBatchStorage } from "@nest-batch/postgres";

const storage = new PostgresBatchStorage({
  connectionString: process.env.NEST_BATCH_POSTGRES_URL,
  schema: "batch"
});
const runner = new DefaultBatchRunner(storage);
const job = defineJob({
  name: "daily-user-import",
  steps: [
    defineStep({
      name: "load-users",
      execute() {
        return "loaded";
      }
    })
  ]
});

await storage.initialize();
const execution = await runner.run(job, { tenant: "acme" });
await storage.close();
```

같은 parameters의 최신 execution이 failed 상태일 때는 다음처럼 checkpoint부터
이어 실행할 수 있습니다.

```ts
await runner.run(job, { tenant: "acme" }, { restart: true });
```

## Runtime Context and Durable Context

Tasklet and chunk callbacks receive a read-only runtime context for the current
execution. It includes `jobName`, `jobExecutionId`, `stepName`,
`stepExecutionId`, `parameters`, `signal`, `checkpoint`, `restart`, and
`restartFromExecutionId` when the run is a restart.

```ts
const loadUsers = defineStep({
  name: "load-users",
  execute({ parameters, jobExecutionId, stepName, restart }) {
    return {
      tenant: String(parameters.tenant),
      jobExecutionId,
      stepName,
      restart
    };
  }
});

const importUsers = defineChunkStep({
  name: "import-users",
  chunkSize: 100,
  reader: {
    open({ parameters, signal, checkpoint }) {
      const tenant = String(parameters.tenant);

      return {
        async *[Symbol.asyncIterator]() {
          signal.throwIfAborted();
          yield { id: `${tenant}-user-1`, checkpoint };
        }
      };
    }
  },
  processor: {
    process(user, { parameters }) {
      return { ...user, tenant: String(parameters.tenant) };
    }
  },
  writer: {
    async write(users, { jobExecutionId, stepName }) {
      await saveUsers(users, { jobExecutionId, stepName });
    }
  }
});
```

Checkpoint and durable execution context are separate concepts. A checkpoint is
the safe reader cursor or chunk boundary that `DefaultBatchRunner` reads
automatically when `restart: true` is used. Durable execution context is JSON
metadata stored through `storage.executionContextStore`, keyed by
`executionId`, `scope`, and `name`; use it for metadata that should be shared or
restored separately from the reader cursor.

On restart, the runner reads the failed execution checkpoint, exposes
`restart: true` and `restartFromExecutionId` in callback context, and writes new
checkpoints under the new execution id. Execution context rows remain scoped to
their execution id, so copy or merge them to the new execution only at safe
boundaries. Neither checkpoint nor execution context makes external writes
exactly-once; writers should use idempotency keys or natural unique constraints.

Runner lifecycle과 chunk 처리 이벤트는 `BatchObserver`로 받을 수 있습니다.

```ts
const runner = new DefaultBatchRunner(storage, {
  observer: {
    onBatchEvent(event) {
      console.log(event.type);
    }
  }
});
```

`event.type`은 `BatchEventType`이며, 전체 값은 `BATCH_EVENT_TYPES`로 export됩니다.
현재 값은 `job.started`, `job.completed`, `job.failed`, `job.cancelled`,
`step.started`, `step.completed`, `step.failed`, `step.cancelled`,
`chunk.written`, `retry`, `item.skipped`입니다.

Job definition에 listener를 체이닝해서 특정 event만 처리할 수도 있습니다.
listener는 `BatchObserver`와 같은 event payload를 받고, listener 내부 오류는 batch
실행 상태를 바꾸지 않습니다.

```ts
const job = defineJob({
  name: "daily-user-import",
  steps: [importUsers]
})
  .onSuccess(({ execution }) => {
    console.log(`${execution.jobName} completed`);
  })
  .onFailure(({ execution }) => {
    console.error(`${execution.jobName} failed: ${execution.failureReason}`);
  })
  .onStepFailure(({ execution }) => {
    console.error(`${execution.stepName} failed`);
  })
  .onEvent("retry", ({ stepName, attempt }) => {
    console.warn(`${stepName} retry ${attempt}`);
  });
```

## Nest Integration

`NestBatchModule.forRoot()` wires `DatabaseBatchStorage`, repository,
checkpoint, lock, the default `BATCH_RUNNER`, `BatchContextAccessor`,
`NestBatchRegistry`, and `NestBatchRunner`. On application bootstrap,
`NestBatchRegistry` discovers providers decorated with `@BatchJob`,
`@BatchStep`, `@BatchReader`, `@BatchProcessor`, and `@BatchWriter`.

```ts
import { Module } from "@nestjs/common";
import { NestBatchModule, BatchJob, BatchStep, NestBatchRunner } from "@nest-batch/nest";
import { defineStep } from "@nest-batch/core";

@BatchJob("daily-billing")
class BillingJob {
  @BatchStep("charge-accounts")
  chargeAccounts() {
    return defineStep({
      name: "charge-accounts",
      execute({ parameters, jobExecutionId }) {
        return `charged ${String(parameters.tenant)} in ${jobExecutionId}`;
      }
    });
  }
}

@Module({
  imports: [NestBatchModule.forRoot({ storage })],
  providers: [BillingJob]
})
class AppModule {}

await app.get(NestBatchRunner).run("daily-billing", { tenant: "acme" });
```

Nest providers can also inject `BatchContextAccessor` instead of threading the
runtime context through every method signature. The accessor is backed by
`AsyncLocalStorage`, so `getRequiredParameters()`, `getCheckpoint()`, and
`getRequiredSignal()` are available only while a batch callback is executing.

```ts
import { Injectable } from "@nestjs/common";
import { BatchContextAccessor } from "@nest-batch/nest";

@Injectable()
class BillingService {
  constructor(private readonly batchContext: BatchContextAccessor) {}

  chargeAccount() {
    const parameters = this.batchContext.getRequiredParameters();
    const checkpoint = this.batchContext.getCheckpoint<{ nextIndex: number }>();
    const signal = this.batchContext.getRequiredSignal();

    signal.throwIfAborted();
    return `charged ${String(parameters.tenant)} from ${checkpoint?.nextIndex ?? 0}`;
  }
}
```

If you need a custom runner, pass `batchRunner` to `forRoot()` or
`forRootAsync()`. `NestBatchRunner` uses the discovered job registry and applies
module-level default run options from `runner` before per-call options.

## Operational CLI

`@nest-batch/cli` exposes `runCli(args, { storage, jobs })` for application-owned
CLI bootstrapping. The package-level `nest-batch` binary cannot infer database
settings or job registration by itself yet, so production apps should wrap
`runCli` in their own bootstrap until config loading is added.

```ts
import { runCli } from "@nest-batch/cli";

const result = await runCli(
  [
    "run",
    "--job",
    "daily-user-import",
    "--parameters",
    '{"tenant":"acme"}'
  ],
  {
    storage,
    jobs: [job]
  }
);
```

Supported commands are `run`, `retry`, `status`, and `list`. `run`, `retry`, and
`status` require `DatabaseBatchStorage`; `run` and `retry` also require the job
to be present in the supplied registry. Command output is JSON for operational
commands.

## Core Example

```ts
import { defineJob, defineStep } from "@nest-batch/core";

const step = defineStep({
  name: "load-users",
  async execute({ signal }) {
    signal.throwIfAborted();
    return "loaded";
  }
});

export const job = defineJob({
  name: "daily-user-import",
  steps: [step]
});
```

## Chunk Step Example

`defineChunkStep`은 `Reader.open()`으로 execution-scoped `ReaderSession`을
열고 item을 streaming으로 읽은 뒤, optional processor를 거쳐 writer에 chunk
단위로 전달합니다. session은 optional `checkpoint()`와 `close()`를 가질 수
있습니다. `null`과 `undefined`는 유효한 output이며, 명시적 skip은 `skipItem()`으로
표현합니다. `retryPolicy`는 processor와 writer 실패에 적용되고, `skipPolicy`는
processor 실패 item을 건너뛰는 데만 적용됩니다. writer 실패 skip은 데이터 손실
의미가 커서 아직 지원하지 않습니다. `reader`, `processor`, `writer` callback은
같은 runtime context를 받아 `parameters`, execution id, `checkpoint`,
`AbortSignal`을 참조할 수 있습니다. Reader helper별 예제는
`docs/readers-kr.md`를 참고하세요.

```ts
import { defineChunkStep, skipItem } from "@nest-batch/core";
import type { ChunkReaderContext, Processor, Reader, ReaderSession, Writer } from "@nest-batch/core";

interface SourceUser {
  readonly id: string;
  readonly active: boolean;
}

interface ImportedUser {
  readonly id: string;
}

class UserReader implements Reader<SourceUser> {
  open({ signal }: ChunkReaderContext): ReaderSession<SourceUser> {
    return {
      async *[Symbol.asyncIterator]() {
        signal.throwIfAborted();
        yield { id: "user-1", active: true };
      }
    };
  }
}

class UserProcessor implements Processor<SourceUser, ImportedUser> {
  process(user: SourceUser) {
    if (!user.active) {
      return skipItem("inactive user");
    }

    if (user.id === "bad-user") {
      throw new Error("invalid user");
    }

    return { id: user.id };
  }
}

class UserWriter implements Writer<ImportedUser> {
  async write(users: readonly ImportedUser[]) {
    await saveUsers(users);
  }
}

export const importUsers = defineChunkStep({
  name: "import-users",
  chunkSize: 100,
  reader: new UserReader(),
  processor: new UserProcessor(),
  writer: new UserWriter(),
  retryPolicy: {
    canRetry({ attempt, phase }) {
      return phase === "write" && attempt < 3;
    }
  },
  skipPolicy: {
    canSkip({ error }) {
      return error instanceof Error && error.message === "invalid user";
    }
  }
});
```

See `docs/architecture.md` for package boundaries and runtime constraints.
