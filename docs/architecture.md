# Architecture

`nest-batch` is split by runtime responsibility.

## `@nest-batch/core`

Core contains framework-independent contracts and helpers. It must not import
NestJS, database clients, queue clients, or CLI frameworks.

Core owns:

- job and step definitions
- tasklet step and chunk step contracts
- reader session contracts and generic reader helpers
- job instance, execution identifiers, and status types
- repository and checkpoint contracts
- lock manager contracts
- default sequential batch runner
- batch lifecycle event observer contracts
- step execution counters
- runner-facing options

## `@nest-batch/scheduler-core`

Scheduler core owns code-defined schedule definitions, trigger evaluation,
occurrence claim orchestration, and dispatch to `BatchRunner` or `WorkQueue`.
It does not own job execution semantics, schedule discovery, database client
construction, queue implementation details, or NestJS lifecycle policy.

## `@nest-batch/scheduler-calendar`

Scheduler calendar contains optional UTC daily, weekly, and monthly trigger
helpers. It depends on `@nest-batch/scheduler-core` only through the
`ScheduleTrigger` contract; full cron expression parsing and timezone/DST
policy stay outside `scheduler-core`.

## `@nest-batch/polling-core`

Polling core owns continuous polling task contracts and the long-lived worker
loop for cases that should not create batch metadata per tick, such as
Transactional Outbox dispatch. It is framework-independent and does not import
NestJS, database clients, queue clients, scheduler contracts, or job/step
execution types. The loop passes `workerId` and `AbortSignal` to a task
`runOnce` callback, drains busy work without sleeping, waits only when idle,
and retries worker/system errors with bounded exponential backoff and jitter.

Polling core does not own outbox message state, retry/backoff policy, dead-letter
policy, lease tokens, aggregate ordering, or horizontal scaling coordination.
Those remain application or adapter responsibilities.

## `@nest-batch/nest`

Nest integration contains module APIs, decorators, discovery, and lifecycle
integration. It depends on `@nest-batch/core`; core does not depend on NestJS.
`NestBatchPollingModule` is a polling-only integration path. It depends on
`@nest-batch/polling-core`, does not require `DatabaseBatchStorage`, and does
not create repository, checkpoint, lock, schedule, or `BatchRunner` providers.
`NestBatchModule` can still accept `pollingWorkers` for compatibility when a
process already needs normal batch job integration.

## `@nest-batch/inmemory`

in-memory package는 core repository, checkpoint, lock contract의 비영속 구현을
담습니다. example-local test support가 아니라 adapter package가 소유하므로,
example app 안에 storage 동작을 넣지 않고 examples와 unit test가 같은 contract
구현을 공유할 수 있습니다.

## `@nest-batch/postgres`

The Postgres package contains driver-backed job and step execution repository,
lock management, and checkpoint storage. It uses `pg`, keeps Postgres
connection and schema options inside the adapter package, and exposes
`PostgresBatchStorage` for Nest integration or programmatic runtime wiring.

## `@nest-batch/mysql`

The MySQL package contains driver-backed job and step execution repository,
lock management, and checkpoint storage. It uses `mysql2/promise`, keeps MySQL
connection and database options inside the adapter package, and exposes
`MySqlBatchStorage` for Nest integration or programmatic runtime wiring.

## `@nest-batch/mariadb`

The MariaDB package contains driver-backed job and step execution repository,
lock management, and checkpoint storage. It uses the `mariadb` driver, keeps
MariaDB connection and database options inside the adapter package, and exposes
`MariaDbBatchStorage` for Nest integration or programmatic runtime wiring.

## `@nest-batch/cli`

The CLI package owns operational commands such as `run`, `status`, `retry`, and
`list`. It depends on core contracts and expects the application bootstrap to
inject `DatabaseBatchStorage` and registered `JobDefinition` values; it does not
own database client construction or job discovery.

## Runtime Constraints

Runtime work should treat failure and restart as normal paths:

- `JobInstance` is identified by job name and a stable parameters hash
- `JobExecution` is one concrete attempt for a job instance
- duplicate active execution is prevented by a job-instance lock and repository active-state lookup
- durable repositories expose `createExecutionAttempt` so instance creation, active execution detection, and execution creation can be atomic
- restart orchestration must start from the latest failed execution for the same job instance
- restart skips prior completed step executions and resumes from the first failed or missing step
- step execution can be checkpointed
- job, step, retry, skip, and chunk write lifecycle events can be observed without changing execution semantics
- cancellation uses `AbortSignal`
- chunk step readers open one `ReaderSession` per execution and expose items through `AsyncIterable`
- reader provider instances must stay stateless; execution-specific cursor or offset state belongs to `ReaderSession`
- step-level checkpoint callbacks take precedence over `ReaderSession.checkpoint()`
- checkpoints are saved at chunk boundaries after writer success
- ORM-specific readers belong to ORM integration packages, not `@nest-batch/core`
- chunk retry policy covers processor and writer failures; skip policy currently covers processor failures only
- distributed execution assumes at-least-once delivery
- scheduler dispatch is at-least-once and uses deterministic occurrence ids
- scheduler failure records dispatch failure, not job failure
- scheduler trigger boundaries advance from terminal occurrence state, not from
  still-claimed occurrence state
- scheduler lifecycle events can be observed without changing dispatch semantics
- schedule definitions live in application code; durable stores persist occurrence state
- continuous polling workers do not create `JobExecution`, `StepExecution`,
  checkpoint, or schedule occurrence metadata per polling tick
- polling worker lifecycle events can be observed without changing task execution semantics
- polling worker shutdown uses `AbortSignal`; idle sleep aborts immediately and
  in-flight task work is awaited for graceful shutdown
- polling-only Nest applications use `NestBatchPollingModule` and do not need
  batch storage, lock, checkpoint, schedule, or runner providers
- polling tasks should pass `AbortSignal` to dispatcher and publisher layers;
  publish clients without signal support need a task-owned hard timeout
- SQL adapter locks store `ownerId`, `acquiredAt`, and optional `expiresAt`; stale lock recovery is TTL based
- idempotency expectations are documented near job parameters and retry behavior
- schedulers create or enqueue executions instead of bypassing the runtime
