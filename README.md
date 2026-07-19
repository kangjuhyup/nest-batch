# nest-batch

`nest-batch` is a Node-native batch framework project for the NestJS ecosystem.

This repository is currently in early implementation stage. The package
boundaries and public entry points are present, and Postgres/MySQL/MariaDB
persistence adapters provide initial driver-backed repository, checkpoint, and
lock storage. `DefaultBatchRunner` provides the first durable execution slice
for sequential tasklet/chunk steps. Distributed workers, restart orchestration,
retry policy, and production scheduling are not implemented yet.

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

### E2E Tests

E2E tests are excluded from the default `pnpm test` command. Start the needed
database first, then run the e2e script explicitly.

```bash
docker compose up -d postgres
pnpm test:e2e:postgres
```

Postgres e2e tests use a disposable schema named `batch_e2e` by default. To
override it, use a schema name that starts with `batch_e2e`:

```bash
NEST_BATCH_E2E_POSTGRES_URL=postgresql://nest_batch:nest_batch@127.0.0.1:15432/nest_batch \
NEST_BATCH_E2E_POSTGRES_SCHEMA=batch_e2e_local \
pnpm test:e2e:postgres
```

### Performance Tests

Performance tests are also excluded from the default `pnpm test` command. They
start with adapter micro-benchmarks and are intended to grow into heavier
database concurrency scenarios without changing the normal test path.

```bash
docker compose up -d postgres
pnpm test:perf:postgres
```

Postgres performance tests use a disposable schema named `batch_perf` by
default. The result table reports operations, total duration, average latency,
and operations per second. Tune local runs with these environment variables:

```bash
NEST_BATCH_PERF_POSTGRES_URL=postgresql://nest_batch:nest_batch@127.0.0.1:15432/nest_batch \
NEST_BATCH_PERF_POSTGRES_SCHEMA=batch_perf_local \
NEST_BATCH_PERF_ITERATIONS=1000 \
NEST_BATCH_PERF_WARMUP_ITERATIONS=100 \
pnpm test:perf:postgres
```

Custom performance schemas must start with `batch_perf` so cleanup cannot drop
shared schemas. Future lock contention and stale-lock load tests should use the
same `*.perf.test.ts` pattern and `test:perf` script.

## SQL Storage

Postgres, MySQL, MariaDB adapter는 driver pool을 통해 `JobRepository`,
`CheckpointStore`, `LockManager`를 제공합니다. `JobRepository`는 job
execution과 step execution 상태를 저장하고, `initialize()`는 필요한 schema와
table을 idempotent하게 준비합니다.

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

## Default Runner

`DefaultBatchRunner`는 `DatabaseBatchStorage`에만 의존합니다. 실행 시 job
execution lock을 획득하고, job/step 상태 전이를 repository에 저장합니다. chunk
step은 writer가 성공한 뒤 `checkpoint()` callback이 반환한 값을
`CheckpointStore`에 저장합니다.

```ts
import { DefaultBatchRunner, defineJob, defineStep } from "@nest-batch/core";
import { PostgresBatchStorage } from "@nest-batch/postgres";

const storage = new PostgresBatchStorage({
  connectionString: process.env.NEST_BATCH_POSTGRES_URL,
  schema: "batch"
});
const runner = new DefaultBatchRunner(storage);
const job = defineJob({
  name: "daily-user-import",
  steps: [
    defineStep({
      name: "load-users",
      execute() {
        return "loaded";
      }
    })
  ]
});

await storage.initialize();
const execution = await runner.run(job, { tenant: "acme" });
await storage.close();
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
import type { ChunkStepExecutionContext, Processor, Reader, Writer } from "@nest-batch/core";

interface SourceUser {
  readonly id: string;
  readonly active: boolean;
}

interface ImportedUser {
  readonly id: string;
}

class UserReader implements Reader<SourceUser> {
  async *read({ signal }: ChunkStepExecutionContext) {
    signal.throwIfAborted();
    yield { id: "user-1", active: true };
  }
}

class UserProcessor implements Processor<SourceUser, ImportedUser> {
  process(user: SourceUser) {
    if (!user.active) {
      return skipItem("inactive user");
    }

    return { id: user.id };
  }
}

class UserWriter implements Writer<ImportedUser> {
  async write(users: readonly ImportedUser[]) {
    await saveUsers(users);
  }
}

export const importUsers = defineChunkStep({
  name: "import-users",
  chunkSize: 100,
  reader: new UserReader(),
  processor: new UserProcessor(),
  writer: new UserWriter()
});
```

See `docs/architecture.md` for package boundaries and runtime constraints.
