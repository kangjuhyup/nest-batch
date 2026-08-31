# Production Scheduling 설계

## 목표

`nest-batch`에 운영 환경에서 사용할 수 있는 schedule 실행 경계를 추가한다.
scheduler는 job runtime을 직접 구현하지 않고, 정해진 시간의 occurrence를
durable하게 claim한 뒤 `BatchRunner`로 실행하거나 `WorkQueue`에 enqueue한다.
job, step, checkpoint, retry, skip 의미는 기존 runtime이 계속 소유한다.

1차 구현은 다음을 제공한다.

- `@nest-batch/scheduler-core` package
- code-defined schedule definition과 deterministic occurrence id
- `SchedulerLoop`를 통한 tick 기반 scheduling
- `ScheduleStore` contract와 `@nest-batch/inmemory` 구현
- Postgres/MySQL/MariaDB `ScheduleStore` 구현
- direct runner dispatch와 queue dispatch helper
- CLI에서 scheduler를 한 번 tick하거나 loop로 실행하는 command
- Nest module에서 scheduler 구성요소를 주입할 수 있는 provider 경계

## 비목표

다음은 1차 구현 범위에 넣지 않는다.

- Spring Batch 또는 Quartz 수준의 모든 trigger 기능 복제
- 외부 cron parser 의존성 추가
- runtime job 실패를 scheduler가 자동 restart하는 동작
- UI, dashboard, schedule 편집 API
- schedule definition을 database에 저장하고 동적으로 수정하는 기능

schedule definition은 application code가 소유한다. database는 실행된 occurrence와
claim 상태를 저장해 중복 dispatch와 restart 후 catch-up 판단에 사용한다.

## Package Boundary

### `@nest-batch/scheduler-core`

framework-independent scheduler contract와 loop를 둔다. 이 package는 NestJS,
database driver, queue implementation에 의존하지 않는다.

주요 책임:

- `ScheduleDefinition`
- `ScheduleTrigger`
- `ScheduleStore`
- `SchedulerLoop`
- `defineSchedule`
- `createIntervalTrigger`
- `createRunnerScheduleDispatcher`
- `createQueueScheduleDispatcher`

### SQL adapter packages

`@nest-batch/postgres`, `@nest-batch/mysql`, `@nest-batch/mariadb`는 각 dialect에
맞는 `ScheduleStore` 구현을 제공한다. 각 schedule store는 전용 `initialize()`를
제공하고 scheduler occurrence table을 idempotent하게 준비한다. 기존
`PostgresBatchStorage`, `MySqlBatchStorage`, `MariaDbBatchStorage`의
`initialize()`는 job repository, checkpoint, lock table 초기화 책임을 유지한다.

각 adapter는 dialect 차이를 숨기지 않는다. Postgres는 schema-qualified table을
사용하고, MySQL/MariaDB는 database와 table prefix를 사용한다.

### `@nest-batch/inmemory`

`@nest-batch/inmemory`는 `InMemoryScheduleStore`를 제공한다. 이 구현은 unit test,
example, local smoke test용이며 restart, multi-process scheduler, 운영 durability
검증에는 사용하지 않는다.

### `@nest-batch/cli`

CLI는 application이 `storage`, `jobs`, `schedules`, `scheduleStore`, `queue`,
`runner`를 주입할 때 scheduler를 실행한다. package-level binary는 application
bootstrap 없이 schedule을 발견하지 않는다.

### `@nest-batch/nest`

Nest integration은 scheduler core를 재구현하지 않는다. module option으로
`scheduleStore`, `schedules`, `schedulerDispatcher`, `schedulerLoop`를 받는
provider 경계를 제공하고, lifecycle 자동 시작은 명시 option으로만 켠다.

## Public API 초안

```ts
import {
  SchedulerLoop,
  createIntervalTrigger,
  createQueueScheduleDispatcher,
  defineSchedule
} from "@nest-batch/scheduler-core";

const schedule = defineSchedule({
  name: "billing.every-minute",
  jobName: "billing",
  trigger: createIntervalTrigger({
    everyMs: 60_000,
    startAt: new Date("2026-01-01T00:00:00.000Z")
  }),
  parameters({ scheduledAt }) {
    return { billingDate: scheduledAt.toISOString().slice(0, 10) };
  },
  misfirePolicy: "fire-once"
});

const loop = new SchedulerLoop({
  schedules: [schedule],
  store: scheduleStore,
  lockManager: storage.lockManager,
  dispatcher: createQueueScheduleDispatcher({ queue }),
  ownerId: "scheduler-1"
});

await loop.tick({ now: new Date(), signal });
```

핵심 type은 다음 의미를 가진다.

- `ScheduleDefinition`: 하나의 schedule 이름, 대상 job 이름, trigger, parameter
  factory, dispatch option을 담는다.
- `ScheduleTrigger`: durable state 이후부터 현재 시각까지 dispatch해야 하는
  occurrence 시각을 계산한다.
- `ScheduleOccurrence`: `scheduleName`, `occurrenceId`, `scheduledAt`, `status`,
  `ownerId`, `claimExpiresAt`, `dispatchedAt`, `failureReason`을 가진다.
- `ScheduleStore`: occurrence claim, dispatch 완료 기록, dispatch 실패 기록,
  최신 occurrence 조회를 담당한다.
- `SchedulerLoop`: 여러 schedule을 순회하며 due occurrence를 claim하고 dispatcher를
  호출한다.
- `ScheduleDispatcher`: occurrence를 실제 runtime dispatch로 바꾸는 함수다.
  runner dispatcher는 주입된 job registry에서 `jobName`을 찾고, queue dispatcher는
  기존 CLI worker payload와 호환되는 `WorkUnit`을 만든다.

## Data Flow

1. application이 schedule definition 목록을 구성한다.
2. `SchedulerLoop.tick()`이 각 schedule의 schedule-level lock을 획득한다.
3. loop가 `ScheduleStore.findLatestOccurrence(scheduleName)`로 마지막 durable
   occurrence를 읽는다.
4. `ScheduleTrigger.getDueOccurrences()`가 마지막 occurrence 이후부터 `now`까지
   due occurrence를 계산한다.
5. `misfirePolicy`에 따라 dispatch할 occurrence를 고른다.
6. loop가 `ScheduleStore.claimOccurrence()`를 호출한다.
7. claim에 성공한 scheduler만 dispatcher를 호출한다.
8. dispatcher가 `BatchRunner.run()` 또는 `WorkQueue.enqueue()`를 호출한다.
9. dispatch 호출이 성공하면 `markDispatched()`, 실패하면 `markFailed()`를 기록한다.
10. schedule-level lock을 해제한다.

worker가 queue work를 처리할 때는 기존 CLI worker payload와 같은 의미를 사용한다.
queue dispatch의 work id는 deterministic occurrence id를 사용한다. BullMQ adapter는
BullMQ custom `jobId`가 `:` 문자를 허용하지 않는 제약 때문에 queue payload의
`WorkUnit.id`는 그대로 유지하고, BullMQ `jobId`에만 안정적인 encoding을 적용한다.
따라서 같은 occurrence enqueue는 queue layer에서도 중복을 줄일 수 있다.

## Occurrence Id와 Idempotency

occurrence id는 다음 값을 기준으로 안정적으로 만든다.

```text
schedule:{scheduleName}:{scheduledAt.toISOString()}
```

queue dispatch는 이 id를 `WorkUnit.id`로 사용한다. direct runner dispatch는
기본적으로 같은 id를 `executionId`로 전달한다. SQL repository의 primary key와
runner의 duplicate active execution 방지가 최종 source of truth다.

이 설계는 at-least-once dispatch를 전제로 한다. scheduler crash, queue 재전달,
worker crash가 있으면 같은 occurrence가 다시 dispatch될 수 있다. writer와 외부
side effect는 기존 runtime 문서와 같이 idempotency key 또는 natural unique
constraint를 사용해야 한다.

## Misfire Policy

1차 구현의 policy는 작게 둔다.

- `fire-once`: 여러 occurrence가 밀렸을 때 가장 최근 due occurrence 하나만
  dispatch한다. 기본값이다.
- `fire-all`: 밀린 occurrence를 오래된 순서대로 dispatch하되
  `maxCatchUpOccurrences`로 상한을 둔다.

`skip` policy는 1차 구현에 넣지 않는다. dispatch하지 않은 occurrence를 감사
이력으로 남기는 table 의미가 추가로 필요하기 때문이다.

## Trigger

1차 built-in trigger는 `createIntervalTrigger()`만 제공한다. interval trigger는
`startAt`을 기준으로 `everyMs` 간격의 deterministic occurrence를 계산한다.
calendar cron은 `ScheduleTrigger` contract를 통해 application이 직접 감쌀 수
있고, 별도 cron helper package 또는 optional dependency는 이후 설계에서 추가한다.

`ScheduleTrigger`는 `Date`와 순수 계산으로 동작해야 한다. timezone, DST, calendar
rule 같은 해석은 trigger 구현의 책임이며 scheduler loop가 임의로 보정하지 않는다.

## Locking과 Failure Semantics

scheduler는 두 종류의 중복 방지를 사용한다.

- schedule-level lock: 같은 schedule을 동시에 scan하지 않기 위한 짧은 lock
- occurrence claim: 같은 occurrence를 두 scheduler가 dispatch하지 않기 위한 durable
  compare-and-set

lock TTL은 option으로 받는다. process crash 후 TTL이 지나면 다른 scheduler가
schedule scan 또는 occurrence claim을 회수할 수 있다.

dispatch 실패는 scheduler 실패이고 job 실패가 아니다. queue enqueue 실패나
`BatchRunner.run()` 호출 자체가 throw하면 occurrence는 `failed`가 된다. direct
runner가 정상적으로 `JobExecution`을 만들고 그 execution이 `failed`로 끝나는 경우는
dispatch 성공으로 기록한다. 이후 retry/restart는 기존 runtime과 CLI가 담당한다.

## CLI

CLI command는 기존 command와 같은 injection 방식으로 동작한다.

```bash
nest-batch schedule --once
nest-batch schedule --poll-interval-ms 1000 --scheduler-id scheduler-1
```

`--once`는 `SchedulerLoop.tick()` 한 번만 실행한다. `--once`가 없으면
`runUntilStopped()`로 반복 실행하고 `AbortSignal`로 graceful shutdown한다.

CLI context에는 다음 optional 값을 추가한다.

- `schedules`
- `scheduleStore`
- `schedulerDispatcher`
- `schedulerLoop`

## Nest Integration

`NestBatchModule.forRoot()` option에 scheduler 관련 값을 추가한다.

```ts
NestBatchModule.forRoot({
  storage,
  workQueue,
  schedules: [billingSchedule],
  scheduleStore,
  scheduler: {
    autoStart: false,
    pollIntervalMs: 1_000,
    ownerId: "billing-scheduler"
  }
});
```

1차 구현에서 `autoStart` 기본값은 `false`다. Nest application lifecycle에서
scheduler를 자동 실행하려면 사용자가 명시해야 한다. 자동 실행이 켜진 경우
`OnApplicationBootstrap`에서 loop를 시작하고 `OnApplicationShutdown`에서
`AbortController`를 abort한다.

## Test Strategy

unit test는 `@nest-batch/scheduler-core`에서 fake clock, fake lock manager,
fake schedule store, fake dispatcher로 작성한다.

필수 test:

- due occurrence를 claim하고 dispatcher를 호출한다.
- schedule-level lock을 얻지 못하면 dispatch하지 않는다.
- 같은 occurrence claim이 실패하면 dispatch하지 않는다.
- `fire-once`는 밀린 occurrence 중 최신 하나만 dispatch한다.
- `fire-all`은 오래된 occurrence부터 `maxCatchUpOccurrences`까지 dispatch한다.
- dispatch 성공은 occurrence를 `dispatched`로 기록한다.
- dispatch 실패는 occurrence를 `failed`로 기록하고 다음 occurrence 처리를 막지 않는다.
- `AbortSignal`이 abort되면 새 occurrence dispatch를 시작하지 않는다.

adapter test는 Postgres/MySQL/MariaDB fake driver test로 SQL 의미를 고정하고,
e2e는 최소 Postgres와 Redis queue 조합으로 scheduler가 queue work를 enqueue하고
worker가 job을 실행하는 흐름을 검증한다.

## Documentation

README와 README-kr에서 다음을 갱신한다.

- `production scheduling is not implemented yet` 문구 제거
- scheduler package 목록 추가
- direct runner scheduling과 queue scheduling의 차이 설명
- at-least-once dispatch와 writer idempotency 주의 추가
- CLI `schedule` command 예제 추가

`docs/architecture.md`에는 scheduler가 execution 생성 또는 enqueue만 담당하고,
job execution source of truth는 repository라는 원칙을 추가한다.

## Self Review

- placeholder는 없다.
- 1차 구현과 이후 확장 범위를 분리했다.
- scheduler가 runtime, queue, Nest, SQL adapter 경계를 침범하지 않는다.
- failure 의미는 scheduler dispatch 실패와 runtime job 실패를 구분한다.
- public API 초안은 현재 export 구조와 package boundary에 맞춰져 있다.
