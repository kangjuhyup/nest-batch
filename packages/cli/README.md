# @rv-nest-batch/cli

Operational command parsing and executable entrypoint for `nest-batch` jobs.

## Install

```bash
pnpm add @rv-nest-batch/cli
```

The published executable can always print its command summary:

```bash
nest-batch --help
```

## Supply application context

```ts
import { defineJob, defineStep } from "@rv-nest-batch/core";
import { runCli } from "@rv-nest-batch/cli";
import { InMemoryBatchStorage } from "@rv-nest-batch/inmemory";

const storage = new InMemoryBatchStorage();
const job = defineJob({
  name: "hello",
  steps: [defineStep({ name: "log", execute: async () => "done" })]
});

const result = await runCli(["run", "--job", "hello"], {
  storage,
  jobs: [job]
});
```

The executable does not discover your application's storage or jobs on its own.
Embed `runCli(args, context)` in an application bootstrap that supplies the
storage and job registry (and queue or schedule context for those commands).
Use durable storage for operational restart and multi-process work; the
in-memory adapter above is only a local example.

## Links

- [Repository](https://github.com/kangjuhyup/nest-batch)
- [Issues](https://github.com/kangjuhyup/nest-batch/issues)

## License

[MIT](https://github.com/kangjuhyup/nest-batch/blob/main/LICENSE)
