# NestJS Example

이 예제는 `@nest-batch/nest`와 `@nest-batch/core`를 함께 사용하는 Nest project
구조를 보여줍니다.

외부 Nest application에서는 다음 package를 설치합니다.

```bash
npm install @nest-batch/core @nest-batch/nest @nest-batch/inmemory @nestjs/common @nestjs/core reflect-metadata
```

queue, scheduler, polling, worker API는 별도 package가 아니라
`@nest-batch/core/queue`, `@nest-batch/core/scheduler`,
`@nest-batch/core/polling`, `@nest-batch/core/worker`에서 import합니다.

```text
src/
  main.ts
  app.module.ts
  jobs/
    billing/
      billing.module.ts
      billing.job.ts
      billing.step.ts
      billing.tokens.ts
      billing.types.ts
    reader-examples/
      reader-examples.module.ts
      reader-examples.reader.ts
    vote-outbox/
      vote-outbox.module.ts
```

`BillingModule`은 `@BatchReader`, `@BatchProcessor`, `@BatchWriter`가 붙은
`Reader`, `Processor`, `Writer` class를 provider로 등록하고, factory
provider에서 core `defineChunkStep`으로 chunk step을 조립합니다.
`BillingJob`은 `@BatchJob`, `@BatchStep` decorator로 Nest-facing metadata를 붙입니다.
`NestBatchRegistry`는 application bootstrap 시점에 이 provider들을 발견하고,
`NestBatchRunner`는 `"daily-billing"` 이름으로 발견한 job을 실행합니다.
Nest provider는 singleton으로 재사용될 수 있으므로 `Reader` instance field에
cursor나 offset을 저장하지 않고, `open()`이 반환하는 `ReaderSession` 안에서
실행 상태를 관리합니다.
`billing.step.ts`의 reader와 processor는 `BatchContextAccessor`를 주입받아
현재 batch callback의 `parameters`와 `signal`을 읽고, tenant별 account id와
charge payload를 만듭니다. accessor는 `AsyncLocalStorage` 기반이므로 batch
callback 실행 중에만 context를 제공합니다. reader는 `getCheckpoint()`로 이전
`nextIndex` checkpoint를 읽고, `ReaderSession.checkpoint()`로 다음에 읽을 index를
저장합니다.
`ReaderExamplesModule`은 `createIterableReader`, `createFunctionReader`,
`createCursorReader`, `createPagingReader`를 Nest `@BatchReader` provider로 감싼
예제를 제공합니다.

`VoteOutboxModule`은 Transactional Outbox polling worker를 Nest에서 연결하는
예제를 제공합니다. `NestBatchPollingModule.forRootAsync()`가
`IntegrationEventOutboxDispatcher`를 주입받고, `pollingWorkers`에
`autoStart: process.env.NEST_BATCH_PROCESS_ROLE === "vote-outbox-worker"`를
설정합니다. task는 `dispatchBatch({ workerId, signal })`을 호출한 뒤
`claimedCount > 0`을 반환하므로, 처리한 outbox message가 있을 때만 sleep 없이
다음 polling iteration으로 이어집니다. dispatcher는 같은 `AbortSignal`을
`IntegrationEventPublisher.publish()`까지 전달합니다. 실제 publish client가
`AbortSignal`을 지원하지 않으면 dispatcher 계층에서 hard timeout을 둬야 합니다.

checkpoint는 reader cursor나 chunk 안전 경계이고, durable execution context는
`storage.executionContextStore`에 저장하는 별도 JSON metadata입니다. restart할 때
runner는 failed execution의 checkpoint를 읽고 새 execution id로 다시 저장하지만,
외부 writer side effect는 at-least-once 실행을 고려해 idempotent하게 처리해야 합니다.
