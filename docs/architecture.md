# Architecture

`nest-batch` is split by runtime responsibility.

## `@nest-batch/core`

Core contains framework-independent contracts and helpers. It must not import
NestJS, database clients, queue clients, or CLI frameworks.

Core owns:

- job and step definitions
- tasklet step and chunk step contracts
- job instance, execution identifiers, and status types
- repository and checkpoint contracts
- lock manager contracts
- default sequential batch runner
- step execution counters
- runner-facing options

## `@nest-batch/nest`

Nest integration contains module APIs, decorators, discovery, and lifecycle
integration. It depends on `@nest-batch/core`; core does not depend on NestJS.

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
`list`. The current scaffold exposes command boundaries only.

## Runtime Constraints

Runtime work should treat failure and restart as normal paths:

- `JobInstance` is identified by job name and a stable parameters hash
- `JobExecution` is one concrete attempt for a job instance
- duplicate active execution is prevented by a job-instance lock and repository active-state lookup
- restart orchestration must start from the latest failed execution for the same job instance
- step execution can be checkpointed
- cancellation uses `AbortSignal`
- chunk step readers are `AsyncIterable`-first and checkpoints are saved at chunk boundaries after writer success
- chunk retry policy covers processor and writer failures; skip policy currently covers processor failures only
- distributed execution assumes at-least-once delivery
- SQL adapter locks store `ownerId`, `acquiredAt`, and optional `expiresAt`; stale lock recovery is TTL based
- idempotency expectations are documented near job parameters and retry behavior
- schedulers create or enqueue executions instead of bypassing the runtime
