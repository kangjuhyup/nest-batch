# @rv-nest-batch/inmemory

In-memory `DatabaseBatchStorage` implementation for `nest-batch` tests and
local examples.

## Install

```bash
pnpm add @rv-nest-batch/inmemory
```

## Create storage

```ts
import { InMemoryBatchStorage } from "@rv-nest-batch/inmemory";

const storage = new InMemoryBatchStorage();
```

## Operational note

This storage is non-durable: all repository, checkpoint, execution-context,
and lock state is lost when the process exits. Do not use it for production
durability, restart recovery, or coordination between processes; choose a SQL
adapter instead.

## Links

- [Repository](https://github.com/kangjuhyup/nest-batch)
- [Issues](https://github.com/kangjuhyup/nest-batch/issues)

## License

[MIT](https://github.com/kangjuhyup/nest-batch/blob/main/LICENSE)
