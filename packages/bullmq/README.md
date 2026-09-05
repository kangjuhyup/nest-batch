# @rvkang/batch-bullmq

BullMQ-backed `WorkQueue` adapter for distributed `nest-batch` workers.

## Install

```bash
pnpm add @rvkang/batch-bullmq
pnpm add bullmq
```

`bullmq` version 5 or newer is a peer dependency.

## Create a work queue

```ts
import { Queue, Worker } from "bullmq";
import { BullMqWorkQueue } from "@rvkang/batch-bullmq";

const queue = new Queue("nest-batch", { connection: { host: "127.0.0.1", port: 6379 } });
const worker = new Worker("nest-batch", async () => undefined, {
  autorun: false,
  connection: { host: "127.0.0.1", port: 6379 }
});

const workQueue = new BullMqWorkQueue({ queue, worker });
```

The adapter assigns a stable BullMQ job id from each `WorkUnit.id` and defaults
to one BullMQ attempt so the batch runtime owns retry policy. Queue delivery is
at-least-once; keep the repository as the source of truth and make external
side effects idempotent.

## Links

- [Repository](https://github.com/kangjuhyup/nest-batch)
- [Issues](https://github.com/kangjuhyup/nest-batch/issues)

## License

[MIT](https://github.com/kangjuhyup/nest-batch/blob/HEAD/LICENSE)
