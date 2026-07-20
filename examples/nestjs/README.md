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
```

`BillingModule`은 `@BatchReader`, `@BatchProcessor`, `@BatchWriter`가 붙은
`Reader`, `Processor`, `Writer` class를 provider로 등록하고, factory
provider에서 core `defineChunkStep`으로 chunk step을 조립합니다.
`BillingJob`은 `@BatchJob`, `@BatchStep` decorator로 Nest-facing metadata를 붙입니다.
Nest provider는 singleton으로 재사용될 수 있으므로 `Reader` instance field에
cursor나 offset을 저장하지 않고, `open()`이 반환하는 `ReaderSession` 안에서
실행 상태를 관리합니다.

현재 repository는 scaffold 단계입니다. decorator discovery와 durable runtime
execution은 아직 구현되지 않았으므로, 이 예제는 실제 실행 엔진보다 module/provider
구조와 public API 사용법을 고정하는 목적입니다.
