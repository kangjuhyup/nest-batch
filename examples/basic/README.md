# Basic Example

이 예제는 Nest 없이 `@nest-batch/core`만 사용하는 programmatic project 구조를
보여줍니다.

```text
src/
  main.ts
  jobs/
    import-users/
      import-users.job.ts
      import-users.step.ts
      import-users.types.ts
```

`defineChunkStep`으로 chunk step을 정의하지만, 아직 durable execution을 직접
실행하지는 않습니다.
