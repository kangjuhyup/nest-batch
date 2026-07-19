# Chunk Step Reader Processor Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@nest-batch/core`에 `defineChunkStep`, `AsyncIterable` reader, optional processor, 명시적 `SkipItem` 기반 chunk step public contract를 추가한다.

**Architecture:** 기존 `defineStep({ execute })` tasklet API는 source-compatible하게 유지한다. 새 chunk step contract는 `packages/core`에만 추가하고, `StepDefinition`은 tasklet과 chunk step을 모두 표현하는 union으로 확장한다. 실제 durable runner, retry/skip policy, adapter persistence는 이 계획의 범위에 넣지 않는다.

**Tech Stack:** TypeScript `NodeNext`, pnpm, Vitest, `@nest-batch/core` public exports.

## Global Constraints

- `@nest-batch/core`는 NestJS, database client, queue client, CLI framework에 의존하지 않는다.
- reader contract는 `AsyncIterable`을 우선 지원하고, 작은 in-memory source를 위해 `Iterable`도 지원한다.
- processor는 optional이다.
- skip은 `skipItem()`이 만든 branded `SkipItem`으로만 표현한다.
- `null`과 `undefined`는 skip signal이 아니라 유효한 output이다.
- 기존 `defineStep({ execute })` 사용법과 기존 테스트는 깨지면 안 된다.
- 테스트 설명은 `English / 한국어` 형식으로 작성한다.
- 설계 문서와 spec 문서는 한국어로 작성한다. 코드, public API 이름, npm package 이름, 타입 이름은 영어로 유지한다.
- 각 task 시작 전 `git status --short`로 선행 변경을 확인한다. 선행 변경이 있으면 되돌리지 말고, 커밋 시 이번 작업에서 수정한 hunk만 포함한다.

---

## File Structure

수정하거나 확인할 파일:

- Modify: `packages/core/src/types.ts`
  - tasklet step과 chunk step public type을 분리하고 `StepDefinition` union을 만든다.
  - `ChunkReader`, `ChunkProcessor`, `ChunkWriter`, context type, `SkipItem` type을 추가한다.
- Modify: `packages/core/src/definitions.ts`
  - 기존 `defineStep`과 `defineJob`은 유지한다.
  - `defineChunkStep`, `skipItem`, `isSkipItem`을 추가한다.
  - `chunkSize` positive integer validation을 추가한다.
- Modify: `packages/core/src/index.ts`
  - 새 helper와 public type을 export한다.
- Modify: `packages/core/test/definitions.test.ts`
  - chunk step 정의, processor 없는 step, explicit skip, nullable output, validation을 검증한다.
- Modify: `README.md`
  - helper 구현 후 짧은 chunk step 예제를 추가한다. 기존 선행 변경을 먼저 읽고 보존한다.
- Modify: `docs/architecture.md`
  - `core`가 tasklet step과 chunk step contract를 모두 소유한다는 점을 추가한다. 기존 선행 변경을 먼저 읽고 보존한다.

---

### Task 1: Core Chunk Step Contract

**Files:**
- Modify: `packages/core/test/definitions.test.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/definitions.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes:
  - `defineStep<Input, Output>(definition: TaskletStepDefinition<Input, Output>)`
  - `defineJob<Parameters>(definition: JobDefinition<Parameters>)`
- Produces:
  - `defineChunkStep<Input, TCheckpoint>(definition: ChunkStepWithoutProcessorOptions<Input, TCheckpoint>): ChunkStepDefinition<Input, Input, TCheckpoint>`
  - `defineChunkStep<Input, Output, TCheckpoint>(definition: ChunkStepWithProcessorOptions<Input, Output, TCheckpoint>): ChunkStepDefinition<Input, Output, TCheckpoint>`
  - `skipItem(reason?: string, cause?: unknown): SkipItem`
  - `isSkipItem(value: unknown): value is SkipItem`
  - `SKIP_ITEM: unique symbol`
  - `ChunkStepExecutionContext<TCheckpoint>`
  - `ChunkItemContext<Input, TCheckpoint>`
  - `ChunkWriteContext<TCheckpoint>`
  - `ChunkReader<Input, TCheckpoint>`
  - `ChunkProcessor<Input, Output, TCheckpoint>`
  - `ChunkWriter<Output, TCheckpoint>`
  - `TaskletStepDefinition<Input, Output>`
  - `ChunkStepDefinition<Input, Output, TCheckpoint>`
  - `StepDefinition<Input, Output>` union

- [ ] **Step 1: 실패 테스트 작성**

`packages/core/test/definitions.test.ts`를 다음 내용으로 바꾼다.

```ts
import { describe, expect, it } from "vitest";
import { defineChunkStep, defineJob, defineStep, isSkipItem, skipItem } from "../src/index.js";

describe("core definitions / core 정의", () => {
  it("defines a job with ordered steps without NestJS / NestJS 없이 순서가 있는 step으로 job을 정의한다", async () => {
    const step = defineStep({
      name: "load-users",
      async execute({ input }) {
        return String(input ?? "none");
      }
    });

    const job = defineJob({
      name: "daily-user-import",
      steps: [step]
    });

    await expect(step.execute({ input: 42, signal: new AbortController().signal })).resolves.toBe("42");
    expect(job.name).toBe("daily-user-import");
    expect(job.steps).toHaveLength(1);
    expect(job.steps[0]).toBe(step);
  });

  it("defines a chunk step without a processor / processor 없이 chunk step을 정의한다", async () => {
    const written: Array<readonly { id: string }[]> = [];

    const step = defineChunkStep({
      name: " copy-users ",
      chunkSize: 2,
      reader: async function* () {
        yield { id: "user-1" };
        yield { id: "user-2" };
      },
      writer(items) {
        written.push([...items]);
      }
    });

    const job = defineJob({
      name: "copy-users-job",
      steps: [step]
    });

    await step.writer([{ id: "user-1" }, { id: "user-2" }], {
      attempt: 1,
      chunkIndex: 0,
      signal: new AbortController().signal
    });

    expect(step.kind).toBe("chunk");
    expect(step.name).toBe("copy-users");
    expect(step.chunkSize).toBe(2);
    expect(Object.isFrozen(step)).toBe(true);
    expect(job.steps[0]).toBe(step);
    expect(written).toEqual([[{ id: "user-1" }, { id: "user-2" }]]);
  });

  it("defines a chunk step with a processor and explicit skip / processor와 명시적 skip이 있는 chunk step을 정의한다", async () => {
    const step = defineChunkStep({
      name: "filter-users",
      chunkSize: 10,
      reader: function* () {
        yield { id: "user-1", active: false };
      },
      processor(user) {
        if (!user.active) {
          return skipItem("inactive user");
        }

        return { id: user.id };
      },
      writer() {
        return undefined;
      }
    });

    const result = await step.processor?.(
      { id: "user-1", active: false },
      {
        index: 0,
        item: { id: "user-1", active: false },
        signal: new AbortController().signal
      }
    );

    expect(isSkipItem(result)).toBe(true);
    expect(result).toMatchObject({ kind: "skip", reason: "inactive user" });
  });

  it("keeps null and undefined as valid processor outputs / null과 undefined를 유효한 processor output으로 유지한다", async () => {
    const nullableStep = defineChunkStep<{ id: string }, null>({
      name: "nullable-users",
      chunkSize: 1,
      reader: function* () {
        yield { id: "user-1" };
      },
      processor() {
        return null;
      },
      writer() {
        return undefined;
      }
    });

    const undefinedStep = defineChunkStep<{ id: string }, undefined>({
      name: "undefined-users",
      chunkSize: 1,
      reader: function* () {
        yield { id: "user-1" };
      },
      processor() {
        return undefined;
      },
      writer() {
        return undefined;
      }
    });

    const signal = new AbortController().signal;

    await expect(nullableStep.processor?.({ id: "user-1" }, { index: 0, item: { id: "user-1" }, signal })).resolves.toBeNull();
    await expect(undefinedStep.processor?.({ id: "user-1" }, { index: 0, item: { id: "user-1" }, signal })).resolves.toBeUndefined();
    expect(isSkipItem(null)).toBe(false);
    expect(isSkipItem(undefined)).toBe(false);
  });

  it("detects only branded skip items / branded skip item만 인식한다", () => {
    const cause = new Error("inactive");
    const skipped = skipItem("inactive user", cause);

    expect(isSkipItem(skipped)).toBe(true);
    expect(skipped).toMatchObject({
      kind: "skip",
      reason: "inactive user",
      cause
    });
    expect(Object.isFrozen(skipped)).toBe(true);
    expect(isSkipItem({ kind: "skip", reason: "inactive user" })).toBe(false);
    expect(isSkipItem(false)).toBe(false);
    expect(isSkipItem(0)).toBe(false);
  });

  it("rejects invalid chunk sizes / 유효하지 않은 chunk size를 거부한다", () => {
    for (const chunkSize of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        defineChunkStep({
          name: "invalid-chunk",
          chunkSize,
          reader: [],
          writer() {
            return undefined;
          }
        })
      ).toThrow("Chunk size must be a positive integer.");
    }
  });

  it("rejects jobs without steps / step이 없는 job을 거부한다", () => {
    expect(() => defineJob({ name: "empty-job", steps: [] })).toThrow(
      'Job "empty-job" must include at least one step.'
    );
  });

  it("rejects blank names / 비어 있는 이름을 거부한다", () => {
    expect(() =>
      defineStep({
        name: " ",
        async execute() {
          return undefined;
        }
      })
    ).toThrow("Step name is required.");

    expect(() =>
      defineChunkStep({
        name: " ",
        chunkSize: 1,
        reader: [],
        writer() {
          return undefined;
        }
      })
    ).toThrow("Step name is required.");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run:

```bash
pnpm exec vitest run packages/core/test/definitions.test.ts
```

Expected: FAIL. `defineChunkStep`, `skipItem`, `isSkipItem` export가 아직 없다는 오류가 나야 한다.

- [ ] **Step 3: public type 구현**

`packages/core/src/types.ts`를 다음 내용으로 바꾼다.

```ts
export type JobExecutionStatus = "created" | "running" | "completed" | "failed" | "cancelled";

export type JobParameters = Record<string, unknown>;

export type BatchExecutionId = string;

export interface StepExecutionContext<Input = unknown> {
  readonly input?: Input;
  readonly signal: AbortSignal;
  readonly checkpoint?: unknown;
}

export interface ChunkStepExecutionContext<TCheckpoint = unknown> {
  readonly signal: AbortSignal;
  readonly checkpoint?: TCheckpoint;
}

export interface ChunkItemContext<Input = unknown, TCheckpoint = unknown>
  extends ChunkStepExecutionContext<TCheckpoint> {
  readonly item: Input;
  readonly index: number;
}

export interface ChunkWriteContext<TCheckpoint = unknown> extends ChunkStepExecutionContext<TCheckpoint> {
  readonly chunkIndex: number;
  readonly attempt: number;
}

export const SKIP_ITEM: unique symbol = Symbol("nest-batch.skip-item");

export interface SkipItem {
  readonly kind: "skip";
  readonly reason?: string;
  readonly cause?: unknown;
  readonly [SKIP_ITEM]: true;
}

export type ChunkReader<Input, TCheckpoint = unknown> = (
  context: ChunkStepExecutionContext<TCheckpoint>
) => AsyncIterable<Input> | Iterable<Input>;

export type ChunkProcessor<Input, Output, TCheckpoint = unknown> = (
  item: Input,
  context: ChunkItemContext<Input, TCheckpoint>
) => Output | SkipItem | Promise<Output | SkipItem>;

export type ChunkWriter<Output, TCheckpoint = unknown> = (
  items: readonly Output[],
  context: ChunkWriteContext<TCheckpoint>
) => Promise<void> | void;

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

export type ChunkStepWithoutProcessorOptions<Input = unknown, TCheckpoint = unknown> = Omit<
  ChunkStepDefinition<Input, Input, TCheckpoint>,
  "kind" | "processor"
> & {
  readonly processor?: undefined;
};

export type ChunkStepWithProcessorOptions<Input = unknown, Output = unknown, TCheckpoint = unknown> = Omit<
  ChunkStepDefinition<Input, Output, TCheckpoint>,
  "kind"
> & {
  readonly processor: ChunkProcessor<Input, Output, TCheckpoint>;
};

export type ChunkStepOptions<Input = unknown, Output = Input, TCheckpoint = unknown> =
  | ChunkStepWithoutProcessorOptions<Input, TCheckpoint>
  | ChunkStepWithProcessorOptions<Input, Output, TCheckpoint>;

export type StepDefinition<Input = unknown, Output = unknown> =
  | TaskletStepDefinition<Input, Output>
  | ChunkStepDefinition<Input, Output>;

export interface JobDefinition<Parameters extends JobParameters = JobParameters> {
  readonly name: string;
  readonly steps: readonly StepDefinition[];
  readonly parametersSchema?: (parameters: unknown) => Parameters;
}

export interface JobExecution<Parameters extends JobParameters = JobParameters> {
  readonly id: BatchExecutionId;
  readonly jobName: string;
  readonly status: JobExecutionStatus;
  readonly parameters: Parameters;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly endedAt?: Date;
  readonly failureReason?: string;
}

export interface JobRepository {
  create(execution: JobExecution): Promise<void>;
  update(execution: JobExecution): Promise<void>;
  findById(id: BatchExecutionId): Promise<JobExecution | undefined>;
}

export interface CheckpointStore {
  read<TCheckpoint = unknown>(executionId: BatchExecutionId, stepName: string): Promise<TCheckpoint | undefined>;
  write<TCheckpoint = unknown>(
    executionId: BatchExecutionId,
    stepName: string,
    checkpoint: TCheckpoint
  ): Promise<void>;
  delete(executionId: BatchExecutionId, stepName: string): Promise<void>;
}

export interface LockHandle {
  readonly resource: string;
  readonly ownerId: string;
  readonly expiresAt?: Date;
}

export interface LockAcquireOptions {
  readonly ttlMs?: number;
  readonly signal?: AbortSignal;
}

export interface LockManager {
  acquire(resource: string, ownerId: string, options?: LockAcquireOptions): Promise<LockHandle | undefined>;
  release(handle: LockHandle): Promise<void>;
}

export interface BatchRunOptions {
  readonly executionId?: BatchExecutionId;
  readonly signal?: AbortSignal;
}

export interface BatchRunner {
  run<Parameters extends JobParameters = JobParameters>(
    job: JobDefinition<Parameters>,
    parameters: Parameters,
    options?: BatchRunOptions
  ): Promise<JobExecution<Parameters>>;
}
```

- [ ] **Step 4: helper 구현**

`packages/core/src/definitions.ts`를 다음 내용으로 바꾼다.

```ts
import type {
  ChunkStepDefinition,
  ChunkStepOptions,
  ChunkStepWithProcessorOptions,
  ChunkStepWithoutProcessorOptions,
  JobDefinition,
  JobParameters,
  SkipItem,
  TaskletStepDefinition
} from "./types.js";
import { SKIP_ITEM } from "./types.js";

const assertName = (kind: "Job" | "Step", name: string): void => {
  if (name.trim().length === 0) {
    throw new Error(`${kind} name is required.`);
  }
};

const assertChunkSize = (chunkSize: number): void => {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("Chunk size must be a positive integer.");
  }
};

export const skipItem = (reason?: string, cause?: unknown): SkipItem =>
  Object.freeze({
    kind: "skip",
    reason,
    cause,
    [SKIP_ITEM]: true
  });

export const isSkipItem = (value: unknown): value is SkipItem => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (value as { readonly [SKIP_ITEM]?: unknown })[SKIP_ITEM] === true;
};

export const defineStep = <Input = unknown, Output = unknown>(
  definition: TaskletStepDefinition<Input, Output>
): TaskletStepDefinition<Input, Output> => {
  assertName("Step", definition.name);

  return Object.freeze({
    ...definition,
    name: definition.name.trim()
  });
};

export function defineChunkStep<Input = unknown, TCheckpoint = unknown>(
  definition: ChunkStepWithoutProcessorOptions<Input, TCheckpoint>
): ChunkStepDefinition<Input, Input, TCheckpoint>;

export function defineChunkStep<Input = unknown, Output = unknown, TCheckpoint = unknown>(
  definition: ChunkStepWithProcessorOptions<Input, Output, TCheckpoint>
): ChunkStepDefinition<Input, Output, TCheckpoint>;

export function defineChunkStep<Input = unknown, Output = Input, TCheckpoint = unknown>(
  definition: ChunkStepOptions<Input, Output, TCheckpoint>
): ChunkStepDefinition<Input, Output, TCheckpoint> {
  assertName("Step", definition.name);
  assertChunkSize(definition.chunkSize);

  return Object.freeze({
    ...definition,
    kind: "chunk" as const,
    name: definition.name.trim()
  });
}

export const defineJob = <Parameters extends JobParameters = JobParameters>(
  definition: JobDefinition<Parameters>
): JobDefinition<Parameters> => {
  assertName("Job", definition.name);

  if (definition.steps.length === 0) {
    throw new Error(`Job "${definition.name.trim()}" must include at least one step.`);
  }

  return Object.freeze({
    ...definition,
    name: definition.name.trim(),
    steps: Object.freeze([...definition.steps])
  });
};
```

- [ ] **Step 5: export surface 갱신**

`packages/core/src/index.ts`를 다음 내용으로 바꾼다.

```ts
export { defineChunkStep, defineJob, defineStep, isSkipItem, skipItem } from "./definitions.js";
export { SKIP_ITEM } from "./types.js";
export type {
  BatchExecutionId,
  BatchRunOptions,
  BatchRunner,
  CheckpointStore,
  ChunkItemContext,
  ChunkProcessor,
  ChunkReader,
  ChunkStepDefinition,
  ChunkStepExecutionContext,
  ChunkStepOptions,
  ChunkStepWithProcessorOptions,
  ChunkStepWithoutProcessorOptions,
  ChunkWriter,
  ChunkWriteContext,
  JobDefinition,
  JobExecution,
  JobExecutionStatus,
  JobParameters,
  JobRepository,
  LockAcquireOptions,
  LockHandle,
  LockManager,
  SkipItem,
  StepDefinition,
  StepExecutionContext,
  TaskletStepDefinition
} from "./types.js";
```

- [ ] **Step 6: 테스트와 typecheck 통과 확인**

Run:

```bash
pnpm exec vitest run packages/core/test/definitions.test.ts
pnpm exec tsc -b packages/core
```

Expected: 두 명령 모두 PASS. `tsc -b packages/core`는 `packages/core/dist`를 만들 수 있다.

- [ ] **Step 7: root 검증 실행**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected: PASS가 원칙이다. 선행 변경인 `packages/mysql`, `packages/mariadb`, `tsconfig*` 때문에 실패하면 실패 파일과 메시지를 기록하고, chunk step 변경으로 생긴 실패인지 분리한다.

- [ ] **Step 8: core 변경 커밋**

선행 변경을 포함하지 않고 core 변경만 staging한다.

```bash
git add packages/core/src/types.ts packages/core/src/definitions.ts packages/core/src/index.ts packages/core/test/definitions.test.ts
git commit -m "feat : Chunk Step core contract 추가" \
  -m "- defineChunkStep helper와 chunk step 타입을 추가" \
  -m "- 명시적 skipItem과 isSkipItem helper를 추가" \
  -m "- processor 없는 chunk step과 nullable output 동작을 검증"
```

---

### Task 2: Chunk Step Docs

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes:
  - `defineChunkStep`
  - `skipItem`
  - `AsyncIterable` reader contract
- Produces:
  - README chunk step example.
  - Architecture note that `core` owns tasklet and chunk step contracts.

- [ ] **Step 1: 선행 변경 확인**

Run:

```bash
git diff -- README.md docs/architecture.md
```

Expected: 현재 작업트리의 선행 변경을 확인한다. 이 task는 선행 변경을 되돌리지 않고, chunk step 문서 hunk만 추가한다.

- [ ] **Step 2: README chunk step 예제 추가**

`README.md`의 `## Core Example` tasklet 예제 아래에 다음 섹션을 추가한다. 같은 섹션이 이미 있으면 중복 추가하지 않고, 이 내용과 의미가 같도록 정리한다.

````markdown
## Chunk Step Example

`defineChunkStep`은 item을 streaming으로 읽고, optional processor를 거친 뒤,
writer에 chunk 단위로 전달합니다. `null`과 `undefined`는 유효한 output이며,
skip은 `skipItem()`으로만 명시합니다.

```ts
import { defineChunkStep, skipItem } from "@nest-batch/core";

export const importUsers = defineChunkStep({
  name: "import-users",
  chunkSize: 100,
  reader: async function* ({ signal }) {
    signal.throwIfAborted();
    yield { id: "user-1", active: true };
  },
  processor(user) {
    if (!user.active) {
      return skipItem("inactive user");
    }

    return { id: user.id };
  },
  async writer(users) {
    await saveUsers(users);
  }
});
```
````

- [ ] **Step 3: architecture 문서 갱신**

`docs/architecture.md`의 `Core owns:` 목록에 다음 bullet을 추가한다. 기존 문장과 충돌하면 같은 의미가 되도록 위치만 조정한다.

```markdown
- tasklet step과 chunk step contract
```

`## Runtime Constraints` 목록 아래에는 다음 bullet을 추가한다.

```markdown
- chunk step reader는 `AsyncIterable` 중심으로 동작하고, writer 성공 이후의 chunk boundary에서 checkpoint를 저장한다
```

- [ ] **Step 4: 문서 내용 확인**

Run:

```bash
rg -n "Chunk Step|defineChunkStep|AsyncIterable|chunk step" README.md docs/architecture.md
```

Expected: README에 `defineChunkStep` 예제가 있고, architecture 문서에 chunk step contract와 `AsyncIterable` reader 제약이 보인다.

- [ ] **Step 5: 문서 변경 커밋**

선행 변경이 같은 파일에 섞여 있으면 전체 파일을 무심코 staging하지 않는다. 비대화형 staging이 어렵다면 이 커밋은 생략하고 최종 보고에 "README/docs 선행 변경과 같은 파일이라 별도 staging하지 않음"을 남긴다. chunk step 문서 hunk만 안전하게 staging할 수 있으면 다음 커밋을 만든다.

```bash
git add README.md docs/architecture.md
git commit -m "docs : Chunk Step 사용 예제 추가" \
  -m "- README에 defineChunkStep 예제를 추가" \
  -m "- architecture 문서에 chunk step contract 책임을 명시"
```

---

### Task 3: Final Verification

**Files:**
- Check: `packages/core/src/types.ts`
- Check: `packages/core/src/definitions.ts`
- Check: `packages/core/src/index.ts`
- Check: `packages/core/test/definitions.test.ts`
- Check: `README.md`
- Check: `docs/architecture.md`

**Interfaces:**
- Consumes: Task 1과 Task 2 결과.
- Produces: 최종 검증 결과와 남은 위험 목록.

- [ ] **Step 1: 전체 diff 검토**

Run:

```bash
git diff --stat
git diff -- packages/core/src/types.ts packages/core/src/definitions.ts packages/core/src/index.ts packages/core/test/definitions.test.ts
git diff -- README.md docs/architecture.md
```

Expected: chunk step contract, helper, tests, 문서 변경만 설명 가능해야 한다. 선행 변경은 구분해서 기록한다.

- [ ] **Step 2: 검증 명령 재실행**

Run:

```bash
pnpm exec vitest run packages/core/test/definitions.test.ts
pnpm test
pnpm typecheck
```

Expected: PASS가 원칙이다. 실패하면 실패가 선행 `mysql/mariadb` 작업 때문인지 이번 chunk step 변경 때문인지 분리해서 기록한다.

- [ ] **Step 3: public export 확인**

Run:

```bash
pnpm exec tsc -b packages/core
rg -n "defineChunkStep|skipItem|isSkipItem|ChunkStepDefinition|TaskletStepDefinition" packages/core/dist
```

Expected: `dist` output에서 새 helper와 type declaration이 확인된다.

- [ ] **Step 4: 최종 상태 확인**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: 이번 작업에서 커밋한 항목과 남은 선행 변경을 구분해서 보고할 수 있어야 한다.
