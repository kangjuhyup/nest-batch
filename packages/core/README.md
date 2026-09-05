# @rvkang/batch-core

Framework-independent job and step definitions, execution contracts, and the
Node-native runtime for `nest-batch`.

## Install

```bash
pnpm add @rvkang/batch-core
pnpm add @rvkang/batch-inmemory
```

## Run a job

```ts
import { DefaultBatchRunner, defineJob, defineStep } from "@rvkang/batch-core";
import { InMemoryBatchStorage } from "@rvkang/batch-inmemory";

const storage = new InMemoryBatchStorage();
const runner = new DefaultBatchRunner(storage);
const job = defineJob({
  name: "hello",
  steps: [defineStep({ name: "log", execute: async () => "done" })]
});

await runner.run(job, {});
```

`@rvkang/batch-inmemory` is appropriate for tests and local examples only. Use a
durable storage adapter for restartable or multi-process work. Writers and
external side effects must be idempotent because distributed execution is
at-least-once.

## Subpath APIs

Install one package and import the focused API surface that you need:

- [`@rvkang/batch-core/queue`](https://github.com/kangjuhyup/nest-batch/tree/HEAD/packages/core/src/queue)
- [`@rvkang/batch-core/scheduler`](https://github.com/kangjuhyup/nest-batch/tree/HEAD/packages/core/src/scheduler)
- [`@rvkang/batch-core/polling`](https://github.com/kangjuhyup/nest-batch/tree/HEAD/packages/core/src/polling)
- [`@rvkang/batch-core/worker`](https://github.com/kangjuhyup/nest-batch/tree/HEAD/packages/core/src/worker)

## Links

- [Repository](https://github.com/kangjuhyup/nest-batch)
- [Issues](https://github.com/kangjuhyup/nest-batch/issues)

## License

[MIT](https://github.com/kangjuhyup/nest-batch/blob/HEAD/LICENSE)
