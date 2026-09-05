# @rv-nest-batch/postgres

Postgres-backed repository, checkpoint, execution-context, and lock storage
for `nest-batch`.

## Install

```bash
pnpm add @rv-nest-batch/postgres
```

## Initialize storage

```ts
import { PostgresBatchStorage } from "@rv-nest-batch/postgres";

const storage = new PostgresBatchStorage({
  connectionString: process.env.DATABASE_URL,
  schema: "batch"
});

await storage.initialize();
// Pass storage to DefaultBatchRunner or NestBatchModule.forRoot({ storage }).
await storage.close();
```

`initialize()` idempotently creates this adapter's schema objects. The storage
is the durable source of truth for execution state and checkpoints, but a
writer can still be retried after a crash; make external side effects
idempotent.

## Links

- [Repository](https://github.com/kangjuhyup/nest-batch)
- [Issues](https://github.com/kangjuhyup/nest-batch/issues)

## License

[MIT](https://github.com/kangjuhyup/nest-batch/blob/HEAD/LICENSE)
