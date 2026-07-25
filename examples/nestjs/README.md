# NestJS Example

이 예제는 `@nest-batch/nest`와 `@nest-batch/core`를 함께 사용하는 Nest project
구조를 보여줍니다.

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

checkpoint는 reader cursor나 chunk 안전 경계이고, durable execution context는
`storage.executionContextStore`에 저장하는 별도 JSON metadata입니다. restart할 때
runner는 failed execution의 checkpoint를 읽고 새 execution id로 다시 저장하지만,
외부 writer side effect는 at-least-once 실행을 고려해 idempotent하게 처리해야 합니다.
