# @rv-nest-batch/mariadb

MariaDB-backed repository, checkpoint, execution-context, and lock storage for
`nest-batch`.

## Install

```bash
pnpm add @rv-nest-batch/mariadb
```

## Initialize storage

```ts
import { MariaDbBatchStorage } from "@rv-nest-batch/mariadb";

const storage = new MariaDbBatchStorage({
  connectionString: process.env.DATABASE_URL,
  database: "nest_batch"
});

await storage.initialize();
// Pass storage to DefaultBatchRunner or NestBatchModule.forRoot({ storage }).
await storage.close();
```

`initialize()` idempotently creates this adapter's tables. Durable execution
state does not make external writes exactly once, so writers must tolerate a
restart or redelivery through idempotency.

## Links

- [Repository](https://github.com/kangjuhyup/nest-batch)
- [Issues](https://github.com/kangjuhyup/nest-batch/issues)

## License

[MIT](https://github.com/kangjuhyup/nest-batch/blob/HEAD/LICENSE)
