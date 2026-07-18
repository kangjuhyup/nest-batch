# nest-batch Scaffold Design

Date: 2026-07-18

## Context

`nest-batch` is a Node-native batch framework for the NestJS ecosystem.
The initial scaffold must follow the repository guidance in `AGENTS.md`: keep
`@nest-batch/core` independent from NestJS, place Nest integration in a separate
package, and leave durable execution, checkpoint/restart, retry/skip,
distributed workers, and observability as first-class design concerns.

The repository currently has only a root `package.json`, an empty `README.md`,
agent instructions, skills, and an empty `src/` directory. There is no existing
workspace layout or git repository yet.

## Scope

This design covers the first project scaffold, not a complete runtime
implementation. The scaffold should be buildable, testable, and shaped so later
runtime work has clear package boundaries.

In scope:

- Root workspace configuration.
- TypeScript build configuration.
- Minimal package shells for `core`, `nest`, `postgres`, and `cli`.
- Example and documentation directories.
- Public export entry points with minimal scaffold contracts.
- Basic tests that prove the workspace and package exports are wired.

Out of scope:

- Full durable job execution.
- Real Postgres persistence.
- Queue-backed distributed worker execution.
- Production scheduler behavior.
- Complete NestJS discovery and decorator implementation.

## Package Boundaries

The initial layout will be:

```text
packages/
  core/
  nest/
  postgres/
  cli/
examples/
  basic/
  nestjs/
docs/
```

`packages/core` owns framework-independent contracts and runtime-facing types:
job definitions, step definitions, execution identifiers, status values,
repository contracts, checkpoint contracts, and runner-facing options.

`packages/nest` owns NestJS integration: module APIs, decorators, discovery
hooks, and lifecycle integration. It depends on `@nest-batch/core`. `core` must
not import anything from NestJS.

`packages/postgres` owns Postgres adapter code for job repository, locking, and
checkpoint storage. It depends on `@nest-batch/core`, but adapter-specific
options stay inside this package.

`packages/cli` owns operational commands such as run, status, retry, and list.
The first scaffold only needs a CLI entry point and command boundary.

`examples/basic` demonstrates programmatic use without NestJS.

`examples/nestjs` demonstrates the eventual Nest module and decorator workflow.

`docs` contains architecture and getting-started material. Public examples must
avoid promising behavior that the scaffold does not implement yet.

## Initial Public API Shape

`@nest-batch/core` should expose small contracts, not internal orchestration
classes:

- `JobDefinition`
- `StepDefinition`
- `JobExecution`
- `JobExecutionStatus`
- `JobRepository`
- `CheckpointStore`
- `BatchRunner`
- `defineJob`
- `defineStep`

`@nest-batch/nest` should expose Nest-facing entry points:

- `NestBatchModule`
- `BatchJob`
- `BatchStep`

`@nest-batch/postgres` should expose adapter entry points without leaking
database concerns into `core`:

- `PostgresJobRepository`
- `PostgresCheckpointStore`
- `PostgresBatchOptions`

`@nest-batch/cli` should expose a bin entry point. Programmatic exports are not
required for the first scaffold.

These names are initial contracts for the scaffold. Runtime behavior can evolve,
but import paths and package ownership should stay stable unless a later design
explicitly changes them.

## Runtime Design Constraints

Runtime code added after the scaffold must treat failure and restart as normal
paths. Core contracts should make these concerns visible:

- Job execution has a durable identity.
- Step execution can be checkpointed.
- Cancellation uses `AbortSignal`.
- Distributed execution assumes at-least-once delivery.
- Idempotency expectations must be documented near job parameters and retry
  behavior.
- Scheduler code creates or enqueues executions; it should not bypass the
  runtime.

The scaffold should leave room for these constraints without implementing them
prematurely.

## Tooling

Use a TypeScript workspace with package-level build outputs. The preferred
baseline is:

- `pnpm` workspaces.
- TypeScript project references or package-level `tsconfig` files.
- Vitest for lightweight unit tests.
- `tsup` or `tsc` for package builds, chosen during implementation based on the
  simplest reliable setup.

The implementation should avoid adding runtime dependencies to `core` unless
they are required for the public contracts.

## Testing

The first scaffold should include tests that verify:

- `core` can define a job and step without NestJS.
- `nest` imports from `core` without creating a reverse dependency.
- Public exports resolve from each package entry point.

Later runtime tests should prioritize failure, restart, duplicate execution,
cancellation, checkpoint recovery, retry, and skip behavior over simple success
paths.

## Documentation

Initial docs should include:

- Root README explaining the package split and current scaffold status.
- `docs/architecture.md` explaining package boundaries.
- Minimal example files that compile or are clearly marked as sketch examples if
  full runtime behavior is not implemented yet.

Docs must not describe unimplemented durable runtime behavior as already
available.

## Risks

- Creating too many abstractions before runtime behavior exists could make the
  API hard to revise. Keep contracts small.
- Nest decorator DX can push framework concerns into `core`. Keep decorators in
  `packages/nest`.
- Postgres-specific options can pollute core types. Keep adapter details in
  `packages/postgres`.
- Examples can overpromise. Keep examples aligned with exported code.

## Acceptance Criteria

- The workspace has the expected package directories.
- Each package has a clear entry point and package metadata.
- `@nest-batch/core` has no NestJS dependency.
- Root build and test commands are defined.
- At least one test proves the core scaffold works.
- README and architecture docs describe the scaffold honestly.
