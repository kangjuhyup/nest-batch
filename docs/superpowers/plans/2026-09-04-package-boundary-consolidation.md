# Package Boundary Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 14개의 workspace package를 8개의 공개 npm package와 4개의 `@rv-nest-batch/core` subpath API로 통합한다.

**Architecture:** 외부 dependency가 없는 queue, scheduler, polling, worker 구현은 `packages/core/src/` 아래의 독립 module로 이동하고 `exports` subpath로 노출한다. Nest, SQL adapter, in-memory adapter, BullMQ adapter, CLI는 별도 package로 유지하며 모든 consumer import와 project reference를 새 경계에 맞춘다.

**Tech Stack:** TypeScript NodeNext, pnpm workspace, Vitest, Node.js ESM package exports

**Spec:** `docs/superpowers/specs/2026-09-03-package-release-readiness-design.md`

## Global Constraints

- 공개 package는 `core`, `nest`, `inmemory`, `postgres`, `mysql`, `mariadb`, `bullmq`, `cli` 8개다.
- `core`는 NestJS, database driver, BullMQ, CLI framework에 의존하지 않는다.
- `core` root entrypoint는 subpath symbol을 재수출하지 않는다.
- 새 import 경로는 `@rv-nest-batch/core/queue`, `@rv-nest-batch/core/scheduler`, `@rv-nest-batch/core/polling`, `@rv-nest-batch/core/worker`다.
- 기존 미공개 package를 compatibility package로 남기지 않는다.
- runtime 동작과 public type 의미를 바꾸지 않는다.
- 테스트 설명은 `English / 한국어` 형식을 유지한다.
- 이 계획에서는 package version과 release metadata를 변경하지 않는다.

## File Structure

- `packages/core/src/queue/`: `WorkQueue`, `WorkerLoop` contract와 구현
- `packages/core/src/scheduler/`: schedule contract, interval/calendar trigger, dispatcher, loop
- `packages/core/src/polling/`: continuous polling loop
- `packages/core/src/worker/`: local pool과 worker thread pool
- `packages/core/test/{queue,scheduler,polling,worker}/`: 이동한 module의 behavior test
- `packages/bullmq/`: 기존 `queue-bullmq`를 이름만 단순화한 BullMQ adapter
- `packages/{nest,inmemory,postgres,mysql,mariadb,cli}/`: 새 core subpath를 소비하는 공개 package
- `tsconfig.base.json`, `tsconfig.json`, `vitest*.config.ts`: 새 package/subpath resolution
- `README.md`, `README-kr.md`, `docs/architecture.md`, `examples/`: 공개 import와 package 목록

---

### Task 1: Queue contract를 core subpath로 이동

**Files:**
- Create: `packages/core/src/queue/index.ts`
- Move: `packages/queue-core/src/work-queue.ts` → `packages/core/src/queue/work-queue.ts`
- Move: `packages/queue-core/src/worker-loop.ts` → `packages/core/src/queue/worker-loop.ts`
- Move: `packages/queue-core/test/worker-loop.test.ts` → `packages/core/test/queue/worker-loop.test.ts`
- Modify: `packages/core/package.json`
- Modify: `packages/queue-core/src/index.ts`
- Modify: `packages/queue-core/package.json`
- Modify: `packages/queue-core/tsconfig.json`
- Modify: `tsconfig.base.json`
- Modify: `vitest.config.ts`
- Modify: `vitest.e2e.config.ts`
- Test: `packages/core/test/queue/exports.test.ts`

**Interfaces:**
- Consumes: 기존 `WorkUnit`, `WorkClaimOptions`, `WorkQueue`, `WorkerLoop` 의미
- Produces: `@rv-nest-batch/core/queue`의 동일 이름 runtime/type export

- [ ] **Step 1: 새 queue subpath의 실패하는 export test 작성**

```ts
import { describe, expect, it } from "vitest";
import { WorkerLoop } from "@rv-nest-batch/core/queue";
import type { WorkQueue, WorkUnit } from "@rv-nest-batch/core/queue";

describe("core queue subpath exports / core queue subpath export를 검증한다", () => {
  it("exports queue contracts and worker loop / queue contract와 worker loop를 export한다", () => {
    const queue: WorkQueue = {
      enqueue: async (_work: WorkUnit) => undefined,
      claim: async () => undefined,
      complete: async () => undefined,
      fail: async () => undefined
    };

    expect(queue).toBeDefined();
    expect(WorkerLoop).toBeTypeOf("function");
  });
});
```

- [ ] **Step 2: test가 새 subpath를 찾지 못해 실패하는지 확인**

Run: `pnpm exec vitest run --config vitest.config.ts packages/core/test/queue/exports.test.ts`

Expected: FAIL with `Failed to resolve import "@rv-nest-batch/core/queue"`.

- [ ] **Step 3: queue source/test를 이동하고 core subpath export 추가**

`packages/core/src/queue/index.ts`:

```ts
export { WorkerLoop } from "./worker-loop.js";
export type {
  WorkerLoopContext,
  WorkerLoopOptions,
  WorkerRunOnceOptions,
  WorkHandler
} from "./worker-loop.js";
export type { WorkClaimOptions, WorkQueue, WorkUnit } from "./work-queue.js";
```

`packages/core/package.json`의 `exports`에 추가:

```json
"./queue": {
  "types": "./dist/queue/index.d.ts",
  "import": "./dist/queue/index.js"
}
```

`tsconfig.base.json`과 두 Vitest config에는 `@rv-nest-batch/core/queue`를
`packages/core/src/queue/index.ts`로 resolve하는 exact alias를 추가한다. 이동한 test의
import를 `@rv-nest-batch/core/queue`로 변경한다.

- [ ] **Step 4: 기존 queue-core를 임시 compatibility wrapper로 전환**

`packages/queue-core/src/index.ts`:

```ts
export { WorkerLoop } from "@rv-nest-batch/core/queue";
export type {
  WorkerLoopContext,
  WorkerLoopOptions,
  WorkerRunOnceOptions,
  WorkClaimOptions,
  WorkHandler,
  WorkQueue,
  WorkUnit
} from "@rv-nest-batch/core/queue";
```

`packages/queue-core/package.json`에 `"@rv-nest-batch/core": "workspace:*"` dependency를
추가하고 `packages/queue-core/tsconfig.json`에 `../core` reference를 추가한다. 이
wrapper는 다음 consumer migration task까지만 존재한다.

- [ ] **Step 5: queue test와 repository typecheck 실행**

Run: `pnpm install && pnpm exec vitest run --config vitest.config.ts packages/core/test/queue && pnpm typecheck`

Expected: queue test와 typecheck PASS.

- [ ] **Step 6: commit**

```bash
git add packages/core packages/queue-core tsconfig.base.json vitest.config.ts vitest.e2e.config.ts pnpm-lock.yaml
git commit -m "refactor : queue runtime을 core subpath로 통합" -m "- WorkQueue contract와 WorkerLoop를 core queue module로 이동
- 기존 queue-core를 consumer 전환용 wrapper로 변경"
```

---

### Task 2: Scheduler와 calendar trigger를 core subpath로 이동

**Files:**
- Create: `packages/core/src/scheduler/index.ts`
- Move: `packages/scheduler-core/src/{definition,dispatchers,interval-trigger,occurrence-id,scheduler-loop,types}.ts` → `packages/core/src/scheduler/`
- Move: `packages/scheduler-calendar/src/calendar-trigger.ts` → `packages/core/src/scheduler/calendar-trigger.ts`
- Move: `packages/scheduler-core/test/*.test.ts` → `packages/core/test/scheduler/`
- Move: `packages/scheduler-calendar/test/calendar-trigger.test.ts` → `packages/core/test/scheduler/calendar-trigger.test.ts`
- Modify: `packages/core/package.json`
- Modify: `packages/scheduler-core/src/index.ts`
- Modify: `packages/scheduler-calendar/src/index.ts`
- Modify: `packages/scheduler-core/package.json`
- Modify: `packages/scheduler-calendar/package.json`
- Modify: `packages/scheduler-core/tsconfig.json`
- Modify: `packages/scheduler-calendar/tsconfig.json`
- Modify: `tsconfig.base.json`
- Modify: `vitest.config.ts`
- Modify: `vitest.e2e.config.ts`
- Test: `packages/core/test/scheduler/exports.test.ts`

**Interfaces:**
- Consumes: `@rv-nest-batch/core` execution contracts와 Task 1의 `@rv-nest-batch/core/queue`
- Produces: `@rv-nest-batch/core/scheduler`의 schedule definition, trigger, store, dispatcher, loop API

- [ ] **Step 1: scheduler subpath export test 작성**

```ts
import { describe, expect, it } from "vitest";
import {
  SchedulerLoop,
  createIntervalTrigger,
  createUtcDailyTrigger,
  defineSchedule
} from "@rv-nest-batch/core/scheduler";

describe("core scheduler subpath exports / core scheduler subpath export를 검증한다", () => {
  it("exports scheduler and calendar APIs / scheduler와 calendar API를 export한다", () => {
    expect(SchedulerLoop).toBeTypeOf("function");
    expect(createIntervalTrigger).toBeTypeOf("function");
    expect(createUtcDailyTrigger).toBeTypeOf("function");
    expect(defineSchedule).toBeTypeOf("function");
  });
});
```

- [ ] **Step 2: test가 새 subpath 부재로 실패하는지 확인**

Run: `pnpm exec vitest run --config vitest.config.ts packages/core/test/scheduler/exports.test.ts`

Expected: FAIL resolving `@rv-nest-batch/core/scheduler`.

- [ ] **Step 3: scheduler source/test 이동과 내부 import 정리**

`types.ts`와 `definition.ts`는 core root package self-import 대신
`../types/index.js`에서 execution type을 import하고, queue type은 `../queue/index.js`에서
import한다. `calendar-trigger.ts`는 `./types.js`에서 `ScheduleTrigger`를 import한다.

`packages/core/src/scheduler/index.ts`:

```ts
export {
  createUtcDailyTrigger,
  createUtcMonthlyTrigger,
  createUtcWeeklyTrigger
} from "./calendar-trigger.js";
export { createQueueScheduleDispatcher, createRunnerScheduleDispatcher } from "./dispatchers.js";
export { defineSchedule, resolveScheduleParameters } from "./definition.js";
export { createIntervalTrigger } from "./interval-trigger.js";
export { createScheduleOccurrenceId } from "./occurrence-id.js";
export { SchedulerLoop } from "./scheduler-loop.js";
export type {
  UtcDailyTriggerOptions,
  UtcMonthlyTriggerOptions,
  UtcTimeOfDay,
  UtcWeeklyTriggerOptions
} from "./calendar-trigger.js";
export type { IntervalTriggerOptions } from "./interval-trigger.js";
export type * from "./types.js";
```

- [ ] **Step 4: core export/alias와 임시 wrapper 구성**

`packages/core/package.json`에 `./scheduler` export를 추가한다. TypeScript와 Vitest에
exact alias를 추가한다. 기존 `scheduler-core/src/index.ts`는 새 scheduler subpath의
schedule API를 재수출하고, `scheduler-calendar/src/index.ts`는 네 calendar export만
재수출한다. 두 wrapper package는 dependency를 `@rv-nest-batch/core` 하나로 바꾸고
tsconfig reference도 `../core`만 유지한다.

- [ ] **Step 5: scheduler test와 typecheck 실행**

Run: `pnpm install && pnpm exec vitest run --config vitest.config.ts packages/core/test/scheduler && pnpm typecheck`

Expected: scheduler/calendar test와 typecheck PASS.

- [ ] **Step 6: commit**

```bash
git add packages/core packages/scheduler-core packages/scheduler-calendar tsconfig.base.json vitest.config.ts vitest.e2e.config.ts pnpm-lock.yaml
git commit -m "refactor : scheduler runtime을 core subpath로 통합" -m "- scheduler contract와 loop를 core scheduler module로 이동
- calendar trigger를 같은 scheduler 공개 경계로 통합"
```

---

### Task 3: Polling loop를 core subpath로 이동

**Files:**
- Create: `packages/core/src/polling/index.ts`
- Move: `packages/polling-core/src/continuous-polling-loop.ts` → `packages/core/src/polling/continuous-polling-loop.ts`
- Move: `packages/polling-core/test/continuous-polling-loop.test.ts` → `packages/core/test/polling/continuous-polling-loop.test.ts`
- Modify: `packages/core/package.json`
- Modify: `packages/polling-core/src/index.ts`
- Modify: `packages/polling-core/package.json`
- Modify: `packages/polling-core/tsconfig.json`
- Modify: `tsconfig.base.json`
- Modify: `vitest.config.ts`
- Modify: `vitest.e2e.config.ts`
- Test: `packages/core/test/polling/exports.test.ts`

**Interfaces:**
- Consumes: Node `AbortSignal`과 timer API
- Produces: `@rv-nest-batch/core/polling`의 `ContinuousPollingLoop`와 polling contract

- [ ] **Step 1: polling subpath export test 작성 후 실패 확인**

```ts
import { describe, expect, it } from "vitest";
import { ContinuousPollingLoop } from "@rv-nest-batch/core/polling";

describe("core polling subpath exports / core polling subpath export를 검증한다", () => {
  it("exports the continuous polling loop / continuous polling loop를 export한다", () => {
    expect(ContinuousPollingLoop).toBeTypeOf("function");
  });
});
```

Run: `pnpm exec vitest run --config vitest.config.ts packages/core/test/polling/exports.test.ts`

Expected: FAIL resolving `@rv-nest-batch/core/polling`.

- [ ] **Step 2: source/test 이동, subpath export와 wrapper 추가**

새 `packages/core/src/polling/index.ts`는 기존 `polling-core/src/index.ts`의 runtime/type
export를 그대로 가진다. core package export와 TypeScript/Vitest alias를 추가한다.
기존 polling-core index는 다음처럼 임시 wrapper가 된다.

```ts
export { ContinuousPollingLoop } from "@rv-nest-batch/core/polling";
export type * from "@rv-nest-batch/core/polling";
```

polling-core manifest와 tsconfig에 core dependency/reference를 추가한다.

- [ ] **Step 3: polling test와 typecheck 실행**

Run: `pnpm install && pnpm exec vitest run --config vitest.config.ts packages/core/test/polling && pnpm typecheck`

Expected: polling test와 typecheck PASS.

- [ ] **Step 4: commit**

```bash
git add packages/core packages/polling-core tsconfig.base.json vitest.config.ts vitest.e2e.config.ts pnpm-lock.yaml
git commit -m "refactor : polling runtime을 core subpath로 통합" -m "- continuous polling loop와 contract를 core polling module로 이동
- 기존 polling-core를 consumer 전환용 wrapper로 변경"
```

---

### Task 4: Local/worker-thread pool을 core subpath로 이동

**Files:**
- Create: `packages/core/src/worker/index.ts`
- Move: `packages/worker-local/src/local-worker-pool.ts` → `packages/core/src/worker/local-worker-pool.ts`
- Move: `packages/worker-threads/src/{worker-entry,worker-thread-pool}.ts` → `packages/core/src/worker/`
- Move: `packages/worker-local/test/local-worker-pool.test.ts` → `packages/core/test/worker/local-worker-pool.test.ts`
- Move: `packages/worker-threads/test/worker-thread-pool.test.ts` → `packages/core/test/worker/worker-thread-pool.test.ts`
- Move: `packages/worker-threads/test/fixtures/*` → `packages/core/test/worker/fixtures/`
- Modify: `packages/core/package.json`
- Modify: `packages/worker-local/src/index.ts`
- Modify: `packages/worker-threads/src/index.ts`
- Modify: `packages/worker-local/package.json`
- Modify: `packages/worker-threads/package.json`
- Modify: `packages/worker-local/tsconfig.json`
- Modify: `packages/worker-threads/tsconfig.json`
- Modify: `tsconfig.base.json`
- Modify: `vitest.config.ts`
- Modify: `vitest.e2e.config.ts`
- Test: `packages/core/test/worker/exports.test.ts`

**Interfaces:**
- Consumes: `WorkerPool`, `WorkerTask` from `packages/core/src/types/index.ts`
- Produces: `@rv-nest-batch/core/worker`의 `LocalWorkerPool`, `WorkerThreadPool`과 option/task type

- [ ] **Step 1: worker subpath export test 작성 후 실패 확인**

```ts
import { describe, expect, it } from "vitest";
import { LocalWorkerPool, WorkerThreadPool } from "@rv-nest-batch/core/worker";

describe("core worker subpath exports / core worker subpath export를 검증한다", () => {
  it("exports local and thread worker pools / local과 thread worker pool을 export한다", () => {
    expect(LocalWorkerPool).toBeTypeOf("function");
    expect(WorkerThreadPool).toBeTypeOf("function");
  });
});
```

Run: `pnpm exec vitest run --config vitest.config.ts packages/core/test/worker/exports.test.ts`

Expected: FAIL resolving `@rv-nest-batch/core/worker`.

- [ ] **Step 2: worker source/test 이동과 internal type import 정리**

두 pool implementation은 기존 `@rv-nest-batch/core` self-import 대신 worker directory
기준 `../types/index.js`에서 `WorkerPool`, `WorkerTask`를 import한다. fixture URL 계산은
새 test directory를 기준으로 동일하게 동작하도록 fixture도 함께 이동한다.

`packages/core/src/worker/index.ts`:

```ts
export { LocalWorkerPool } from "./local-worker-pool.js";
export type { LocalWorkerPoolOptions } from "./local-worker-pool.js";
export { WorkerThreadPool } from "./worker-thread-pool.js";
export type { WorkerThreadPoolOptions, WorkerThreadTask } from "./worker-thread-pool.js";
```

- [ ] **Step 3: core export/alias와 두 임시 wrapper 구성**

core package에 `./worker` export를 추가하고 TypeScript/Vitest alias를 추가한다.
worker-local과 worker-threads index는 각각 자신이 소유하던 symbol만
`@rv-nest-batch/core/worker`에서 재수출한다. 두 manifest/tsconfig는 core
dependency/reference를 갖는다.

- [ ] **Step 4: worker test와 typecheck 실행**

Run: `pnpm install && pnpm exec vitest run --config vitest.config.ts packages/core/test/worker && pnpm typecheck`

Expected: local pool, thread pool, cancellation test와 typecheck PASS.

- [ ] **Step 5: commit**

```bash
git add packages/core packages/worker-local packages/worker-threads tsconfig.base.json vitest.config.ts vitest.e2e.config.ts pnpm-lock.yaml
git commit -m "refactor : worker pool을 core subpath로 통합" -m "- local과 worker thread pool을 core worker module로 이동
- 취소와 concurrency test를 새 package 경계로 이전"
```

---

### Task 5: Consumer 전환, BullMQ rename, 이전 workspace 제거

**Files:**
- Rename: `packages/queue-bullmq/` → `packages/bullmq/`
- Modify: `packages/{cli,nest,inmemory,postgres,mysql,mariadb,bullmq}/package.json`
- Modify: `packages/{cli,nest,inmemory,postgres,mysql,mariadb,bullmq}/tsconfig.json`
- Modify: affected source/test files returned by the old-import `rg` command
- Modify: `e2e/schedule-store-sql.e2e.test.ts`
- Modify: `e2e/scheduler-queue.e2e.test.ts`
- Modify: `tsconfig.base.json`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Modify: `vitest.e2e.config.ts`
- Modify: `vitest.perf.config.ts`
- Modify: `pnpm-lock.yaml`
- Delete: `packages/{queue-core,scheduler-core,scheduler-calendar,polling-core,worker-local,worker-threads}/`

**Interfaces:**
- Consumes: Tasks 1–4의 네 core subpath
- Produces: 8개 workspace package만 남은 build graph와 `@rv-nest-batch/bullmq`

- [ ] **Step 1: 이전 import 목록을 snapshot으로 확인**

Run:

```bash
rg -n '@nest-batch/(queue-core|scheduler-core|scheduler-calendar|polling-core|worker-local|worker-threads|queue-bullmq)' packages examples e2e README.md README-kr.md docs/architecture.md tsconfig*.json vitest*.ts
```

Expected: migration 대상 import/config가 출력된다.

- [ ] **Step 2: consumer source와 test import를 새 경계로 변경**

정확한 mapping:

```text
@nest-batch/queue-core       -> @rv-nest-batch/core/queue
@nest-batch/scheduler-core   -> @rv-nest-batch/core/scheduler
@nest-batch/scheduler-calendar -> @rv-nest-batch/core/scheduler
@nest-batch/polling-core     -> @rv-nest-batch/core/polling
@nest-batch/worker-local     -> @rv-nest-batch/core/worker
@nest-batch/worker-threads   -> @rv-nest-batch/core/worker
@nest-batch/queue-bullmq     -> @rv-nest-batch/bullmq
```

CLI, Nest, storage adapter, in-memory adapter의 manifest에서 제거된 package dependency를
지우고 필요한 경우 `@rv-nest-batch/core: workspace:*` 하나만 남긴다. 각 tsconfig
reference도 `../core`로 수렴시킨다.

- [ ] **Step 3: BullMQ package directory/name 변경**

`packages/bullmq/package.json`의 핵심 값:

```json
{
  "name": "@rv-nest-batch/bullmq",
  "dependencies": {
    "@rv-nest-batch/core": "workspace:*"
  },
  "peerDependencies": {
    "bullmq": ">=5"
  }
}
```

source/test에서는 queue type을 `@rv-nest-batch/core/queue`에서 import한다. package test
script와 root E2E script의 path를 `packages/bullmq`로 바꾼다.

- [ ] **Step 4: root build/test resolution을 8개 package 기준으로 변경**

`tsconfig.base.json`에는 8개 root package와 4개 core subpath alias만 둔다.
`tsconfig.json` references에서 제거한 6개 project를 삭제하고 `queue-bullmq` reference를
`bullmq`로 바꾼다. 모든 Vitest config도 같은 alias를 사용한다.

- [ ] **Step 5: 이전 wrapper package를 명시적으로 제거하고 lockfile 갱신**

```bash
git rm -r packages/queue-core packages/scheduler-core packages/scheduler-calendar packages/polling-core packages/worker-local packages/worker-threads
pnpm install
```

Expected: `pnpm-lock.yaml` importer가 공개 8개 package와 examples만 포함한다.

- [ ] **Step 6: 이전 import/package가 code path에 남지 않았는지 검사**

Run:

```bash
rg -n '@nest-batch/(queue-core|scheduler-core|scheduler-calendar|polling-core|worker-local|worker-threads|queue-bullmq)' packages examples e2e README.md README-kr.md docs/architecture.md tsconfig*.json vitest*.ts
```

Expected: documentation을 아직 바꾸지 않았다면 README/docs 결과만 남고, source/test/config 결과는 0건.

- [ ] **Step 7: build graph와 unit/E2E test 실행**

Run: `pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`

Expected: 모든 명령 PASS.

- [ ] **Step 8: commit**

```bash
git add packages e2e tsconfig.base.json tsconfig.json vitest.config.ts vitest.e2e.config.ts vitest.perf.config.ts package.json pnpm-lock.yaml
git commit -m "refactor : 공개 package 경계를 8개로 단순화" -m "- runtime consumer를 core subpath import로 전환
- queue-bullmq를 bullmq package로 변경
- 이전 core 성격 workspace package를 제거"
```

---

### Task 6: 공개 문서와 example import 갱신

**Files:**
- Modify: `README.md`
- Modify: `README-kr.md`
- Modify: `docs/architecture.md`
- Modify: `examples/basic/README.md`
- Modify: `examples/nestjs/README.md`
- Modify: old-import matches under `examples/*/src/`

**Interfaces:**
- Consumes: Task 5의 8개 package와 core subpath import
- Produces: 실제 install/import와 일치하는 영문/한국어 문서

- [ ] **Step 1: README package 목록과 code import 변경**

문서의 package 목록은 아래 8개만 public package로 표시한다.

```text
@rv-nest-batch/core
@rv-nest-batch/nest
@rv-nest-batch/inmemory
@rv-nest-batch/postgres
@rv-nest-batch/mysql
@rv-nest-batch/mariadb
@rv-nest-batch/bullmq
@rv-nest-batch/cli
```

queue/scheduler/polling/worker는 `@rv-nest-batch/core`의 subpath API로 설명하고 모든 code
snippet을 Task 5 mapping으로 변경한다. `docs/architecture.md`에는 source module
경계와 npm 배포 단위가 다르다는 이유를 추가한다.

- [ ] **Step 2: historical 문서를 제외한 이전 import가 0건인지 확인**

Run:

```bash
rg -n '@nest-batch/(queue-core|scheduler-core|scheduler-calendar|polling-core|worker-local|worker-threads|queue-bullmq)' --glob '!docs/superpowers/**'
```

Expected: 0 matches.

- [ ] **Step 3: 문서 snippet이 실제 export와 맞는지 전체 검증**

Run: `pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e:examples`

Expected: 모든 명령 PASS.

- [ ] **Step 4: commit**

```bash
git add README.md README-kr.md docs/architecture.md examples
git commit -m "docs : 통합된 package import 경로 반영" -m "- 공개 package 목록을 8개 경계로 정리
- queue scheduler polling worker 예제를 core subpath로 변경"
```
