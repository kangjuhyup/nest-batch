# Chunk Step Reader Processor Writer 설계

날짜: 2026-07-19

## 배경

현재 `@nest-batch/core`의 `StepDefinition`은 `execute(context)` 하나를
가지는 tasklet 방식입니다. 이 형태는 단순 step에는 유용하지만, record를
streaming으로 읽고, item 단위로 처리하고, chunk 단위로 쓰고, checkpoint,
retry, skip을 적용하는 item-oriented batch 작업을 표현하기에는 부족합니다.

이 설계는 기존 tasklet step API를 유지하면서 `core`에 chunk step contract를
추가합니다. `core`는 NestJS, database client, queue client, adapter 구현
세부사항에 의존하지 않아야 한다는 저장소 규칙을 그대로 따릅니다.

## 범위

포함하는 내용:

- `@nest-batch/core`에 chunk step public contract 추가.
- 기존 `defineStep`과 별도인 `defineChunkStep` helper 추가.
- reader는 `AsyncIterable` 중심으로 모델링하고, 작은 in-memory source를 위해
  `Iterable`도 허용.
- processor는 optional로 허용.
- processor-level skip은 명시적인 `SkipItem` 값으로만 표현.
- `null`과 `undefined`는 implicit skip signal이 아니라 유효한 processor output으로 유지.
- chunk boundary, checkpoint write, writer idempotency 기대치를 runtime 의미로 정의.

포함하지 않는 내용:

- 완전한 durable runner 구현.
- retry/skip policy 구현.
- adapter의 실제 checkpoint persistence 구현.
- chunk step을 위한 NestJS decorator discovery.
- SQL schema 또는 migration 변경.

## 패키지 경계

chunk step contract는 framework-independent batch runtime model이므로
`packages/core`에 둡니다. `packages/nest`는 나중에 decorator나 provider 편의
API를 통해 core definition을 만들 수 있지만, `core`가 NestJS에 의존해서는
안 됩니다.

Postgres와 이후 database package는 repository, lock, checkpoint contract를
구현하는 책임을 유지합니다. reader, processor, writer 타입은 database adapter가
소유하지 않습니다.

## 공개 API

`defineChunkStep`을 `defineStep` 옆에 추가합니다.

```ts
import { defineChunkStep, skipItem } from "@nest-batch/core";
import type { ChunkStepExecutionContext, Processor, Reader, Writer } from "@nest-batch/core";

interface SourceUser {
  readonly id: string;
  readonly active: boolean;
}

interface ImportedUser {
  readonly id: string;
}

class UserReader implements Reader<SourceUser> {
  async *read({ signal }: ChunkStepExecutionContext) {
    signal.throwIfAborted();
    yield { id: "user-1", active: true };
  }
}

class UserProcessor implements Processor<SourceUser, ImportedUser> {
  async process(user: SourceUser) {
    if (!user.active) {
      return skipItem("inactive user");
    }

    return { id: user.id };
  }
}

class UserWriter implements Writer<ImportedUser> {
  async write(users: readonly ImportedUser[]) {
    await saveUsers(users);
  }
}

const importUsers = defineChunkStep({
  name: "import-users",
  chunkSize: 100,
  reader: new UserReader(),
  processor: new UserProcessor(),
  writer: new UserWriter()
});
```

processor 없는 chunk step도 유효합니다.

```ts
const copyUsers = defineChunkStep({
  name: "copy-users",
  chunkSize: 100,
  reader,
  writer
});
```

`processor`가 없으면 runtime은 reader item을 그대로 writer에 넘깁니다. 이 경우
`Input`과 `Output`은 같은 타입입니다.

`Reader`, `Processor`, `Writer`는 class가 구현하기 쉬운 method 기반 object
contract로 둡니다. `core`는 class 생성이나 DI를 담당하지 않고, NestJS 같은
integration package가 provider를 조립합니다.

## Core 타입

public contract는 다음 형태에 가깝게 둡니다.

```ts
export interface ChunkStepExecutionContext<TCheckpoint = unknown> {
  readonly signal: AbortSignal;
  readonly checkpoint?: TCheckpoint;
}

export interface ChunkItemContext<Input = unknown, TCheckpoint = unknown>
  extends ChunkStepExecutionContext<TCheckpoint> {
  readonly item: Input;
  readonly index: number;
}

export interface ChunkWriteContext<TCheckpoint = unknown>
  extends ChunkStepExecutionContext<TCheckpoint> {
  readonly chunkIndex: number;
  readonly attempt: number;
}

export interface Reader<Input, TCheckpoint = unknown> {
  read(context: ChunkStepExecutionContext<TCheckpoint>): AsyncIterable<Input> | Iterable<Input>;
}

export interface Processor<Input, Output, TCheckpoint = unknown> {
  process(
    item: Input,
    context: ChunkItemContext<Input, TCheckpoint>
  ): Output | SkipItem | Promise<Output | SkipItem>;
}

export interface Writer<Output, TCheckpoint = unknown> {
  write(items: readonly Output[], context: ChunkWriteContext<TCheckpoint>): void | Promise<void>;
}

export type ChunkReader<Input, TCheckpoint = unknown> = Reader<Input, TCheckpoint>;

export type ChunkProcessor<Input, Output, TCheckpoint = unknown> = Processor<Input, Output, TCheckpoint>;

export type ChunkWriter<Output, TCheckpoint = unknown> = Writer<Output, TCheckpoint>;

export interface TaskletStepDefinition<Input = unknown, Output = unknown> {
  readonly kind?: "tasklet";
  readonly name: string;
  readonly execute: (context: StepExecutionContext<Input>) => Promise<Output> | Output;
}

export interface ChunkStepDefinition<Input = unknown, Output = Input, TCheckpoint = unknown> {
  readonly kind: "chunk";
  readonly name: string;
  readonly chunkSize: number;
  readonly reader: ChunkReader<Input, TCheckpoint>;
  readonly processor?: ChunkProcessor<Input, Output, TCheckpoint>;
  readonly writer: ChunkWriter<Output, TCheckpoint>;
}

export type StepDefinition<Input = unknown, Output = unknown> =
  | TaskletStepDefinition<Input, Output>
  | ChunkStepDefinition<Input, Output>;
```

기존 tasklet step은 계속 유효합니다. `defineStep({ execute })`는 기존과
source-compatible한 tasklet definition을 반환합니다. `JobDefinition`은 계속
`StepDefinition[]`을 받되, 이제 이 타입은 tasklet definition과 chunk definition을
모두 포함합니다.

`defineChunkStep`은 overload 또는 동등한 generic constraint를 사용해 타입 추론을
명확히 해야 합니다. processor 없는 step은 `Output = Input`으로 추론하고,
processor가 있는 step은 processor return type에서 `SkipItem`을 제외한 값을
`Output`으로 추론합니다.

## Skip의 의미

skip은 명시적으로 표현합니다.

```ts
export declare const SKIP_ITEM: unique symbol;

export interface SkipItem {
  readonly kind: "skip";
  readonly reason?: string;
  readonly cause?: unknown;
  readonly [SKIP_ITEM]: true;
}

export const skipItem = (reason?: string, cause?: unknown): SkipItem => ({
  kind: "skip",
  reason,
  cause,
  [SKIP_ITEM]: true
});
```

`null`과 `undefined`는 skip signal이 아닙니다. processor가 nullable data를
의도적으로 writer에 넘길 수 있도록 유효한 output 값으로 유지합니다. runtime은
`SkipItem` brand로만 skip 여부를 판단합니다.

이 판단은 truthiness나 단순한 `{ kind: "skip" }` object shape에 의존하지 않고,
`isSkipItem` 함수로 명시합니다.

## Runtime 흐름

chunk step runner는 다음 순서를 따릅니다.

1. step execution을 running 상태로 기록합니다.
2. step의 최신 checkpoint를 읽습니다.
3. 복원된 checkpoint와 `AbortSignal`로 reader를 생성합니다.
4. `for await` 기반으로 reader에서 item을 가져와 backpressure를 유지합니다.
5. 각 item에 processor가 있으면 processor를 호출합니다.
6. processor가 `SkipItem`을 반환하면 skip counter를 증가시키고 pending write
   chunk에는 추가하지 않습니다.
7. processor가 없으면 reader item을 그대로 pending write chunk에 추가합니다.
8. accepted output이 `chunkSize`만큼 모이면 writer를 한 번 호출합니다.
9. writer 성공 후 완료된 chunk boundary 기준으로 counter와 checkpoint를 저장합니다.
10. reader가 정상 완료되면 남은 output을 flush하고 step을 completed로 기록합니다.

runtime은 새 chunk를 시작하기 전과 writer 호출 전에 `signal.throwIfAborted()`를
확인해야 합니다. graceful shutdown 중에는 cancellation 이후 새 chunk를 시작하지
않습니다. writer가 이미 실행 중이면 writer가 resolve 또는 reject된 뒤 최종 상태를
기록합니다.

## Checkpoint와 Restart

checkpoint는 writer 호출이 성공한 뒤에만 저장합니다. 이 기준은 restart boundary를
보수적으로 만들고 at-least-once 의미를 명확하게 유지합니다.

reader cursor state와 일반 execution context는 나중에 분리할 수 있지만, chunk step
contract는 시작부터 복원된 checkpoint를 reader에 전달해야 합니다. 이후 구현에서
checkpoint update hook을 추가하더라도 reader, processor, writer의 기본 구조는
바꾸지 않아야 합니다.

writer success가 commit boundary이므로, 외부 시스템에 부분 성공이 가능한 writer는
idempotent해야 합니다. 문서에서는 job execution id, step name, chunk index, 가능한
경우 item identity를 기반으로 안정적인 idempotency key를 만들도록 권장해야 합니다.

## 오류 처리

reader 오류는 future policy가 별도로 처리하지 않는 한 step failure로 기록합니다.

processor 오류는 명시적 skip과 다릅니다. processor가 throw한 error는 skip이
아니며, future retry/skip policy에 따라 retry 또는 failure 대상이 됩니다.

writer 오류는 현재 chunk failure입니다. checkpoint는 writer 성공 이후에만
저장되므로 restart 시 실패한 chunk를 다시 읽고 다시 처리할 수 있습니다. 이 때문에
chunk step 사용 문서에서 writer idempotency를 명확히 설명해야 합니다.

## 테스트

초기 테스트는 public contract와 helper 동작을 검증합니다.

- `defineChunkStep`이 `defineStep`처럼 step name을 trim하고 definition을 freeze하는지.
- blank chunk step name을 거부하는지.
- 유효하지 않은 `chunkSize`를 거부하는지.
- processor 없는 chunk step을 정의할 수 있는지.
- processor step이 `skipItem()`을 반환할 수 있는지.
- `isSkipItem`이 명시적인 skip value만 인식하는지.
- `null`과 `undefined`를 skip value로 취급하지 않는지.
- `@nest-batch/core`가 새 public type과 helper를 export하는지.

이후 runtime 테스트는 정상 완료, processor skip, writer failure와 restart,
checkpoint restore, cancellation, retry exhausted, skip limit exceeded를 다룹니다.

## 문서 영향

helper 구현 후 root README에는 기존 tasklet 예제를 유지하면서 짧은 chunk step
예제를 추가합니다. `docs/architecture.md`에는 `core`가 tasklet step contract와
chunk step contract를 모두 소유한다는 점을 명시합니다.

runner, repository, checkpoint, policy 구현이 준비되기 전까지 예제가 durable
execution이 이미 완성된 것처럼 보이게 쓰지 않습니다.

## 승인 기준

- `defineChunkStep`은 `defineStep`과 별도 helper입니다.
- reader contract는 `AsyncIterable`과 `Iterable`을 지원합니다.
- processor는 optional입니다.
- skip은 명시적인 `skipItem()` value로만 표현합니다.
- `null`과 `undefined`는 유효한 output입니다.
- 기존 tasklet step 사용법은 source-compatible하게 유지됩니다.
- public export에 새 chunk step type과 helper가 포함됩니다.
- 테스트는 helper validation과 명시적 skip 의미를 검증합니다.
