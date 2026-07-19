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

`import-users.step.ts`는 `Reader`, `Processor`, `Writer` class 구현체를 만든 뒤
`defineChunkStep`에서 조립합니다. 아직 durable execution을 직접 실행하지는
않습니다.
