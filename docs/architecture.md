# Architecture

`nest-batch` is split by runtime responsibility.

## `@nest-batch/core`

Core contains framework-independent contracts and helpers. It must not import
NestJS, database clients, queue clients, or CLI frameworks.

Core owns:

- job and step definitions
- tasklet step and chunk step contracts
- execution identifiers and status types
- repository and checkpoint contracts
- lock manager contracts
- runner-facing options

## `@nest-batch/nest`

Nest integration contains module APIs, decorators, discovery, and lifecycle
integration. It depends on `@nest-batch/core`; core does not depend on NestJS.

## `@nest-batch/postgres`

The Postgres package contains adapter boundaries for job repository,
lock management, and checkpoint storage. The current scaffold does not
implement real persistence or locking.

## `@nest-batch/mysql`

The MySQL package contains driver-backed job repository, lock management, and
checkpoint storage. It uses `mysql2/promise`, keeps MySQL connection and
database options inside the adapter package, and exposes `MySqlBatchStorage`
for Nest integration or programmatic runtime wiring.

## `@nest-batch/mariadb`

The MariaDB package contains driver-backed job repository, lock management, and
checkpoint storage. It uses the `mariadb` driver, keeps MariaDB connection and
database options inside the adapter package, and exposes `MariaDbBatchStorage`
for Nest integration or programmatic runtime wiring.

## `@nest-batch/cli`

The CLI package owns operational commands such as `run`, `status`, `retry`, and
`list`. The current scaffold exposes command boundaries only.

## Runtime Constraints

Future runtime work should treat failure and restart as normal paths:

- job execution has a durable identity
- step execution can be checkpointed
- cancellation uses `AbortSignal`
- chunk step readers are `AsyncIterable`-first and checkpoints are saved at chunk boundaries after writer success
- distributed execution assumes at-least-once delivery
- SQL adapter locks store `ownerId`, `acquiredAt`, and optional `expiresAt`; stale lock recovery is TTL based
- idempotency expectations are documented near job parameters and retry behavior
- schedulers create or enqueue executions instead of bypassing the runtime
