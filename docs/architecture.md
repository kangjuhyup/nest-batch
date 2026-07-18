# Architecture

`nest-batch` is split by runtime responsibility.

## `@nest-batch/core`

Core contains framework-independent contracts and helpers. It must not import
NestJS, database clients, queue clients, or CLI frameworks.

Core owns:

- job and step definitions
- execution identifiers and status types
- repository and checkpoint contracts
- runner-facing options

## `@nest-batch/nest`

Nest integration contains module APIs, decorators, discovery, and lifecycle
integration. It depends on `@nest-batch/core`; core does not depend on NestJS.

## `@nest-batch/postgres`

The Postgres package contains adapter boundaries for job repository,
checkpoint storage, and future locking. The current scaffold does not implement
real persistence.

## `@nest-batch/cli`

The CLI package owns operational commands such as `run`, `status`, `retry`, and
`list`. The current scaffold exposes command boundaries only.

## Runtime Constraints

Future runtime work should treat failure and restart as normal paths:

- job execution has a durable identity
- step execution can be checkpointed
- cancellation uses `AbortSignal`
- distributed execution assumes at-least-once delivery
- idempotency expectations are documented near job parameters and retry behavior
- schedulers create or enqueue executions instead of bypassing the runtime
