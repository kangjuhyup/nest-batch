# NestJS Example

이 예제는 `@nest-batch/nest`와 `@nest-batch/core`를 함께 사용하는 Nest project
구조를 보여줍니다.

```text
src/
  main.ts
  app.module.ts
  infrastructure/
    batch/
      example-batch-storage.ts
  jobs/
    billing/
      billing.module.ts
      billing.job.ts
      billing.step.ts
      billing.tokens.ts
      billing.types.ts
```

`BillingModule`은 core `defineChunkStep`으로 만든 chunk step을 provider로 등록하고,
`BillingJob`은 `@BatchJob`, `@BatchStep` decorator로 Nest-facing metadata를
붙입니다.

현재 repository는 scaffold 단계입니다. decorator discovery와 durable runtime
execution은 아직 구현되지 않았으므로, 이 예제는 실제 실행 엔진보다 module/provider
구조와 public API 사용법을 고정하는 목적입니다.
