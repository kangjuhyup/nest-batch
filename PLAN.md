# Context Propagation Implementation Plan

**Goal:** job 실행 정보와 job parameters를 tasklet, chunk reader, processor, writer, retry/skip policy, checkpoint callback, partition handler까지 일관되게 전달한다. checkpoint와 durable execution context는 역할을 분리해 restart 의미를 명확히 유지한다.

**Architecture:** `@nest-batch/core`에 framework-independent context contract를 둔다. NestJS decorator나 DI 정보는 `@nest-batch/nest`에서만 다룬다. SQL adapter는 context 저장이 필요한 단계에서 core repository contract를 구현한다.

## Global Constraints

- `@nest-batch/core`는 NestJS, database client, queue client에 의존하지 않는다.
- 기존 `input`, `signal`, `checkpoint` 기반 callback은 가능한 한 source-compatible하게 유지한다.
- `checkpoint`는 reader cursor와 chunk safety boundary를 위한 값으로 유지한다.
- durable execution context는 JSON-serializable 값만 저장한다.
- restart 시 어떤 execution의 checkpoint/context를 읽고, 새 execution에 언제 다시 쓰는지 테스트로 고정한다.
- 테스트 설명은 `English / 한국어` 형식을 유지한다.

## Target Model

```text
JobExecutionContext
  StepExecutionContext
    TaskletStepExecutionContext
    ChunkStepExecutionContext
      ChunkItemContext
      ChunkWriteContext
      ChunkCheckpointContext
    PartitionExecutionContext
```

context는 두 종류로 나눈다.

- Runtime context: `jobName`, `jobExecutionId`, `stepName`, `stepExecutionId`, `parameters`, `signal`, `checkpoint`, `restart`처럼 실행 중 callback에 read-only로 전달되는 값.
- Durable execution context: step 간 공유하거나 restart 후 복원해야 하는 JSON metadata. checkpoint와 별도 contract로 다룬다.

## Task 1: 현재 Context 주입 경로 정리

**Files:**
- Modify: `packages/core/src/types/step.ts`
- Modify: `packages/core/src/types/partitioned-step.ts`
- Modify: `packages/core/src/runner/step-run-context.ts`
- Test: `packages/core/test/runner.test.ts`

**Produces:** 현재 callback별 context 차이를 테스트로 고정한다.

- [x] `tasklet`, `reader`, `processor`, `writer`, `checkpoint`, `retryPolicy`, `skipPolicy`, `partition execute`가 받는 context 필드를 표로 정리한다.
- [x] 현재 `input`, `signal`, `checkpoint` 전달 동작을 깨지 않는 회귀 테스트를 추가한다.
- [x] job parameters가 step callback에 직접 전달되지 않는 현재 한계를 테스트 또는 TODO 주석으로 명확히 남긴다.

## Task 2: Read-only Runtime Context 타입 추가

**Files:**
- Create: `packages/core/src/types/context.ts`
- Modify: `packages/core/src/types/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/types/step.ts`
- Modify: `packages/core/src/types/partitioned-step.ts`

**Produces:** public context contract.

- [x] `JobRuntimeContext<Parameters>` 타입을 추가한다.
- [x] `StepRuntimeContext<Parameters, TCheckpoint>` 타입을 추가한다.
- [x] `TaskletStepExecutionContext`, `ChunkStepExecutionContext`, `PartitionExecutionContext`가 공통 runtime context를 확장하게 정리한다.
- [x] context에 포함할 최소 필드를 확정한다: `jobName`, `jobExecutionId`, `stepName`, `stepExecutionId`, `parameters`, `signal`, `checkpoint`, `restart`.
- [x] `stepIndex`는 public context에 노출할지 내부 runner 전용으로 유지할지 결정한다.

## Task 3: Runner에서 Context 생성과 전달 구현

**Files:**
- Modify: `packages/core/src/runner/default-batch-runner.ts`
- Modify: `packages/core/src/runner/step-run-context.ts`
- Modify: `packages/core/src/runner/tasklet-step-runner.ts`
- Modify: `packages/core/src/runner/chunk-step-runner.ts`
- Modify: `packages/core/src/runner/partitioned-step-runner.ts`
- Test: `packages/core/test/runner.test.ts`

**Produces:** 모든 step callback에 같은 job/step metadata와 parameters가 전달된다.

- [x] `DefaultBatchRunner`가 parsed job parameters를 `StepRunContext`에 넣도록 변경한다.
- [x] tasklet `execute()`에서 `context.parameters`, `context.jobExecutionId`, `context.stepName`을 읽을 수 있게 한다.
- [x] chunk reader open/read context에 `parameters`와 execution metadata를 전달한다.
- [x] processor, writer, retry, skip, checkpoint callback이 같은 runtime context를 공유하게 한다.
- [x] partition handler context에도 `parameters`, `jobExecutionId`, `stepExecutionId`, `partitionExecutionId`를 전달한다.
- [x] restart 실행에서 `restart: true`와 `checkpoint`가 함께 전달되는지 검증한다.

## Task 4: 타입 호환성과 Generic 개선

**Files:**
- Modify: `packages/core/src/definitions.ts`
- Modify: `packages/core/src/types/job.ts`
- Modify: `packages/core/src/types/step.ts`
- Modify: `packages/core/src/types/partitioned-step.ts`
- Test: `packages/core/test/type-compatibility.test.ts`

**Produces:** job parameters 타입이 step context까지 자연스럽게 이어진다.

- [x] `JobDefinition<Parameters>`의 `Parameters` 타입을 step context로 전달할 수 있는 generic 구조를 검토한다.
- [x] 기존 `defineStep<Input, Output>()`, `defineChunkStep<Input, Output, TCheckpoint>()` 호출이 과도하게 복잡해지지 않게 overload를 유지한다.
- [x] 사용자가 명시 타입을 주지 않아도 기본 `JobParameters`로 동작하게 한다.
- [x] public export 변경 후 `tsc -b`로 downstream 타입 오류를 확인한다.

## Task 5: Durable Execution Context Contract 설계

**Files:**
- Modify: `packages/core/src/types/repository.ts`
- Modify: `packages/core/src/types/storage.ts`
- Test: `packages/core/test/execution-context-store.test.ts`

**Produces:** checkpoint와 분리된 durable context 저장 contract 초안.

- [x] `ExecutionContextStore`를 별도 contract로 둘지, `JobRepository`에 포함할지 결정한다.
- [x] 저장 key를 `jobExecutionId + scope + name` 형태로 둘지, `stepExecutionId` 중심으로 둘지 결정한다.
- [x] `read`, `write`, `delete`, `merge` 중 필요한 최소 API를 정한다.
- [x] JSON-serializable 값만 허용하고 `undefined` 처리 규칙을 정한다.
- [x] checkpoint와 durable context의 책임 차이를 README 또는 docs에 설명할 기준을 정한다.

## Task 6: In-memory Execution Context Store 구현

**Files:**
- Modify: `packages/inmemory/src/storage.ts`
- Create: `packages/inmemory/src/execution-context-store.ts`
- Test: `packages/inmemory/test/storage.test.ts`

**Produces:** core runtime 테스트에서 사용할 durable context store.

- [x] `InMemoryExecutionContextStore`를 추가한다.
- [x] restart 시 이전 failed execution context를 읽고 새 execution에서 이어 쓸 수 있는지 테스트한다.
- [x] context 값이 checkpoint와 독립적으로 삭제/갱신되는지 테스트한다.

## Task 7: SQL Execution Context Store 구현

**Files:**
- Modify: `packages/postgres/src/schema.ts`
- Modify: `packages/mysql/src/schema.ts`
- Modify: `packages/mariadb/src/schema.ts`
- Modify: `packages/postgres/src/sql.ts`
- Modify: `packages/mysql/src/sql.ts`
- Modify: `packages/mariadb/src/sql.ts`
- Create: `packages/postgres/src/execution-context-store.ts`
- Create: `packages/mysql/src/execution-context-store.ts`
- Create: `packages/mariadb/src/execution-context-store.ts`
- Test: `packages/postgres/test/adapter.test.ts`
- Test: `packages/mysql/test/adapter.test.ts`
- Test: `packages/mariadb/test/adapter.test.ts`

**Produces:** database-backed restart-safe execution context.

- [x] `nest_batch_execution_contexts` 테이블 스키마를 확정한다.
- [x] Postgres는 `JSONB`, MySQL/MariaDB는 `JSON`으로 저장한다.
- [x] upsert와 delete 동작을 adapter별로 구현한다.
- [x] restart 시 context 복원 동작을 DB adapter matrix로 검증한다.
- [x] `DATABASE.md` ERD와 테이블 설명을 갱신한다.

## Task 8: Nest Decorator/Provider Context 연동

**Files:**
- Modify: `packages/nest/src/*`
- Test: `packages/nest/test/module.test.ts`
- Test: `examples/nestjs/test/nestjs-example.e2e.test.ts`

**Produces:** Nest 사용자가 job parameters와 execution metadata를 자연스럽게 참조할 수 있는 경로.

- [x] decorator 기반 step method에 core context가 그대로 전달되는지 확인한다.
- [x] `BatchContext` injection helper는 추가하지 않고 core callback context를 그대로 사용하기로 결정한다.
- [x] request-scoped provider처럼 보이는 API를 만들지 않고 batch execution scoped 값으로 다루기로 결정한다.
- [x] Nest example에서 `context.parameters`를 사용하는 예제를 추가한다.

## Task 9: 문서와 예제 갱신

**Files:**
- Modify: `README.md`
- Modify: `README-kr.md`
- Modify: `examples/basic/README.md`
- Modify: `examples/nestjs/README.md`

**Produces:** 사용자가 context와 checkpoint를 혼동하지 않도록 하는 public 문서.

- [x] tasklet에서 `context.parameters`를 사용하는 예제를 추가한다.
- [x] chunk reader/processor/writer에서 runtime context를 사용하는 예제를 추가한다.
- [x] checkpoint와 durable execution context의 차이를 설명한다.
- [x] restart 시 context가 복원되는 범위와 writer idempotency 주의점을 문서화한다.

## Verification Matrix

기본 검증:

```bash
./node_modules/.bin/vitest run packages/core/test/runner.test.ts
./node_modules/.bin/vitest run packages/inmemory/test/storage.test.ts
./node_modules/.bin/tsc -b
```

SQL context store 변경 포함 시:

```bash
docker compose up -d postgres mysql mariadb
./node_modules/.bin/vitest run packages/postgres/test/adapter.test.ts packages/mysql/test/adapter.test.ts packages/mariadb/test/adapter.test.ts
```

Nest 연동 변경 포함 시:

```bash
./node_modules/.bin/vitest run packages/nest/test/module.test.ts examples/nestjs/test/nestjs-example.e2e.test.ts
```

## Execution Order

1. 현재 context 전달 동작을 테스트로 고정한다.
2. read-only runtime context 타입을 추가한다.
3. runner 전체에 runtime context 생성을 연결한다.
4. generic과 public export를 정리한다.
5. checkpoint와 분리된 durable execution context contract를 설계한다.
6. in-memory store로 restart 의미를 먼저 검증한다.
7. SQL adapter store와 schema를 추가한다.
8. Nest integration과 examples를 갱신한다.
9. README와 `DATABASE.md`를 갱신한다.

## Open Design Decisions

- `stepExecutionId`를 chunk reader/processor/writer context에 항상 노출할지, step 시작 이후 callback에만 노출할지 결정해야 한다.
- `restart`를 boolean으로 둘지, `restartFromExecutionId` 같은 metadata를 함께 둘지 결정해야 한다.
- durable execution context를 job scope와 step scope로 나눌지 결정해야 한다.
- context merge API를 제공할지, 명시적 read/write만 허용할지 결정해야 한다.
- job parameters generic을 모든 step definition에 전파할 때 DX가 나빠지지 않는지 검증해야 한다.
