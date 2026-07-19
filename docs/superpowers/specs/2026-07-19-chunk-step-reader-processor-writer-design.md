# Chunk Step Reader Processor Writer Design

Date: 2026-07-19

## Context

`@nest-batch/core` currently exposes a tasklet-style `StepDefinition` with a
single `execute(context)` function. That shape is useful for simple steps, but
it does not model item-oriented batch work where records are streamed, processed,
written in chunks, checkpointed, retried, or skipped.

The next step design adds a chunk step contract to `core` while preserving the
existing tasklet step API. The design follows the repository rule that `core`
must stay independent from NestJS, database clients, queue clients, and adapter
implementation details.

## Scope

In scope:

- Add a chunk step public contract to `@nest-batch/core`.
- Add a `defineChunkStep` helper separate from the existing `defineStep`.
- Model the reader as `AsyncIterable`-first, with `Iterable` allowed for small
  in-memory sources.
- Make the processor optional.
- Require explicit `SkipItem` values for processor-level skips.
- Keep `null` and `undefined` as valid processor outputs rather than implicit
  skip signals.
- Define the runtime meaning of chunk boundaries, checkpoint writes, and writer
  idempotency expectations.

Out of scope:

- Full durable runner implementation.
- Retry and skip policy implementation.
- Real checkpoint persistence logic in adapters.
- NestJS decorator discovery for chunk steps.
- SQL schema or migration changes.

## Package Boundary

The chunk step contract belongs in `packages/core` because it is part of the
framework-independent batch runtime model. `packages/nest` can later expose
decorator or provider conveniences that produce these core definitions, but
`core` must not depend on NestJS.

Postgres and future database packages should continue to implement repository,
lock, and checkpoint contracts. They should not own reader, processor, or writer
types.

## Public API

Add `defineChunkStep` beside `defineStep`:

```ts
import { defineChunkStep, skipItem } from "@nest-batch/core";

const importUsers = defineChunkStep({
  name: "import-users",
  chunkSize: 100,

  reader: async function* ({ signal, checkpoint }) {
    signal.throwIfAborted();
    yield { id: "user-1", active: true };
  },

  processor: async (user, context) => {
    if (!user.active) {
      return skipItem("inactive user");
    }

    return { id: user.id };
  },

  writer: async (users, context) => {
    await saveUsers(users);
  }
});
```

Processor-less chunk steps are valid:

```ts
const copyUsers = defineChunkStep({
  name: "copy-users",
  chunkSize: 100,
  reader,
  writer
});
```

When `processor` is omitted, the runtime passes reader items directly to the
writer. In that case `Input` and `Output` are the same type.

## Core Types

The public contracts should be close to this shape:

```ts
export interface ChunkStepExecutionContext<TCheckpoint = unknown> {
  readonly signal: AbortSignal;
  readonly checkpoint?: TCheckpoint;
}

export interface ChunkItemContext<Input = unknown, TCheckpoint = unknown>
  extends ChunkStepExecutionContext<TCheckpoint> {
  readonly item: Input;
  readonly index: number;
}

export interface ChunkWriteContext<TCheckpoint = unknown>
  extends ChunkStepExecutionContext<TCheckpoint> {
  readonly chunkIndex: number;
  readonly attempt: number;
}

export type ChunkReader<Input, TCheckpoint = unknown> = (
  context: ChunkStepExecutionContext<TCheckpoint>
) => AsyncIterable<Input> | Iterable<Input>;

export type ChunkProcessor<Input, Output, TCheckpoint = unknown> = (
  item: Input,
  context: ChunkItemContext<Input, TCheckpoint>
) => Output | SkipItem | Promise<Output | SkipItem>;

export type ChunkWriter<Output, TCheckpoint = unknown> = (
  items: readonly Output[],
  context: ChunkWriteContext<TCheckpoint>
) => void | Promise<void>;

export interface TaskletStepDefinition<Input = unknown, Output = unknown> {
  readonly kind?: "tasklet";
  readonly name: string;
  readonly execute: (context: StepExecutionContext<Input>) => Promise<Output> | Output;
}

export interface ChunkStepDefinition<Input = unknown, Output = Input, TCheckpoint = unknown> {
  readonly kind: "chunk";
  readonly name: string;
  readonly chunkSize: number;
  readonly reader: ChunkReader<Input, TCheckpoint>;
  readonly processor?: ChunkProcessor<Input, Output, TCheckpoint>;
  readonly writer: ChunkWriter<Output, TCheckpoint>;
}

export type StepDefinition<Input = unknown, Output = unknown> =
  | TaskletStepDefinition<Input, Output>
  | ChunkStepDefinition<Input, Output>;
```

Existing tasklet steps remain valid. `defineStep({ execute })` continues to
return a tasklet definition with the same source-compatible shape. `JobDefinition`
continues to accept `StepDefinition[]`, but that type now covers both tasklet
and chunk definitions.

`defineChunkStep` should use overloads or equivalent generic constraints so a
processor-less step infers `Output = Input`, while a step with a processor infers
`Output` from the processor return type excluding `SkipItem`.

## Skip Semantics

Skips are explicit:

```ts
export declare const SKIP_ITEM: unique symbol;

export interface SkipItem {
  readonly kind: "skip";
  readonly reason?: string;
  readonly cause?: unknown;
  readonly [SKIP_ITEM]: true;
}

export const skipItem = (reason?: string, cause?: unknown): SkipItem => ({
  kind: "skip",
  reason,
  cause,
  [SKIP_ITEM]: true
});
```

`null` and `undefined` are not skip signals. They remain valid output values so
processors can intentionally write nullable data. The runtime detects skips by
the `SkipItem` brand only.

The helper should make this check explicit through an `isSkipItem` function
rather than relying on truthiness or a plain `{ kind: "skip" }` object shape.

## Runtime Flow

A chunk step runner should follow this order:

1. Mark the step execution as running.
2. Load the latest checkpoint for the step.
3. Create the reader with the restored checkpoint and `AbortSignal`.
4. Pull items from the reader with normal `for await` backpressure.
5. For each item, call the processor if present.
6. If the processor returns `SkipItem`, increment skip counters and do not add
   that item to the pending write chunk.
7. If the processor is omitted, add the reader item directly to the pending
   write chunk.
8. When `chunkSize` accepted outputs are collected, call the writer once.
9. After writer success, persist counters and checkpoint for the completed chunk
   boundary.
10. On normal reader completion, flush any remaining outputs and mark the step
    completed.

The runtime should check `signal.throwIfAborted()` before starting a new chunk
and before writer calls. During graceful shutdown, it should avoid starting new
chunks after cancellation. If a writer is already running, the runtime records
the final status after the writer resolves or rejects.

## Checkpoint And Restart

Checkpoints are saved only after a writer call succeeds. This makes the restart
boundary conservative and keeps at-least-once semantics clear.

Reader cursor state and general execution context can be separated later, but
the chunk step contract should expose the restored checkpoint to the reader from
the start. A future implementation can add a checkpoint update hook without
changing reader, processor, or writer basics.

Because writer success is the commit boundary, users must make writers
idempotent for external systems that can partially succeed. Documentation should
recommend stable idempotency keys based on job execution id, step name, chunk
index, and item identity when available.

## Error Handling

Reader errors fail the step unless a future policy explicitly handles them.

Processor errors are distinct from explicit skips. A thrown processor error is
not a skip; it is eligible for retry or failure according to future retry/skip
policy.

Writer errors fail the current chunk. Since checkpoints are written only after
writer success, restart may re-read and re-process the failed chunk. This is why
writer idempotency must be documented near chunk step usage.

## Testing

Initial tests should verify the public contract and helper behavior:

- `defineChunkStep` trims and freezes the step name like `defineStep`.
- blank chunk step names are rejected.
- invalid `chunkSize` values are rejected.
- chunk steps can be defined without a processor.
- processor steps can return `skipItem()`.
- `isSkipItem` recognizes only explicit skip values.
- `null` and `undefined` are not treated as skip values.
- `@nest-batch/core` exports all new public types and helpers.

Later runtime tests should cover normal completion, processor skip, writer
failure and restart, checkpoint restore, cancellation, retry exhaustion, and
skip limit exceeded.

## Documentation Impact

The root README should keep tasklet examples but add a short chunk step example
once the helper is implemented. `docs/architecture.md` should mention that
`core` owns both tasklet and chunk step contracts.

Examples should avoid implying durable execution is complete until the runner,
repository, checkpoint, and policy implementations exist.

## Acceptance Criteria

- `defineChunkStep` is a separate helper from `defineStep`.
- The reader contract supports `AsyncIterable` and `Iterable`.
- The processor is optional.
- Skip behavior requires explicit `skipItem()` values.
- `null` and `undefined` are valid outputs.
- Existing tasklet step usage remains source-compatible.
- Public exports include the new chunk step types and helpers.
- Tests cover helper validation and explicit skip semantics.
