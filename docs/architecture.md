# 아키텍처

`nest-batch`는 런타임 책임으로 나뉩니다. 소스 모듈 경계와 npm 배포 경계는
의도적으로 다릅니다. queue, scheduler, polling, worker 소스 모듈은
`@rv-nest-batch/core` 안에 두고 명시적인 subpath API로 배포합니다. 이 방식은
소비자가 별도 package를 설치하지 않아도 framework에 독립적인 경계를 확인하게
합니다.

## `@rv-nest-batch/core`

Core는 프레임워크에 독립적인 contract와 helper를 담습니다. NestJS, database
client, queue client, CLI framework를 import해서는 안 됩니다.

Core의 책임은 다음과 같습니다.

- job과 step 정의
- tasklet step과 chunk step contract
- reader session contract와 범용 reader helper
- job instance, execution identifier, status type
- repository와 checkpoint contract
- lock manager contract
- 기본 순차 batch runner
- batch lifecycle event observer contract
- step execution counter
- runner가 사용하는 option

Core subpath는 다음 소스 모듈 경계를 담당합니다.

- `@rv-nest-batch/core/queue`: queue에 독립적인 `WorkQueue` contract와 `WorkerLoop`.
- `@rv-nest-batch/core/scheduler`: code-defined schedule, UTC calendar trigger,
  trigger 평가, occurrence claim, `BatchRunner` 또는 `WorkQueue`로의 dispatch를
  담당합니다. job 실행 의미, database client 생성, queue 구현 세부 사항, NestJS
  lifecycle 정책은 담당하지 않습니다.
- `@rv-nest-batch/core/polling`: Transactional Outbox dispatch처럼 tick마다 batch
  metadata를 만들면 안 되는 작업을 위한 continuous polling task contract와
  long-lived loop를 담당합니다. task의 `runOnce` callback에 `workerId`와
  `AbortSignal`을 전달하고, 처리할 work가 있으면 sleep 없이 이어서 처리하며,
  idle일 때만 대기합니다. worker/system error는 제한된 exponential backoff와
  jitter를 적용해 재시도합니다. outbox message 상태, retry/backoff 정책,
  dead-letter 정책, lease token, aggregate ordering, 수평 확장 조정은 application
  또는 adapter의 책임으로 남습니다.
- `@rv-nest-batch/core/worker`: local 및 worker-thread `WorkerPool` 구현.

## `@rv-nest-batch/nest`

Nest integration은 module API, decorator, discovery, lifecycle integration을
담습니다. `@rv-nest-batch/core`에 의존하지만 core는 NestJS에 의존하지 않습니다.
`NestBatchPollingModule`은 polling 전용 integration 경로입니다.
`@rv-nest-batch/core/polling`에 의존하고 `DatabaseBatchStorage`를 요구하지 않으며,
repository, checkpoint, lock, schedule, `BatchRunner` provider를 생성하지
않습니다. 일반 batch job integration이 이미 필요한 process에서는 호환성을 위해
`NestBatchModule`이 계속 `pollingWorkers`를 받을 수 있습니다.

## `@rv-nest-batch/inmemory`

in-memory package는 core repository, checkpoint, lock contract의 비영속 구현을
담습니다. example-local test support가 아니라 adapter package가 소유하므로,
example app 안에 storage 동작을 넣지 않고 examples와 unit test가 같은 contract
구현을 공유할 수 있습니다.

## `@rv-nest-batch/postgres`

Postgres package는 driver 기반 job/step execution repository, lock 관리,
checkpoint storage를 담습니다. `pg`를 사용하며 Postgres connection과 schema
option은 adapter package 내부에 두고, Nest integration 또는 programmatic runtime
wiring에 사용할 `PostgresBatchStorage`를 노출합니다.

## `@rv-nest-batch/mysql`

MySQL package는 driver 기반 job/step execution repository, lock 관리,
checkpoint storage를 담습니다. `mysql2/promise`를 사용하며 MySQL connection과
database option은 adapter package 내부에 두고, Nest integration 또는
programmatic runtime wiring에 사용할 `MySqlBatchStorage`를 노출합니다.

## `@rv-nest-batch/mariadb`

MariaDB package는 driver 기반 job/step execution repository, lock 관리,
checkpoint storage를 담습니다. `mariadb` driver를 사용하며 MariaDB connection과
database option은 adapter package 내부에 두고, Nest integration 또는
programmatic runtime wiring에 사용할 `MariaDbBatchStorage`를 노출합니다.

## `@rv-nest-batch/bullmq`

BullMQ package는 BullMQ queue와 worker를 `@rv-nest-batch/core/queue`의 `WorkQueue`
contract에 맞춥니다. BullMQ client 세부 사항은 이 package가 담당하고, queue에
독립적인 worker-loop 동작은 core에 남습니다.

## `@rv-nest-batch/cli`

CLI package는 `run`, `status`, `retry`, `list` 같은 운영 command를 담당합니다.
core contract에 의존하며 application bootstrap이 `DatabaseBatchStorage`와 등록된
`JobDefinition` 값을 주입한다고 가정합니다. database client 생성과 job discovery는
담당하지 않습니다.

## 런타임 제약

런타임 작업은 failure와 restart를 정상 경로로 다뤄야 합니다.

- `JobInstance`는 job name과 안정적인 parameters hash로 식별합니다.
- `JobExecution`은 하나의 job instance에 대한 구체적인 실행 시도입니다.
- job-instance lock과 repository의 active-state 조회로 중복 active execution을 막습니다.
- durable repository는 instance 생성, active execution 감지, execution 생성을 atomic하게
  처리할 수 있도록 `createExecutionAttempt`를 노출합니다.
- restart orchestration은 같은 job instance의 최신 failed execution에서 시작해야 합니다.
- restart는 이전에 completed된 step execution을 건너뛰고, 첫 failed 또는 누락된 step부터
  재개합니다.
- step execution은 checkpoint를 저장할 수 있습니다.
- job, step, retry, skip, chunk write lifecycle event는 execution 의미를 바꾸지 않고
  관찰할 수 있습니다.
- cancellation에는 `AbortSignal`을 사용합니다.
- chunk step reader는 execution마다 하나의 `ReaderSession`을 열고 item은
  `AsyncIterable`로 제공합니다.
- reader provider instance는 stateless해야 하며, execution별 cursor 또는 offset 상태는
  `ReaderSession`에 속합니다.
- step 수준 checkpoint callback은 `ReaderSession.checkpoint()`보다 우선합니다.
- checkpoint는 writer가 성공한 뒤 chunk boundary에서 저장합니다.
- ORM 전용 reader는 `@rv-nest-batch/core`가 아닌 ORM integration package에 둡니다.
- chunk retry 정책은 processor와 writer failure를 다루며, 현재 skip 정책은 processor
  failure에만 적용합니다.
- distributed execution은 at-least-once 전달을 전제로 합니다.
- scheduler dispatch는 at-least-once이며 결정적인 occurrence id를 사용합니다.
- scheduler failure에는 job failure가 아니라 dispatch failure를 기록합니다.
- scheduler trigger boundary는 아직 claim된 occurrence state가 아니라 terminal
  occurrence state를 기준으로 전진합니다.
- scheduler lifecycle event는 dispatch 의미를 바꾸지 않고 관찰할 수 있습니다.
- schedule 정의는 application code에 두고 durable store는 occurrence state를 저장합니다.
- continuous polling worker는 polling tick마다 `JobExecution`, `StepExecution`,
  checkpoint, schedule occurrence metadata를 만들지 않습니다.
- polling worker lifecycle event는 task 실행 의미를 바꾸지 않고 관찰할 수 있습니다.
- polling worker shutdown에는 `AbortSignal`을 사용합니다. idle sleep은 즉시 abort하고
  graceful shutdown을 위해 진행 중인 task 작업은 완료될 때까지 기다립니다.
- polling 전용 Nest application은 `NestBatchPollingModule`을 사용하며 batch storage,
  lock, checkpoint, schedule, runner provider가 필요하지 않습니다.
- polling task는 `AbortSignal`을 dispatcher와 publisher 계층으로 전달해야 합니다.
  signal을 지원하지 않는 publish client에는 task가 소유하는 hard timeout이 필요합니다.
- SQL adapter lock은 `ownerId`, `acquiredAt`, 선택적인 `expiresAt`을 저장하며 stale lock
  recovery는 TTL을 기준으로 합니다.
- idempotency 기대치는 job parameter와 retry 동작 가까이에 문서화합니다.
- scheduler는 runtime을 우회하지 않고 execution을 만들거나 enqueue합니다.
