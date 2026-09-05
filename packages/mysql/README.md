# @rv-nest-batch/mysql

MySQL-backed repository, checkpoint, execution-context, and lock storage for
`nest-batch`.

## Install

```bash
pnpm add @rv-nest-batch/mysql
```

## Initialize storage

```ts
import { MySqlBatchStorage } from "@rv-nest-batch/mysql";

const storage = new MySqlBatchStorage({
  connectionString: process.env.DATABASE_URL,
  database: "nest_batch"
});

await storage.initialize();
// Pass storage to DefaultBatchRunner or NestBatchModule.forRoot({ storage }).
await storage.close();
```

`initialize()` idempotently creates this adapter's tables. Checkpoints are
written after successful work boundaries; design writers and external side
effects to be idempotent when a failed execution restarts.

## Links

- [Repository](https://github.com/kangjuhyup/nest-batch)
- [Issues](https://github.com/kangjuhyup/nest-batch/issues)

## License

[MIT](https://github.com/kangjuhyup/nest-batch/blob/HEAD/LICENSE)
