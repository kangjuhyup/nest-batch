# nest-batch

`nest-batch` is a Node-native batch framework project for the NestJS ecosystem.

This repository is currently in early implementation stage. The package
boundaries and public entry points are present, and Postgres/MySQL/MariaDB
persistence adapters provide initial driver-backed repository, checkpoint, and
lock storage. Durable execution, distributed workers, and production scheduling
are not implemented yet.

## Packages

- `@nest-batch/core`: framework-independent job and step contracts.
- `@nest-batch/nest`: NestJS module and decorator integration.
- `@nest-batch/postgres`: Postgres driver-backed repository, lock, and checkpoint storage.
- `@nest-batch/mysql`: MySQL driver-backed repository, lock, and checkpoint storage.
- `@nest-batch/mariadb`: MariaDB driver-backed repository, lock, and checkpoint storage.
- `@nest-batch/cli`: operational CLI boundary.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Test Databases

The repository uses Docker Compose for local database integration tests. A
single `compose.yaml` starts Postgres, MySQL, and MariaDB with separate host
ports so they can run together on one machine.

```bash
docker compose up -d postgres mysql mariadb
docker compose ps
docker compose down
```

Default adapter test connection values:

```bash
NEST_BATCH_POSTGRES_URL=postgresql://nest_batch:nest_batch@localhost:15432/nest_batch
NEST_BATCH_POSTGRES_SCHEMA=batch
NEST_BATCH_MYSQL_URL=mysql://nest_batch:nest_batch@localhost:13306/nest_batch
NEST_BATCH_MYSQL_DATABASE=nest_batch
NEST_BATCH_MARIADB_URL=mariadb://nest_batch:nest_batch@localhost:13307/nest_batch
NEST_BATCH_MARIADB_DATABASE=nest_batch
```

From another Compose service, use `postgres:5432`, `mysql:3306`, and
`mariadb:3306` instead of the localhost ports above. A custom `Dockerfile` is
not needed because the test environment only depends on official database
images.

Use `docker compose down -v` when you need to reset all database state.

## SQL Storage

Postgres, MySQL, MariaDB adapter는 driver pool을 통해 `JobRepository`,
`CheckpointStore`, `LockManager`를 제공합니다. `initialize()`는 필요한
schema와 table을 idempotent하게 준비합니다.

```ts
import { PostgresBatchStorage } from "@nest-batch/postgres";
import { MySqlBatchStorage } from "@nest-batch/mysql";

const postgresStorage = new PostgresBatchStorage({
  connectionString: process.env.NEST_BATCH_POSTGRES_URL,
  schema: "batch"
});

const mysqlStorage = new MySqlBatchStorage({
  connectionString: process.env.NEST_BATCH_MYSQL_URL,
  database: "nest_batch"
});

await postgresStorage.initialize();
await postgresStorage.repository.create({
  id: "execution-1",
  jobName: "daily-user-import",
  status: "created",
  parameters: { tenant: "acme" },
  createdAt: new Date()
});
await postgresStorage.close();
```

## Core Example

```ts
import { defineJob, defineStep } from "@nest-batch/core";

const step = defineStep({
  name: "load-users",
  async execute({ signal }) {
    signal.throwIfAborted();
    return "loaded";
  }
});

export const job = defineJob({
  name: "daily-user-import",
  steps: [step]
});
```

## Chunk Step Example

`defineChunkStep`은 item을 streaming으로 읽고, optional processor를 거친 뒤,
writer에 chunk 단위로 전달합니다. `null`과 `undefined`는 유효한 output이며,
skip은 `skipItem()`으로만 명시합니다.

```ts
import { defineChunkStep, skipItem } from "@nest-batch/core";

export const importUsers = defineChunkStep({
  name: "import-users",
  chunkSize: 100,
  reader: async function* ({ signal }) {
    signal.throwIfAborted();
    yield { id: "user-1", active: true };
  },
  processor(user) {
    if (!user.active) {
      return skipItem("inactive user");
    }

    return { id: user.id };
  },
  async writer(users) {
    await saveUsers(users);
  }
});
```

See `docs/architecture.md` for package boundaries and runtime constraints.
