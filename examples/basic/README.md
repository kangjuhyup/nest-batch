# Basic Example

이 예제는 Nest 없이 `@rvkang/batch-core`만 사용하는 programmatic project 구조를
보여줍니다.

외부 application에서는 다음 package를 설치합니다.

```bash
npm install @rvkang/batch-core
```

durable runner를 빠르게 검증하는 test fixture가 필요하면
`@rvkang/batch-inmemory`를 함께 설치합니다. queue, scheduler, polling, worker API는
별도 package가 아니라 `@rvkang/batch-core/queue`, `@rvkang/batch-core/scheduler`,
`@rvkang/batch-core/polling`, `@rvkang/batch-core/worker`에서 import합니다.

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
`defineChunkStep`에서 조립합니다. `Reader`는 `open()`에서 실행마다
`ReaderSession`을 만들고, cursor나 offset 같은 실행 상태는 session 안에 둡니다.
아직 durable execution을 직접 실행하지는 않습니다.

tasklet과 chunk callback은 runtime context를 인자로 받습니다. `Reader.open()`은
`parameters`, `signal`, `checkpoint`를 읽을 수 있고, `Processor.process()`와
`Writer.write()`도 같은 job/step execution metadata를 받습니다. 예를 들어 tenant별
입력을 읽어야 한다면 `context.parameters.tenant`를 reader에서 cursor와 함께
사용하고, writer는 `context.jobExecutionId`를 idempotency key에 포함할 수 있습니다.

checkpoint는 reader cursor나 chunk 안전 경계를 저장하는 값이고,
`executionContextStore`의 durable execution context는 step 간 공유 metadata를 위한
별도 JSON store입니다. restart는 checkpoint를 기준으로 재개되므로 외부 write는
중복 실행을 고려해 idempotent하게 설계해야 합니다.
