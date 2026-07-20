# nest-batch

`nest-batch`는 NestJS 생태계를 위한 Node-native batch framework
프로젝트입니다.

이 저장소는 현재 초기 구현 단계입니다. package boundary와 public entry
point는 준비되어 있고, Postgres/MySQL/MariaDB persistence adapter는
driver-backed repository, checkpoint, lock storage의 초기 구현을 제공합니다.
`DefaultBatchRunner`는 순차 tasklet/chunk step을 위한 첫 durable execution
구간을 제공하며, `JobInstance` identity와 active execution 중복 방지를
지원합니다. 같은 `JobInstance`의 최신 failed execution checkpoint부터 restart할
수 있고, 이미 completed 상태였던 step은 다시 실행하지 않으며, failed step은
checkpoint부터 재개합니다. chunk step은 processor/writer retry policy,
processor skip policy, `BatchObserver` lifecycle event를 지원합니다. CLI는
application이 storage와 job registry를 주입할 때 job 실행, 재시도, 상태 확인,
목록 출력을 처리할 수 있습니다. distributed worker와 production scheduling은
아직 구현되지 않았습니다.

## Packages

- `@nest-batch/core`: framework에 독립적인 job/step contract.
- `@nest-batch/nest`: NestJS module과 decorator integration.
- `@nest-batch/inmemory`: test와 example용 비영속 in-memory repository, lock, checkpoint storage.
- `@nest-batch/postgres`: Postgres driver-backed repository, lock, checkpoint storage.
- `@nest-batch/mysql`: MySQL driver-backed repository, lock, checkpoint storage.
- `@nest-batch/mariadb`: MariaDB driver-backed repository, lock, checkpoint storage.
- `@nest-batch/cli`: 운영 CLI 경계.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Test Databases

이 저장소는 local database integration test를 위해 Docker Compose를 사용합니다.
루트의 `compose.yaml` 하나로 Postgres, MySQL, MariaDB를 함께 실행할 수 있고,
각 database는 같은 machine에서 동시에 떠 있도록 별도 host port를 사용합니다.

```bash
docker compose up -d postgres mysql mariadb
docker compose ps
docker compose down
```

adapter test의 기본 접속 값은 다음과 같습니다.

```bash
NEST_BATCH_POSTGRES_URL=postgresql://nest_batch:nest_batch@localhost:15432/nest_batch
NEST_BATCH_POSTGRES_SCHEMA=batch
NEST_BATCH_MYSQL_URL=mysql://nest_batch:nest_batch@localhost:13306/nest_batch
NEST_BATCH_MYSQL_DATABASE=nest_batch
NEST_BATCH_MARIADB_URL=mariadb://nest_batch:nest_batch@localhost:13307/nest_batch
NEST_BATCH_MARIADB_DATABASE=nest_batch
```

다른 Compose service에서 접속할 때는 위 localhost port 대신 `postgres:5432`,
`mysql:3306`, `mariadb:3306`을 사용합니다. 테스트 환경은 공식 database
image만 사용하므로 custom `Dockerfile`은 필요하지 않습니다.

모든 database state를 초기화해야 할 때는 다음 명령을 사용합니다.

```bash
docker compose down -v
```

### E2E Tests

E2E test는 기본 `pnpm test` 명령에서 제외됩니다. 필요한 database를 먼저
실행한 뒤 e2e script를 명시적으로 실행합니다.

```bash
docker compose up -d postgres mysql mariadb
pnpm test:e2e
pnpm test:e2e:adapters
pnpm test:e2e:system
pnpm test:e2e:examples
pnpm test:e2e:postgres
```

E2E test는 책임 경계별로 나눕니다.

- `packages/*/test/*.e2e.test.ts`: package-local adapter e2e test.
- `e2e/*.e2e.test.ts`: package boundary를 가로지르는 system e2e test.
- `examples/*/test/*.e2e.test.ts`: example app e2e test.

Postgres e2e test는 기본적으로 `batch_e2e`라는 disposable schema를 사용합니다.
schema를 바꾸려면 `batch_e2e`로 시작하는 이름을 사용해야 합니다.

```bash
NEST_BATCH_E2E_POSTGRES_URL=postgresql://nest_batch:nest_batch@127.0.0.1:15432/nest_batch \
NEST_BATCH_E2E_POSTGRES_SCHEMA=batch_e2e_local \
pnpm test:e2e:postgres
```

System e2e test는 in-memory, Postgres, MySQL, MariaDB storage 전체를 같은
runtime flow로 검증합니다. Postgres system test는 기본적으로
`batch_system_e2e`, `batch_full_e2e` disposable schema를 사용합니다. custom
system schema는 해당 prefix로 시작해야 합니다. MySQL과 MariaDB full-flow test는
`nb_full_e2e`로 시작하는 table prefix의 table만 drop합니다. 필요하면
`NEST_BATCH_FULL_E2E_MYSQL_*`, `NEST_BATCH_FULL_E2E_MARIADB_*` 환경 변수로 기본
값을 바꿉니다.

### Performance Tests

performance test도 기본 `pnpm test` 명령에서 제외됩니다. 현재는 adapter
micro-benchmark부터 시작하며, 일반 테스트 경로를 바꾸지 않고 더 무거운 database
concurrency scenario로 확장하는 것을 전제로 둡니다.

```bash
docker compose up -d postgres
pnpm test:perf:postgres
```

Postgres performance test는 기본적으로 `batch_perf`라는 disposable schema를
사용합니다. 결과 table은 operation 수, 전체 duration, 평균 latency,
operations per second를 출력합니다. local run은 다음 환경 변수로 조정합니다.

```bash
NEST_BATCH_PERF_POSTGRES_URL=postgresql://nest_batch:nest_batch@127.0.0.1:15432/nest_batch \
NEST_BATCH_PERF_POSTGRES_SCHEMA=batch_perf_local \
NEST_BATCH_PERF_ITERATIONS=1000 \
NEST_BATCH_PERF_WARMUP_ITERATIONS=100 \
pnpm test:perf:postgres
```

custom performance schema는 cleanup이 shared schema를 지우지 않도록
`batch_perf`로 시작해야 합니다. 이후 lock contention과 stale-lock load test는
같은 `*.perf.test.ts` pattern과 `test:perf` script를 사용해 추가합니다.

## In-Memory Storage

`@nest-batch/inmemory`는 `JobRepository`, `CheckpointStore`, `LockManager`의
비영속 구현을 제공합니다. process memory에만 state를 저장하므로 restart,
multi-process worker, 운영 durability 검증에는 사용하지 않습니다. example e2e,
runner unit test, 빠른 local smoke test처럼 database fixture가 핵심이 아닌
경우에 사용합니다.

```ts
import { InMemoryBatchStorage } from "@nest-batch/inmemory";

const storage = new InMemoryBatchStorage();
```

## SQL Storage

Postgres, MySQL, MariaDB adapter는 driver pool을 통해 `JobRepository`,
`CheckpointStore`, `LockManager`를 제공합니다. `JobRepository`는 job
name과 parameters hash로 식별되는 `JobInstance`, 실제 실행 시도인
`JobExecution`, 그리고 `StepExecution` 상태를 저장합니다. 같은 instance의
active execution과 마지막 failed execution을 조회할 수 있어 중복 실행 방지와
restart 준비 흐름의 source of truth가 됩니다. runner가 새 실행을 만들 때는
`createExecutionAttempt()`를 사용하며, SQL adapter는 가능한 경우 driver
transaction 안에서 instance 생성, active execution 확인, execution 생성을 함께
처리합니다. `initialize()`는 필요한 schema와 table을 idempotent하게 준비합니다.

```ts
import { PostgresBatchStorage } from "@nest-batch/postgres";
import { MySqlBatchStorage } from "@nest-batch/mysql";
import { createJobInstanceId, hashJobParameters } from "@nest-batch/core";

const postgresStorage = new PostgresBatchStorage({
  connectionString: process.env.NEST_BATCH_POSTGRES_URL,
  schema: "batch"
});

const mysqlStorage = new MySqlBatchStorage({
  connectionString: process.env.NEST_BATCH_MYSQL_URL,
  database: "nest_batch"
});

await postgresStorage.initialize();
const parameters = { tenant: "acme" };
const parametersHash = hashJobParameters(parameters);
const instance = await postgresStorage.repository.createJobInstance({
  id: createJobInstanceId("daily-user-import", parametersHash),
  jobName: "daily-user-import",
  parametersHash,
  parameters,
  createdAt: new Date()
});
await postgresStorage.repository.create({
  id: "execution-1",
  instanceId: instance.id,
  jobName: "daily-user-import",
  status: "created",
  parameters,
  createdAt: new Date()
});
await postgresStorage.close();
```

## Default Runner

`DefaultBatchRunner`는 `DatabaseBatchStorage`에만 의존합니다. 실행 시 job
name과 parameters를 안정적으로 hash해 `JobInstance`를 찾거나 만들고,
`job-instance:{instanceId}` lock으로 같은 instance의 active execution을
거부합니다. 이후 job/step 상태 전이를 repository에 저장합니다. chunk step은
writer가 성공한 뒤 `checkpoint()` callback이 반환한 값을 `CheckpointStore`에
저장합니다. `restart: true`를 넘기면 같은 instance의 최신 failed execution에서
checkpoint를 읽고, 이전 execution에서 이미 completed 상태였던 step은 새
execution에 completed 기록만 남긴 뒤 다시 실행하지 않습니다. 재시작된 step은 새
execution id로 checkpoint를 다시 저장합니다.

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

같은 parameters의 최신 execution이 failed 상태일 때는 다음처럼 checkpoint부터
이어 실행할 수 있습니다.

```ts
await runner.run(job, { tenant: "acme" }, { restart: true });
```

Runner lifecycle과 chunk 처리 이벤트는 `BatchObserver`로 받을 수 있습니다.

```ts
const runner = new DefaultBatchRunner(storage, {
  observer: {
    onBatchEvent(event) {
      console.log(event.type);
    }
  }
});
```

## Operational CLI

`@nest-batch/cli`는 application이 직접 CLI bootstrap을 구성할 수 있도록
`runCli(args, { storage, jobs })`를 제공합니다. package-level `nest-batch`
binary는 아직 database 설정이나 job 등록을 스스로 알 수 없으므로, config loading이
추가되기 전까지 production app은 자체 bootstrap에서 `runCli`를 감싸는 방식이
명확합니다.

```ts
import { runCli } from "@nest-batch/cli";

const result = await runCli(
  [
    "run",
    "--job",
    "daily-user-import",
    "--parameters",
    '{"tenant":"acme"}'
  ],
  {
    storage,
    jobs: [job]
  }
);
```

지원 command는 `run`, `retry`, `status`, `list`입니다. `run`, `retry`,
`status`는 `DatabaseBatchStorage`가 필요하고, `run`과 `retry`는 주입된 job
registry에 대상 job이 있어야 합니다. 운영 command output은 JSON입니다.

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

`defineChunkStep`은 item을 streaming으로 읽고, optional processor를 거친 뒤
writer에 chunk 단위로 전달합니다. `null`과 `undefined`는 유효한 output이며,
명시적 skip은 `skipItem()`으로 표현합니다. `retryPolicy`는 processor와 writer
실패에 적용되고, `skipPolicy`는 processor 실패 item을 건너뛰는 데만 적용됩니다.
writer 실패 skip은 데이터 손실 의미가 커서 아직 지원하지 않습니다.

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

    if (user.id === "bad-user") {
      throw new Error("invalid user");
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
  writer: new UserWriter(),
  retryPolicy: {
    canRetry({ attempt, phase }) {
      return phase === "write" && attempt < 3;
    }
  },
  skipPolicy: {
    canSkip({ error }) {
      return error instanceof Error && error.message === "invalid user";
    }
  }
});
```

package boundary와 runtime constraint는 `docs/architecture.md`를 참고하세요.
