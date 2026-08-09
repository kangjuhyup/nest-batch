# Production Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** code-defined schedule을 durable occurrence로 claim하고 `BatchRunner` 또는 `WorkQueue`로 dispatch하는 production scheduling 1차 구현을 추가한다.

**Architecture:** scheduler contract와 loop는 `@nest-batch/scheduler-core`에 둔다. durable occurrence 저장은 `@nest-batch/inmemory`, `@nest-batch/postgres`, `@nest-batch/mysql`, `@nest-batch/mariadb` adapter가 소유한다. CLI와 Nest integration은 scheduler core를 재구현하지 않고, application이 주입한 schedules/store/dispatcher를 실행 또는 provider로 연결한다.

**Tech Stack:** TypeScript `NodeNext`, pnpm workspace, Vitest, existing `LockManager`, existing `WorkQueue`, existing `BatchRunner`, Postgres `pg`-style driver, MySQL `mysql2/promise`-style driver, MariaDB driver.

## Global Constraints

- `@nest-batch/core`는 NestJS, database client, queue client, CLI framework에 의존하지 않는다.
- `@nest-batch/scheduler-core`도 NestJS, database driver, queue implementation에 의존하지 않는다.
- scheduler는 job runtime을 직접 구현하지 않고 `BatchRunner` 또는 `WorkQueue`로 dispatch한다.
- schedule definition은 application code가 소유하고, database는 occurrence와 claim state만 저장한다.
- built-in trigger는 `createIntervalTrigger()`만 제공한다.
- 외부 cron parser 의존성은 추가하지 않는다.
- dispatch는 at-least-once 의미이며 writer idempotency를 문서화한다.
- test name은 `English / 한국어` 형식을 사용한다.
- public API 이름, npm package 이름, 타입 이름은 영어를 유지한다.

---

## File Structure

새 package:

- `packages/scheduler-core/package.json`: package metadata와 build/test script.
- `packages/scheduler-core/tsconfig.json`: root `tsconfig.base.json`을 확장하는 project reference 설정.
- `packages/scheduler-core/src/types.ts`: schedule definition, trigger, occurrence, store, dispatcher type.
- `packages/scheduler-core/src/definition.ts`: `defineSchedule()` validation과 default normalization.
- `packages/scheduler-core/src/interval-trigger.ts`: deterministic interval occurrence 계산.
- `packages/scheduler-core/src/occurrence-id.ts`: stable occurrence id 생성.
- `packages/scheduler-core/src/scheduler-loop.ts`: lock, due occurrence 계산, claim, dispatch, mark state, run loop.
- `packages/scheduler-core/src/dispatchers.ts`: runner dispatcher와 queue dispatcher.
- `packages/scheduler-core/src/index.ts`: public export surface.
- `packages/scheduler-core/test/*.test.ts`: scheduler-core behavior tests.

기존 package 수정:

- `package.json`: scheduler-core test script 필요 시 root alias만 유지한다.
- `tsconfig.base.json`: `@nest-batch/scheduler-core` path 추가.
- `tsconfig.json`: `./packages/scheduler-core` reference 추가.
- `vitest.config.ts`, `vitest.e2e.config.ts`: scheduler-core alias 추가.
- `packages/inmemory/src/schedule-store.ts`: non-durable schedule store.
- `packages/inmemory/src/index.ts`: `InMemoryScheduleStore` export.
- `packages/postgres/src/schedule-store.ts`, `packages/postgres/src/schedule-schema.ts`, `packages/postgres/src/sql.ts`, `packages/postgres/src/index.ts`: Postgres schedule store.
- `packages/mysql/src/schedule-store.ts`, `packages/mysql/src/schedule-schema.ts`, `packages/mysql/src/sql.ts`, `packages/mysql/src/index.ts`: MySQL schedule store.
- `packages/mariadb/src/schedule-store.ts`, `packages/mariadb/src/schedule-schema.ts`, `packages/mariadb/src/sql.ts`, `packages/mariadb/src/index.ts`: MariaDB schedule store.
- `packages/cli/src/index.ts`: `schedule` command와 scheduler context 추가.
- `packages/nest/src/constants.ts`, `packages/nest/src/module-options.ts`, `packages/nest/src/runtime.providers.ts`, `packages/nest/src/index.ts`: scheduler provider tokens/options 추가.
- `README.md`, `README-kr.md`, `docs/architecture.md`: scheduler 사용 흐름과 at-least-once 의미 문서화.
- `e2e/scheduler-queue.e2e.test.ts`: scheduler queue dispatch와 worker execution flow 검증.

---

### Task 1: Scheduler Core Package and Public Types

**Files:**
- Create: `packages/scheduler-core/package.json`
- Create: `packages/scheduler-core/tsconfig.json`
- Create: `packages/scheduler-core/src/types.ts`
- Create: `packages/scheduler-core/src/index.ts`
- Create: `packages/scheduler-core/test/types.test.ts`
- Modify: `tsconfig.base.json`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Modify: `vitest.e2e.config.ts`

**Interfaces:**
- Consumes: `JobParameters`, `BatchRunOptions`, `BatchExecutionId`, `BatchRunner`, `JobDefinition`, `LockManager` from `@nest-batch/core`; `WorkQueue`, `WorkUnit` from `@nest-batch/queue-core`.
- Produces:
  - `ScheduleOccurrenceStatus = "claimed" | "dispatched" | "failed"`
  - `ScheduleMisfirePolicy = "fire-once" | "fire-all"`
  - `ScheduleTrigger`
  - `ScheduleDefinition`
  - `ScheduleOccurrence`
  - `ScheduleStore`
  - `ScheduleDispatcher`
  - `SchedulerTickResult`

- [ ] **Step 1: Write the failing type export test**

Create `packages/scheduler-core/test/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type {
  ScheduleDefinition,
  ScheduleDispatcher,
  ScheduleOccurrence,
  ScheduleStore,
  ScheduleTrigger
} from "@nest-batch/scheduler-core";

describe("scheduler core type exports / scheduler core type export를 검증한다", () => {
  it("exports scheduler contracts / scheduler contract를 export한다", async () => {
    const trigger: ScheduleTrigger = {
      getDueOccurrences({ now }) {
        return [now];
      }
    };
    const schedule: ScheduleDefinition = {
      name: "billing.every-minute",
      jobName: "billing",
      trigger,
      misfirePolicy: "fire-once"
    };
    const occurrence: ScheduleOccurrence = {
      scheduleName: schedule.name,
      occurrenceId: "schedule:billing.every-minute:2026-01-01T00:00:00.000Z",
      scheduledAt: new Date("2026-01-01T00:00:00.000Z"),
      status: "claimed",
      ownerId: "scheduler-1",
      claimedAt: new Date("2026-01-01T00:00:01.000Z")
    };
    const store: ScheduleStore = {
      async findLatestOccurrence() {
        return occurrence;
      },
      async claimOccurrence(candidate) {
        return { ...candidate, status: "claimed", ownerId: "scheduler-1" };
      },
      async markDispatched() {
        return true;
      },
      async markFailed() {
        return true;
      }
    };
    const dispatcher: ScheduleDispatcher = async () => undefined;

    expect(schedule.jobName).toBe("billing");
    expect(await store.findLatestOccurrence(schedule.name)).toBe(occurrence);
    await expect(dispatcher({ schedule, occurrence, signal: new AbortController().signal })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/scheduler-core/test/types.test.ts
```

Expected: FAIL because `@nest-batch/scheduler-core` alias and package do not exist.

- [ ] **Step 3: Add package metadata and type contracts**

Create `packages/scheduler-core/package.json`:

```json
{
  "name": "@nest-batch/scheduler-core",
  "version": "0.0.1",
  "description": "Framework-independent scheduler contracts and loop for nest-batch.",
  "type": "module",
  "license": "MIT",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run --root ../.. --config vitest.config.ts packages/scheduler-core/test"
  },
  "dependencies": {
    "@nest-batch/core": "workspace:*",
    "@nest-batch/queue-core": "workspace:*"
  }
}
```

Create `packages/scheduler-core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/.tsbuildinfo"
  },
  "include": ["src/**/*.ts"],
  "references": [
    { "path": "../core" },
    { "path": "../queue-core" }
  ]
}
```

Create `packages/scheduler-core/src/types.ts`:

```ts
import type {
  BatchExecutionId,
  BatchRunOptions,
  BatchRunner,
  JobDefinition,
  JobParameters,
  LockManager
} from "@nest-batch/core";
import type { WorkQueue, WorkUnit } from "@nest-batch/queue-core";

export type ScheduleOccurrenceStatus = "claimed" | "dispatched" | "failed";
export type ScheduleMisfirePolicy = "fire-once" | "fire-all";

export interface ScheduleTriggerContext {
  readonly after?: Date;
  readonly now: Date;
}

export interface ScheduleTrigger {
  getDueOccurrences(context: ScheduleTriggerContext): readonly Date[];
}

export interface ScheduleParametersContext {
  readonly scheduleName: string;
  readonly jobName: string;
  readonly occurrenceId: string;
  readonly scheduledAt: Date;
}

export interface ScheduleDefinition<Parameters extends JobParameters = JobParameters> {
  readonly name: string;
  readonly jobName: string;
  readonly trigger: ScheduleTrigger;
  readonly parameters?: Parameters | ((context: ScheduleParametersContext) => Parameters);
  readonly misfirePolicy?: ScheduleMisfirePolicy;
  readonly maxCatchUpOccurrences?: number;
  readonly runOptions?: Omit<BatchRunOptions, "executionId" | "signal" | "observer">;
}

export interface ScheduleOccurrence {
  readonly scheduleName: string;
  readonly occurrenceId: string;
  readonly scheduledAt: Date;
  readonly status: ScheduleOccurrenceStatus;
  readonly ownerId?: string;
  readonly claimedAt?: Date;
  readonly claimExpiresAt?: Date;
  readonly dispatchedAt?: Date;
  readonly failedAt?: Date;
  readonly failureReason?: string;
}

export interface ScheduleOccurrenceCandidate {
  readonly scheduleName: string;
  readonly occurrenceId: string;
  readonly scheduledAt: Date;
}

export interface ScheduleClaimOptions {
  readonly ownerId: string;
  readonly claimedAt: Date;
  readonly claimTtlMs?: number;
}

export interface ScheduleMarkDispatchedOptions {
  readonly ownerId: string;
  readonly dispatchedAt: Date;
}

export interface ScheduleMarkFailedOptions {
  readonly ownerId: string;
  readonly failedAt: Date;
  readonly failureReason: string;
}

export interface ScheduleStore {
  findLatestOccurrence(scheduleName: string): Promise<ScheduleOccurrence | undefined>;
  claimOccurrence(
    occurrence: ScheduleOccurrenceCandidate,
    options: ScheduleClaimOptions
  ): Promise<ScheduleOccurrence | undefined>;
  markDispatched(
    occurrence: ScheduleOccurrence,
    options: ScheduleMarkDispatchedOptions
  ): Promise<boolean>;
  markFailed(occurrence: ScheduleOccurrence, options: ScheduleMarkFailedOptions): Promise<boolean>;
}

export interface ScheduleDispatchContext {
  readonly schedule: ScheduleDefinition;
  readonly occurrence: ScheduleOccurrence;
  readonly signal: AbortSignal;
}

export type ScheduleDispatcher = (context: ScheduleDispatchContext) => Promise<void> | void;

export interface SchedulerLoopOptions {
  readonly schedules: readonly ScheduleDefinition[];
  readonly store: ScheduleStore;
  readonly lockManager: LockManager;
  readonly dispatcher: ScheduleDispatcher;
  readonly ownerId: string;
  readonly lockTtlMs?: number;
  readonly claimTtlMs?: number;
  readonly pollIntervalMs?: number;
  readonly now?: () => Date;
}

export interface SchedulerTickOptions {
  readonly now?: Date;
  readonly signal?: AbortSignal;
}

export interface SchedulerTickResult {
  readonly scannedSchedules: number;
  readonly claimedOccurrences: number;
  readonly dispatchedOccurrences: number;
  readonly failedOccurrences: number;
}

export interface RunnerScheduleDispatcherOptions {
  readonly jobs: readonly JobDefinition[];
  readonly runner: BatchRunner;
  readonly ownerId?: string;
}

export interface QueueScheduleDispatcherOptions {
  readonly queue: WorkQueue;
  readonly workType?: string;
}

export interface ScheduledJobWorkPayload {
  readonly jobName: string;
  readonly parameters: JobParameters;
  readonly executionId: BatchExecutionId;
  readonly ownerId?: string;
  readonly lockTtlMs?: number;
  readonly restart?: boolean;
}

export type ScheduledJobWorkUnit = WorkUnit<ScheduledJobWorkPayload>;
```

Create `packages/scheduler-core/src/index.ts`:

```ts
export type * from "./types.js";
```

Update `tsconfig.base.json` paths:

```json
"@nest-batch/scheduler-core": ["packages/scheduler-core/src/index.ts"]
```

Add `{ "path": "./packages/scheduler-core" }` to `tsconfig.json` references after `queue-bullmq`.

Add this alias to `vitest.config.ts` and `vitest.e2e.config.ts`:

```ts
"@nest-batch/scheduler-core": fromRoot("./packages/scheduler-core/src/index.ts")
```

- [ ] **Step 4: Run GREEN**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/scheduler-core/test/types.test.ts
./node_modules/.bin/tsc -b packages/scheduler-core
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/scheduler-core package.json tsconfig.base.json tsconfig.json vitest.config.ts vitest.e2e.config.ts
git commit -m "feat : scheduler core 패키지 경계 추가" -m "- scheduler public contract와 workspace 설정을 추가"
```

---

### Task 2: Schedule Definition, Occurrence Id, and Interval Trigger

**Files:**
- Create: `packages/scheduler-core/src/definition.ts`
- Create: `packages/scheduler-core/src/interval-trigger.ts`
- Create: `packages/scheduler-core/src/occurrence-id.ts`
- Modify: `packages/scheduler-core/src/index.ts`
- Test: `packages/scheduler-core/test/definition.test.ts`
- Test: `packages/scheduler-core/test/interval-trigger.test.ts`

**Interfaces:**
- Consumes: types from Task 1.
- Produces:
  - `defineSchedule<Parameters>(definition: ScheduleDefinition<Parameters>): ScheduleDefinition<Parameters>`
  - `createScheduleOccurrenceId(scheduleName: string, scheduledAt: Date): string`
  - `createIntervalTrigger(options: { everyMs: number; startAt: Date }): ScheduleTrigger`
  - `resolveScheduleParameters(schedule, occurrenceId, scheduledAt): JobParameters`

- [ ] **Step 1: Write failing tests for definition and occurrence id**

Create `packages/scheduler-core/test/definition.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createScheduleOccurrenceId,
  defineSchedule,
  resolveScheduleParameters
} from "@nest-batch/scheduler-core";

describe("schedule definition / schedule definition을 검증한다", () => {
  it("normalizes schedule defaults and occurrence ids / schedule 기본값과 occurrence id를 정규화한다", () => {
    const scheduledAt = new Date("2026-01-01T00:00:00.000Z");
    const schedule = defineSchedule({
      name: "billing.every-minute",
      jobName: "billing",
      trigger: { getDueOccurrences: () => [scheduledAt] }
    });

    expect(schedule.misfirePolicy).toBe("fire-once");
    expect(schedule.maxCatchUpOccurrences).toBe(1);
    expect(createScheduleOccurrenceId(schedule.name, scheduledAt)).toBe(
      "schedule:billing.every-minute:2026-01-01T00:00:00.000Z"
    );
    expect(resolveScheduleParameters(schedule, createScheduleOccurrenceId(schedule.name, scheduledAt), scheduledAt)).toEqual({});
  });

  it("resolves parameter factories / parameter factory를 실행한다", () => {
    const scheduledAt = new Date("2026-01-02T03:04:05.000Z");
    const occurrenceId = "schedule:billing.daily:2026-01-02T03:04:05.000Z";
    const schedule = defineSchedule({
      name: "billing.daily",
      jobName: "billing",
      trigger: { getDueOccurrences: () => [scheduledAt] },
      parameters: ({ scheduledAt: value, occurrenceId: id }) => ({
        billingDate: value.toISOString().slice(0, 10),
        occurrenceId: id
      })
    });

    expect(resolveScheduleParameters(schedule, occurrenceId, scheduledAt)).toEqual({
      billingDate: "2026-01-02",
      occurrenceId
    });
  });

  it("rejects invalid schedule names / 유효하지 않은 schedule 이름을 거부한다", () => {
    expect(() =>
      defineSchedule({
        name: " ",
        jobName: "billing",
        trigger: { getDueOccurrences: () => [] }
      })
    ).toThrow("Schedule name is required.");
  });
});
```

- [ ] **Step 2: Write failing tests for interval trigger**

Create `packages/scheduler-core/test/interval-trigger.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createIntervalTrigger } from "@nest-batch/scheduler-core";

describe("interval schedule trigger / interval schedule trigger를 검증한다", () => {
  it("returns due occurrences after durable state / durable state 이후 due occurrence를 반환한다", () => {
    const trigger = createIntervalTrigger({
      everyMs: 60_000,
      startAt: new Date("2026-01-01T00:00:00.000Z")
    });

    expect(
      trigger.getDueOccurrences({
        after: new Date("2026-01-01T00:01:00.000Z"),
        now: new Date("2026-01-01T00:04:00.000Z")
      })
    ).toEqual([
      new Date("2026-01-01T00:02:00.000Z"),
      new Date("2026-01-01T00:03:00.000Z"),
      new Date("2026-01-01T00:04:00.000Z")
    ]);
  });

  it("rejects invalid intervals / 유효하지 않은 interval을 거부한다", () => {
    expect(() =>
      createIntervalTrigger({
        everyMs: 0,
        startAt: new Date("2026-01-01T00:00:00.000Z")
      })
    ).toThrow("Interval trigger everyMs must be a positive safe integer.");
  });
});
```

- [ ] **Step 3: Run RED**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/scheduler-core/test/definition.test.ts packages/scheduler-core/test/interval-trigger.test.ts
```

Expected: FAIL because helper exports do not exist.

- [ ] **Step 4: Implement helpers**

Create `packages/scheduler-core/src/occurrence-id.ts`:

```ts
export const createScheduleOccurrenceId = (scheduleName: string, scheduledAt: Date): string => {
  return `schedule:${scheduleName}:${scheduledAt.toISOString()}`;
};
```

Create `packages/scheduler-core/src/definition.ts` with:

```ts
import type { JobParameters, ScheduleDefinition } from "./types.js";

export const defineSchedule = <Parameters extends JobParameters>(
  definition: ScheduleDefinition<Parameters>
): ScheduleDefinition<Parameters> => {
  assertNonBlank(definition.name, "Schedule name is required.");
  assertNonBlank(definition.jobName, "Schedule jobName is required.");

  return Object.freeze({
    ...definition,
    misfirePolicy: definition.misfirePolicy ?? "fire-once",
    maxCatchUpOccurrences: definition.maxCatchUpOccurrences ?? (definition.misfirePolicy === "fire-all" ? 100 : 1)
  });
};

export const resolveScheduleParameters = (
  schedule: ScheduleDefinition,
  occurrenceId: string,
  scheduledAt: Date
): JobParameters => {
  if (schedule.parameters === undefined) {
    return {};
  }

  if (typeof schedule.parameters === "function") {
    return schedule.parameters({
      scheduleName: schedule.name,
      jobName: schedule.jobName,
      occurrenceId,
      scheduledAt
    });
  }

  return schedule.parameters;
};

const assertNonBlank = (value: string, message: string): void => {
  if (value.trim().length === 0) {
    throw new TypeError(message);
  }
};
```

Create `packages/scheduler-core/src/interval-trigger.ts` with:

```ts
import type { ScheduleTrigger } from "./types.js";

export interface IntervalTriggerOptions {
  readonly everyMs: number;
  readonly startAt: Date;
}

export const createIntervalTrigger = (options: IntervalTriggerOptions): ScheduleTrigger => {
  assertEveryMs(options.everyMs);
  const startAt = new Date(options.startAt);

  return {
    getDueOccurrences({ after, now }) {
      if (now.getTime() < startAt.getTime()) {
        return [];
      }

      const lowerBound = after && after.getTime() >= startAt.getTime() ? after.getTime() : startAt.getTime() - options.everyMs;
      const firstTick = Math.floor((lowerBound - startAt.getTime()) / options.everyMs) + 1;
      const lastTick = Math.floor((now.getTime() - startAt.getTime()) / options.everyMs);
      const occurrences: Date[] = [];

      for (let tick = Math.max(0, firstTick); tick <= lastTick; tick += 1) {
        occurrences.push(new Date(startAt.getTime() + tick * options.everyMs));
      }

      return occurrences;
    }
  };
};

const assertEveryMs = (everyMs: number): void => {
  if (!Number.isSafeInteger(everyMs) || everyMs <= 0) {
    throw new TypeError("Interval trigger everyMs must be a positive safe integer.");
  }
};
```

Update `packages/scheduler-core/src/index.ts`:

```ts
export { defineSchedule, resolveScheduleParameters } from "./definition.js";
export { createIntervalTrigger } from "./interval-trigger.js";
export { createScheduleOccurrenceId } from "./occurrence-id.js";
export type { IntervalTriggerOptions } from "./interval-trigger.js";
export type * from "./types.js";
```

- [ ] **Step 5: Run GREEN**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/scheduler-core/test/definition.test.ts packages/scheduler-core/test/interval-trigger.test.ts
./node_modules/.bin/tsc -b packages/scheduler-core
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/scheduler-core/src packages/scheduler-core/test
git commit -m "feat : schedule definition과 interval trigger 추가" -m "- deterministic occurrence id와 interval due 계산을 구현"
```

---

### Task 3: Scheduler Loop

**Files:**
- Create: `packages/scheduler-core/src/scheduler-loop.ts`
- Modify: `packages/scheduler-core/src/index.ts`
- Test: `packages/scheduler-core/test/scheduler-loop.test.ts`

**Interfaces:**
- Consumes: Task 1 and Task 2 helpers.
- Produces:
  - `class SchedulerLoop`
  - `tick(options?: SchedulerTickOptions): Promise<SchedulerTickResult>`
  - `runUntilStopped(options?: { signal?: AbortSignal }): Promise<void>`

- [ ] **Step 1: Write failing loop tests**

Create `packages/scheduler-core/test/scheduler-loop.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type {
  LockHandle,
  LockManager
} from "@nest-batch/core";
import type {
  ScheduleDispatcher,
  ScheduleOccurrence,
  ScheduleOccurrenceCandidate,
  ScheduleStore
} from "@nest-batch/scheduler-core";
import { SchedulerLoop, createIntervalTrigger, defineSchedule } from "@nest-batch/scheduler-core";

describe("scheduler loop / scheduler loop를 검증한다", () => {
  it("claims and dispatches due occurrences / due occurrence를 claim하고 dispatch한다", async () => {
    const store = new FakeScheduleStore();
    const lockManager = new FakeLockManager();
    const dispatched: string[] = [];
    const dispatcher: ScheduleDispatcher = async ({ occurrence }) => {
      dispatched.push(occurrence.occurrenceId);
    };
    const loop = new SchedulerLoop({
      schedules: [
        defineSchedule({
          name: "billing.every-minute",
          jobName: "billing",
          trigger: createIntervalTrigger({
            everyMs: 60_000,
            startAt: new Date("2026-01-01T00:00:00.000Z")
          })
        })
      ],
      store,
      lockManager,
      dispatcher,
      ownerId: "scheduler-1",
      now: () => new Date("2026-01-01T00:00:00.000Z")
    });

    const result = await loop.tick();

    expect(result).toEqual({
      scannedSchedules: 1,
      claimedOccurrences: 1,
      dispatchedOccurrences: 1,
      failedOccurrences: 0
    });
    expect(dispatched).toEqual(["schedule:billing.every-minute:2026-01-01T00:00:00.000Z"]);
    expect(store.latest("billing.every-minute")?.status).toBe("dispatched");
  });

  it("does not dispatch without schedule lock / schedule lock이 없으면 dispatch하지 않는다", async () => {
    const store = new FakeScheduleStore();
    const lockManager = new FakeLockManager({ deny: true });
    const dispatched: string[] = [];
    const loop = new SchedulerLoop({
      schedules: [
        defineSchedule({
          name: "billing.every-minute",
          jobName: "billing",
          trigger: createIntervalTrigger({
            everyMs: 60_000,
            startAt: new Date("2026-01-01T00:00:00.000Z")
          })
        })
      ],
      store,
      lockManager,
      dispatcher: async ({ occurrence }) => {
        dispatched.push(occurrence.occurrenceId);
      },
      ownerId: "scheduler-1",
      now: () => new Date("2026-01-01T00:00:00.000Z")
    });

    await expect(loop.tick()).resolves.toMatchObject({ scannedSchedules: 1, claimedOccurrences: 0 });
    expect(dispatched).toEqual([]);
  });

  it("applies fire all catch up limits / fire all catch up 상한을 적용한다", async () => {
    const store = new FakeScheduleStore();
    const dispatched: string[] = [];
    const loop = new SchedulerLoop({
      schedules: [
        defineSchedule({
          name: "billing.catch-up",
          jobName: "billing",
          trigger: createIntervalTrigger({
            everyMs: 60_000,
            startAt: new Date("2026-01-01T00:00:00.000Z")
          }),
          misfirePolicy: "fire-all",
          maxCatchUpOccurrences: 2
        })
      ],
      store,
      lockManager: new FakeLockManager(),
      dispatcher: async ({ occurrence }) => {
        dispatched.push(occurrence.occurrenceId);
      },
      ownerId: "scheduler-1",
      now: () => new Date("2026-01-01T00:04:00.000Z")
    });

    await loop.tick();

    expect(dispatched).toEqual([
      "schedule:billing.catch-up:2026-01-01T00:00:00.000Z",
      "schedule:billing.catch-up:2026-01-01T00:01:00.000Z"
    ]);
  });
});

class FakeScheduleStore implements ScheduleStore {
  readonly occurrences = new Map<string, ScheduleOccurrence>();

  async findLatestOccurrence(scheduleName: string): Promise<ScheduleOccurrence | undefined> {
    return [...this.occurrences.values()]
      .filter((occurrence) => occurrence.scheduleName === scheduleName)
      .sort((left, right) => right.scheduledAt.getTime() - left.scheduledAt.getTime())[0];
  }

  async claimOccurrence(
    candidate: ScheduleOccurrenceCandidate,
    options: { ownerId: string; claimedAt: Date; claimTtlMs?: number }
  ): Promise<ScheduleOccurrence | undefined> {
    const existing = this.occurrences.get(candidate.occurrenceId);
    if (existing && existing.status !== "claimed") {
      return undefined;
    }
    const occurrence: ScheduleOccurrence = {
      ...candidate,
      status: "claimed",
      ownerId: options.ownerId,
      claimedAt: options.claimedAt,
      claimExpiresAt: options.claimTtlMs === undefined ? undefined : new Date(options.claimedAt.getTime() + options.claimTtlMs)
    };
    this.occurrences.set(occurrence.occurrenceId, occurrence);
    return occurrence;
  }

  async markDispatched(occurrence: ScheduleOccurrence, options: { ownerId: string; dispatchedAt: Date }): Promise<boolean> {
    if (occurrence.ownerId !== options.ownerId) {
      return false;
    }
    this.occurrences.set(occurrence.occurrenceId, {
      ...occurrence,
      status: "dispatched",
      dispatchedAt: options.dispatchedAt
    });
    return true;
  }

  async markFailed(occurrence: ScheduleOccurrence, options: { ownerId: string; failedAt: Date; failureReason: string }): Promise<boolean> {
    this.occurrences.set(occurrence.occurrenceId, {
      ...occurrence,
      status: "failed",
      failedAt: options.failedAt,
      failureReason: options.failureReason
    });
    return true;
  }

  latest(scheduleName: string): ScheduleOccurrence | undefined {
    return [...this.occurrences.values()].find((occurrence) => occurrence.scheduleName === scheduleName);
  }
}

class FakeLockManager implements LockManager {
  constructor(private readonly options: { readonly deny?: boolean } = {}) {}

  async acquire(resource: string, ownerId: string): Promise<LockHandle | undefined> {
    return this.options.deny ? undefined : { resource, ownerId };
  }

  async release(): Promise<void> {
    return undefined;
  }
}
```

- [ ] **Step 2: Run RED**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/scheduler-core/test/scheduler-loop.test.ts
```

Expected: FAIL because `SchedulerLoop` is not exported.

- [ ] **Step 3: Implement SchedulerLoop**

Create `packages/scheduler-core/src/scheduler-loop.ts` with these public methods and internal flow:

```ts
import { createScheduleOccurrenceId } from "./occurrence-id.js";
import type {
  ScheduleDefinition,
  ScheduleOccurrence,
  SchedulerLoopOptions,
  SchedulerTickOptions,
  SchedulerTickResult
} from "./types.js";

export class SchedulerLoop {
  private readonly schedules: readonly ScheduleDefinition[];
  private readonly pollIntervalMs: number;

  constructor(private readonly options: SchedulerLoopOptions) {
    this.schedules = options.schedules;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    if (options.ownerId.trim().length === 0) {
      throw new TypeError("SchedulerLoop ownerId is required.");
    }
  }

  async tick(options: SchedulerTickOptions = {}): Promise<SchedulerTickResult> {
    const signal = options.signal ?? new AbortController().signal;
    const now = options.now ?? this.options.now?.() ?? new Date();
    const result = { scannedSchedules: 0, claimedOccurrences: 0, dispatchedOccurrences: 0, failedOccurrences: 0 };

    for (const schedule of this.schedules) {
      signal.throwIfAborted();
      result.scannedSchedules += 1;
      const lock = await this.options.lockManager.acquire(`schedule:${schedule.name}`, this.options.ownerId, {
        signal,
        ttlMs: this.options.lockTtlMs
      });

      if (!lock) {
        continue;
      }

      try {
        const latest = await this.options.store.findLatestOccurrence(schedule.name);
        const due = schedule.trigger.getDueOccurrences({ after: latest?.scheduledAt, now });
        const selected = selectDueOccurrences(schedule, due);

        for (const scheduledAt of selected) {
          signal.throwIfAborted();
          const occurrenceId = createScheduleOccurrenceId(schedule.name, scheduledAt);
          const claimed = await this.options.store.claimOccurrence(
            { scheduleName: schedule.name, occurrenceId, scheduledAt },
            { ownerId: this.options.ownerId, claimedAt: now, claimTtlMs: this.options.claimTtlMs }
          );

          if (!claimed) {
            continue;
          }

          result.claimedOccurrences += 1;
          await this.dispatch(schedule, claimed, signal, now, result);
        }
      } finally {
        await this.options.lockManager.release(lock);
      }
    }

    return result;
  }

  async runUntilStopped(options: { readonly signal?: AbortSignal } = {}): Promise<void> {
    const signal = options.signal ?? new AbortController().signal;
    while (!signal.aborted) {
      await this.tick({ signal });
      await delay(this.pollIntervalMs, signal);
    }
  }

  private async dispatch(
    schedule: ScheduleDefinition,
    occurrence: ScheduleOccurrence,
    signal: AbortSignal,
    now: Date,
    result: { dispatchedOccurrences: number; failedOccurrences: number }
  ): Promise<void> {
    try {
      await this.options.dispatcher({ schedule, occurrence, signal });
      if (await this.options.store.markDispatched(occurrence, { ownerId: this.options.ownerId, dispatchedAt: now })) {
        result.dispatchedOccurrences += 1;
      }
    } catch (error) {
      await this.options.store.markFailed(occurrence, {
        ownerId: this.options.ownerId,
        failedAt: now,
        failureReason: error instanceof Error ? error.message : String(error)
      });
      result.failedOccurrences += 1;
    }
  }
}

const selectDueOccurrences = (schedule: ScheduleDefinition, due: readonly Date[]): readonly Date[] => {
  if (due.length === 0) {
    return [];
  }

  if ((schedule.misfirePolicy ?? "fire-once") === "fire-once") {
    return [due[due.length - 1]!];
  }

  return due.slice(0, schedule.maxCatchUpOccurrences ?? 100);
};

const delay = (ms: number, signal: AbortSignal): Promise<void> => {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    }, { once: true });
  });
};
```

Export from `packages/scheduler-core/src/index.ts`:

```ts
export { SchedulerLoop } from "./scheduler-loop.js";
```

- [ ] **Step 4: Run GREEN**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/scheduler-core/test/scheduler-loop.test.ts
./node_modules/.bin/tsc -b packages/scheduler-core
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/scheduler-core/src/scheduler-loop.ts packages/scheduler-core/src/index.ts packages/scheduler-core/test/scheduler-loop.test.ts
git commit -m "feat : scheduler loop 추가" -m "- schedule lock과 occurrence claim 기반 dispatch 흐름을 구현"
```

---

### Task 4: Runner and Queue Schedule Dispatchers

**Files:**
- Create: `packages/scheduler-core/src/dispatchers.ts`
- Modify: `packages/scheduler-core/src/index.ts`
- Test: `packages/scheduler-core/test/dispatchers.test.ts`

**Interfaces:**
- Consumes: `resolveScheduleParameters`, `ScheduleDispatcher`, `RunnerScheduleDispatcherOptions`, `QueueScheduleDispatcherOptions`.
- Produces:
  - `createRunnerScheduleDispatcher(options: RunnerScheduleDispatcherOptions): ScheduleDispatcher`
  - `createQueueScheduleDispatcher(options: QueueScheduleDispatcherOptions): ScheduleDispatcher`

- [ ] **Step 1: Write failing dispatcher tests**

Create `packages/scheduler-core/test/dispatchers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BatchRunner, JobDefinition } from "@nest-batch/core";
import type { WorkQueue, WorkUnit } from "@nest-batch/queue-core";
import {
  createQueueScheduleDispatcher,
  createRunnerScheduleDispatcher,
  defineSchedule
} from "@nest-batch/scheduler-core";

describe("schedule dispatchers / schedule dispatcher를 검증한다", () => {
  it("runs jobs through BatchRunner / BatchRunner로 job을 실행한다", async () => {
    const job = { name: "billing", steps: [] } as unknown as JobDefinition;
    const runs: unknown[] = [];
    const runner: BatchRunner = {
      async run(receivedJob, parameters, options) {
        runs.push({ receivedJob, parameters, options });
        return { id: options.executionId!, instanceId: "instance", jobName: receivedJob.name, status: "completed", parameters, createdAt: new Date() };
      }
    };
    const dispatcher = createRunnerScheduleDispatcher({
      jobs: [job],
      runner,
      ownerId: "scheduler-runner"
    });
    const schedule = defineSchedule({
      name: "billing.daily",
      jobName: "billing",
      trigger: { getDueOccurrences: () => [] },
      parameters: { tenant: "acme" },
      runOptions: { lockTtlMs: 30_000 }
    });

    await dispatcher({
      schedule,
      occurrence: {
        scheduleName: schedule.name,
        occurrenceId: "schedule:billing.daily:2026-01-01T00:00:00.000Z",
        scheduledAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "claimed",
        ownerId: "scheduler-1"
      },
      signal: new AbortController().signal
    });

    expect(runs).toMatchObject([
      {
        receivedJob: job,
        parameters: { tenant: "acme" },
        options: {
          executionId: "schedule:billing.daily:2026-01-01T00:00:00.000Z",
          ownerId: "scheduler-runner",
          lockTtlMs: 30_000
        }
      }
    ]);
  });

  it("enqueues work using occurrence id / occurrence id로 work를 enqueue한다", async () => {
    const enqueued: WorkUnit[] = [];
    const queue: WorkQueue = {
      async enqueue(work) {
        enqueued.push(work);
      },
      async claim() {
        return undefined;
      },
      async complete() {
        return undefined;
      },
      async fail() {
        return undefined;
      }
    };
    const dispatcher = createQueueScheduleDispatcher({ queue, workType: "scheduled-job" });
    const schedule = defineSchedule({
      name: "billing.daily",
      jobName: "billing",
      trigger: { getDueOccurrences: () => [] },
      parameters: ({ scheduledAt }) => ({ billingDate: scheduledAt.toISOString().slice(0, 10) }),
      runOptions: { ownerId: "worker-owner", lockTtlMs: 10_000 }
    });

    await dispatcher({
      schedule,
      occurrence: {
        scheduleName: schedule.name,
        occurrenceId: "schedule:billing.daily:2026-01-02T00:00:00.000Z",
        scheduledAt: new Date("2026-01-02T00:00:00.000Z"),
        status: "claimed"
      },
      signal: new AbortController().signal
    });

    expect(enqueued).toEqual([
      {
        id: "schedule:billing.daily:2026-01-02T00:00:00.000Z",
        type: "scheduled-job",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        payload: {
          jobName: "billing",
          parameters: { billingDate: "2026-01-02" },
          executionId: "schedule:billing.daily:2026-01-02T00:00:00.000Z",
          ownerId: "worker-owner",
          lockTtlMs: 10_000,
          restart: false
        }
      }
    ]);
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/scheduler-core/test/dispatchers.test.ts
```

Expected: FAIL because dispatcher helpers do not exist.

- [ ] **Step 3: Implement dispatchers**

Create `packages/scheduler-core/src/dispatchers.ts`:

```ts
import { resolveScheduleParameters } from "./definition.js";
import type {
  QueueScheduleDispatcherOptions,
  RunnerScheduleDispatcherOptions,
  ScheduleDispatcher,
  ScheduledJobWorkUnit
} from "./types.js";

export const createRunnerScheduleDispatcher = (
  options: RunnerScheduleDispatcherOptions
): ScheduleDispatcher => {
  const jobsByName = new Map(options.jobs.map((job) => [job.name, job]));

  return async ({ schedule, occurrence, signal }) => {
    signal.throwIfAborted();
    const job = jobsByName.get(schedule.jobName);
    if (!job) {
      throw new Error(`Scheduled job "${schedule.jobName}" is not registered.`);
    }
    const parameters = resolveScheduleParameters(schedule, occurrence.occurrenceId, occurrence.scheduledAt);
    await options.runner.run(job, parameters, {
      ...schedule.runOptions,
      executionId: occurrence.occurrenceId,
      ownerId: schedule.runOptions?.ownerId ?? options.ownerId,
      signal
    });
  };
};

export const createQueueScheduleDispatcher = (
  options: QueueScheduleDispatcherOptions
): ScheduleDispatcher => {
  return async ({ schedule, occurrence, signal }) => {
    signal.throwIfAborted();
    const parameters = resolveScheduleParameters(schedule, occurrence.occurrenceId, occurrence.scheduledAt);
    const work: ScheduledJobWorkUnit = {
      id: occurrence.occurrenceId,
      type: options.workType ?? "nest-batch.scheduled-job",
      createdAt: occurrence.scheduledAt,
      payload: {
        jobName: schedule.jobName,
        parameters,
        executionId: occurrence.occurrenceId,
        ownerId: schedule.runOptions?.ownerId,
        lockTtlMs: schedule.runOptions?.lockTtlMs,
        restart: false
      }
    };

    await options.queue.enqueue(work);
  };
};
```

Export from `packages/scheduler-core/src/index.ts`:

```ts
export { createQueueScheduleDispatcher, createRunnerScheduleDispatcher } from "./dispatchers.js";
```

- [ ] **Step 4: Run GREEN**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/scheduler-core/test/dispatchers.test.ts
./node_modules/.bin/tsc -b packages/scheduler-core
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/scheduler-core/src/dispatchers.ts packages/scheduler-core/src/index.ts packages/scheduler-core/test/dispatchers.test.ts
git commit -m "feat : scheduler dispatcher 추가" -m "- BatchRunner와 WorkQueue 기반 schedule dispatch helper를 구현"
```

---

### Task 5: In-Memory Schedule Store

**Files:**
- Create: `packages/inmemory/src/schedule-store.ts`
- Modify: `packages/inmemory/src/index.ts`
- Modify: `packages/inmemory/package.json`
- Modify: `packages/inmemory/tsconfig.json`
- Test: `packages/inmemory/test/schedule-store.test.ts`

**Interfaces:**
- Consumes: `ScheduleStore`, `ScheduleOccurrence`, `ScheduleOccurrenceCandidate` from `@nest-batch/scheduler-core`.
- Produces: `class InMemoryScheduleStore implements ScheduleStore`.

- [ ] **Step 1: Write failing in-memory tests**

Create `packages/inmemory/test/schedule-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryScheduleStore } from "@nest-batch/inmemory";

describe("inmemory schedule store / inmemory schedule store를 검증한다", () => {
  it("claims dispatches and fails occurrences / occurrence claim dispatch fail을 저장한다", async () => {
    const store = new InMemoryScheduleStore();
    const candidate = {
      scheduleName: "billing.daily",
      occurrenceId: "schedule:billing.daily:2026-01-01T00:00:00.000Z",
      scheduledAt: new Date("2026-01-01T00:00:00.000Z")
    };

    const claimed = await store.claimOccurrence(candidate, {
      ownerId: "scheduler-1",
      claimedAt: new Date("2026-01-01T00:00:01.000Z"),
      claimTtlMs: 30_000
    });

    expect(claimed).toMatchObject({
      occurrenceId: candidate.occurrenceId,
      status: "claimed",
      ownerId: "scheduler-1"
    });
    await expect(store.markDispatched(claimed!, {
      ownerId: "scheduler-1",
      dispatchedAt: new Date("2026-01-01T00:00:02.000Z")
    })).resolves.toBe(true);
    await expect(store.findLatestOccurrence("billing.daily")).resolves.toMatchObject({
      occurrenceId: candidate.occurrenceId,
      status: "dispatched"
    });
  });

  it("rejects owned completion from another owner / 다른 owner의 완료 기록을 거부한다", async () => {
    const store = new InMemoryScheduleStore();
    const claimed = await store.claimOccurrence({
      scheduleName: "billing.daily",
      occurrenceId: "schedule:billing.daily:2026-01-01T00:00:00.000Z",
      scheduledAt: new Date("2026-01-01T00:00:00.000Z")
    }, {
      ownerId: "scheduler-1",
      claimedAt: new Date("2026-01-01T00:00:01.000Z")
    });

    await expect(store.markDispatched(claimed!, {
      ownerId: "scheduler-2",
      dispatchedAt: new Date("2026-01-01T00:00:02.000Z")
    })).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/inmemory/test/schedule-store.test.ts
```

Expected: FAIL because `InMemoryScheduleStore` is not exported.

- [ ] **Step 3: Implement in-memory store**

Add `@nest-batch/scheduler-core` dependency to `packages/inmemory/package.json`.

Add `{ "path": "../scheduler-core" }` to `packages/inmemory/tsconfig.json` references.

Create `packages/inmemory/src/schedule-store.ts`:

```ts
import type {
  ScheduleClaimOptions,
  ScheduleMarkDispatchedOptions,
  ScheduleMarkFailedOptions,
  ScheduleOccurrence,
  ScheduleOccurrenceCandidate,
  ScheduleStore
} from "@nest-batch/scheduler-core";

export class InMemoryScheduleStore implements ScheduleStore {
  private readonly occurrences = new Map<string, ScheduleOccurrence>();

  async findLatestOccurrence(scheduleName: string): Promise<ScheduleOccurrence | undefined> {
    const occurrence = [...this.occurrences.values()]
      .filter((candidate) => candidate.scheduleName === scheduleName)
      .sort(compareOccurrenceDesc)[0];

    return occurrence ? cloneOccurrence(occurrence) : undefined;
  }

  async claimOccurrence(
    candidate: ScheduleOccurrenceCandidate,
    options: ScheduleClaimOptions
  ): Promise<ScheduleOccurrence | undefined> {
    const existing = this.occurrences.get(candidate.occurrenceId);
    if (existing && !canReclaim(existing, options.claimedAt)) {
      return undefined;
    }

    const claimed: ScheduleOccurrence = {
      ...candidate,
      status: "claimed",
      ownerId: options.ownerId,
      claimedAt: options.claimedAt,
      claimExpiresAt: options.claimTtlMs === undefined ? undefined : new Date(options.claimedAt.getTime() + options.claimTtlMs)
    };
    this.occurrences.set(claimed.occurrenceId, cloneOccurrence(claimed));
    return cloneOccurrence(claimed);
  }

  async markDispatched(
    occurrence: ScheduleOccurrence,
    options: ScheduleMarkDispatchedOptions
  ): Promise<boolean> {
    return this.updateOwned(occurrence, options.ownerId, {
      ...occurrence,
      status: "dispatched",
      dispatchedAt: options.dispatchedAt
    });
  }

  async markFailed(occurrence: ScheduleOccurrence, options: ScheduleMarkFailedOptions): Promise<boolean> {
    return this.updateOwned(occurrence, options.ownerId, {
      ...occurrence,
      status: "failed",
      failedAt: options.failedAt,
      failureReason: options.failureReason
    });
  }

  private updateOwned(occurrence: ScheduleOccurrence, ownerId: string, next: ScheduleOccurrence): boolean {
    const stored = this.occurrences.get(occurrence.occurrenceId);
    if (!stored || stored.status !== "claimed" || stored.ownerId !== ownerId) {
      return false;
    }
    this.occurrences.set(occurrence.occurrenceId, cloneOccurrence(next));
    return true;
  }
}

const canReclaim = (occurrence: ScheduleOccurrence, now: Date): boolean =>
  occurrence.status === "claimed" &&
  occurrence.claimExpiresAt !== undefined &&
  occurrence.claimExpiresAt.getTime() <= now.getTime();

const cloneOccurrence = (occurrence: ScheduleOccurrence): ScheduleOccurrence => ({
  ...occurrence,
  scheduledAt: new Date(occurrence.scheduledAt),
  claimedAt: occurrence.claimedAt ? new Date(occurrence.claimedAt) : undefined,
  claimExpiresAt: occurrence.claimExpiresAt ? new Date(occurrence.claimExpiresAt) : undefined,
  dispatchedAt: occurrence.dispatchedAt ? new Date(occurrence.dispatchedAt) : undefined,
  failedAt: occurrence.failedAt ? new Date(occurrence.failedAt) : undefined
});

const compareOccurrenceDesc = (left: ScheduleOccurrence, right: ScheduleOccurrence): number => {
  const diff = right.scheduledAt.getTime() - left.scheduledAt.getTime();
  return diff === 0 ? right.occurrenceId.localeCompare(left.occurrenceId) : diff;
};
```

Export from `packages/inmemory/src/index.ts`:

```ts
export { InMemoryScheduleStore } from "./schedule-store.js";
```

- [ ] **Step 4: Run GREEN**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/inmemory/test/schedule-store.test.ts
./node_modules/.bin/tsc -b packages/inmemory
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/inmemory/package.json packages/inmemory/tsconfig.json packages/inmemory/src packages/inmemory/test/schedule-store.test.ts
git commit -m "feat : in-memory schedule store 추가" -m "- 테스트와 예제용 non-durable occurrence store를 구현"
```

---

### Task 6: Postgres Schedule Store

**Files:**
- Create: `packages/postgres/src/schedule-schema.ts`
- Create: `packages/postgres/src/schedule-store.ts`
- Modify: `packages/postgres/src/sql.ts`
- Modify: `packages/postgres/src/index.ts`
- Modify: `packages/postgres/package.json`
- Modify: `packages/postgres/tsconfig.json`
- Test: `packages/postgres/test/schedule-store.test.ts`

**Interfaces:**
- Consumes: `ScheduleStore` from `@nest-batch/scheduler-core`, existing `PostgresBatchOptions`, `resolvePostgresPool()`, `createPostgresTables()`, `rowsFromPostgresResult()`, `rowCountFromPostgresResult()`, `parsePostgresRequiredDate()`, `parsePostgresOptionalDate()`.
- Produces: `class PostgresScheduleStore implements ScheduleStore` with `initialize(): Promise<void>`.

- [ ] **Step 1: Write failing Postgres tests**

Create `packages/postgres/test/schedule-store.test.ts` with fake pool calls:

```ts
import { describe, expect, it } from "vitest";
import { PostgresScheduleStore } from "@nest-batch/postgres";

describe("postgres schedule store / postgres schedule store를 검증한다", () => {
  it("claims and marks schedule occurrences through postgres SQL / postgres SQL로 schedule occurrence를 claim하고 상태를 기록한다", async () => {
    const pool = new FakePostgresPool();
    const store = new PostgresScheduleStore({ pool, schema: "batch", tablePrefix: "nb" });
    pool.queueRows([{ schedule_name: "billing.daily", occurrence_id: "occ-1", scheduled_at: new Date("2026-01-01T00:00:00.000Z"), status: "claimed", owner_id: "scheduler-1", claimed_at: new Date("2026-01-01T00:00:01.000Z"), claim_expires_at: null, dispatched_at: null, failed_at: null, failure_reason: null }]);

    const claimed = await store.claimOccurrence({
      scheduleName: "billing.daily",
      occurrenceId: "occ-1",
      scheduledAt: new Date("2026-01-01T00:00:00.000Z")
    }, {
      ownerId: "scheduler-1",
      claimedAt: new Date("2026-01-01T00:00:01.000Z")
    });

    expect(claimed).toMatchObject({ occurrenceId: "occ-1", status: "claimed", ownerId: "scheduler-1" });
    pool.queueRowCount(1);
    await expect(store.markDispatched(claimed!, {
      ownerId: "scheduler-1",
      dispatchedAt: new Date("2026-01-01T00:00:02.000Z")
    })).resolves.toBe(true);
    expect(pool.calls[0]?.sql).toContain('INSERT INTO "batch"."nb_schedule_occurrences"');
    expect(pool.calls[1]?.sql).toContain("UPDATE");
  });

  it("initializes schedule occurrence table / schedule occurrence table을 초기화한다", async () => {
    const pool = new FakePostgresPool();
    const store = new PostgresScheduleStore({ pool, schema: "batch", tablePrefix: "nb" });

    await store.initialize();

    expect(pool.calls.map((call) => call.sql)).toEqual([
      expect.stringContaining('CREATE SCHEMA IF NOT EXISTS "batch"'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "batch"."nb_schedule_occurrences"'),
      expect.stringContaining('CREATE INDEX IF NOT EXISTS "idx_nb_schedule_occurrences_latest"')
    ]);
  });
});

class FakePostgresPool {
  readonly calls: { readonly sql: string; readonly values?: readonly unknown[] }[] = [];
  private readonly rows: unknown[][] = [];
  private readonly rowCounts: number[] = [];

  queueRows(rows: unknown[]): void {
    this.rows.push(rows);
  }

  queueRowCount(rowCount: number): void {
    this.rowCounts.push(rowCount);
  }

  async query(sql: string, values?: readonly unknown[]): Promise<unknown> {
    this.calls.push({ sql, values });
    if (sql.trim().startsWith("SELECT") || sql.includes("RETURNING")) {
      return { rows: this.rows.shift() ?? [], rowCount: this.rowCounts.shift() ?? 0 };
    }
    return { rows: [], rowCount: this.rowCounts.shift() ?? 0 };
  }
}
```

- [ ] **Step 2: Run RED**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/postgres/test/schedule-store.test.ts
```

Expected: FAIL because `PostgresScheduleStore` is not exported.

- [ ] **Step 3: Implement Postgres schedule table helpers**

Add `@nest-batch/scheduler-core` dependency and tsconfig reference.

Modify `PostgresTables` in `packages/postgres/src/sql.ts`:

```ts
readonly scheduleOccurrences: string;
readonly scheduleOccurrencesLatestIndex: string;
```

Add table names in `createPostgresTables()`:

```ts
scheduleOccurrences: qualify("schedule_occurrences"),
scheduleOccurrencesLatestIndex: quotePostgresIdentifier(`idx_${tablePrefix}_schedule_occurrences_latest`)
```

Create `packages/postgres/src/schedule-schema.ts`:

```ts
import { resolvePostgresPool } from "./driver.js";
import type { PostgresBatchOptions } from "./options.js";
import { createPostgresTables } from "./sql.js";

export const ensurePostgresScheduleSchema = async (options: PostgresBatchOptions): Promise<void> => {
  const pool = resolvePostgresPool(options);
  const tables = createPostgresTables(options);

  if (tables.schema) {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${tables.schema}"`);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tables.scheduleOccurrences} (
      schedule_name TEXT NOT NULL,
      occurrence_id TEXT NOT NULL,
      scheduled_at TIMESTAMPTZ(3) NOT NULL,
      status TEXT NOT NULL,
      owner_id TEXT NULL,
      claimed_at TIMESTAMPTZ(3) NULL,
      claim_expires_at TIMESTAMPTZ(3) NULL,
      dispatched_at TIMESTAMPTZ(3) NULL,
      failed_at TIMESTAMPTZ(3) NULL,
      failure_reason TEXT NULL,
      PRIMARY KEY (schedule_name, occurrence_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ${tables.scheduleOccurrencesLatestIndex}
    ON ${tables.scheduleOccurrences} (schedule_name, scheduled_at DESC, occurrence_id DESC)
  `);
};
```

- [ ] **Step 4: Implement PostgresScheduleStore**

Create `packages/postgres/src/schedule-store.ts`:

```ts
import type {
  ScheduleClaimOptions,
  ScheduleMarkDispatchedOptions,
  ScheduleMarkFailedOptions,
  ScheduleOccurrence,
  ScheduleOccurrenceCandidate,
  ScheduleStore
} from "@nest-batch/scheduler-core";
import { resolvePostgresPool } from "./driver.js";
import type { PostgresBatchOptions, PostgresPoolLike } from "./options.js";
import { ensurePostgresScheduleSchema } from "./schedule-schema.js";
import {
  createPostgresTables,
  parsePostgresOptionalDate,
  parsePostgresRequiredDate,
  rowsFromPostgresResult,
  rowCountFromPostgresResult
} from "./sql.js";

interface PostgresScheduleOccurrenceRow {
  readonly schedule_name: string;
  readonly occurrence_id: string;
  readonly scheduled_at: unknown;
  readonly status: string;
  readonly owner_id: unknown;
  readonly claimed_at: unknown;
  readonly claim_expires_at: unknown;
  readonly dispatched_at: unknown;
  readonly failed_at: unknown;
  readonly failure_reason: unknown;
}

export class PostgresScheduleStore implements ScheduleStore {
  private readonly pool: PostgresPoolLike;
  private readonly tables: ReturnType<typeof createPostgresTables>;

  constructor(private readonly options: PostgresBatchOptions) {
    this.pool = resolvePostgresPool(options);
    this.tables = createPostgresTables(options);
  }

  async initialize(): Promise<void> {
    await ensurePostgresScheduleSchema(this.options);
  }

  async findLatestOccurrence(scheduleName: string): Promise<ScheduleOccurrence | undefined> {
    const result = await this.pool.query<PostgresScheduleOccurrenceRow>(
      `SELECT * FROM ${this.tables.scheduleOccurrences}
       WHERE schedule_name = $1
       ORDER BY scheduled_at DESC, occurrence_id DESC
       LIMIT 1`,
      [scheduleName]
    );
    const [row] = rowsFromPostgresResult<PostgresScheduleOccurrenceRow>(result);
    return row ? mapPostgresScheduleOccurrence(row) : undefined;
  }

  async claimOccurrence(candidate: ScheduleOccurrenceCandidate, options: ScheduleClaimOptions): Promise<ScheduleOccurrence | undefined> {
    const claimExpiresAt = options.claimTtlMs === undefined ? undefined : new Date(options.claimedAt.getTime() + options.claimTtlMs);
    const result = await this.pool.query<PostgresScheduleOccurrenceRow>(
      `INSERT INTO ${this.tables.scheduleOccurrences} (
         schedule_name, occurrence_id, scheduled_at, status, owner_id, claimed_at, claim_expires_at
       ) VALUES ($1, $2, $3, 'claimed', $4, $5, $6)
       ON CONFLICT (schedule_name, occurrence_id) DO UPDATE
       SET status = 'claimed',
           owner_id = EXCLUDED.owner_id,
           claimed_at = EXCLUDED.claimed_at,
           claim_expires_at = EXCLUDED.claim_expires_at,
           dispatched_at = NULL,
           failed_at = NULL,
           failure_reason = NULL
       WHERE ${this.tables.scheduleOccurrences}.status = 'claimed'
         AND ${this.tables.scheduleOccurrences}.claim_expires_at IS NOT NULL
         AND ${this.tables.scheduleOccurrences}.claim_expires_at <= EXCLUDED.claimed_at
       RETURNING *`,
      [candidate.scheduleName, candidate.occurrenceId, candidate.scheduledAt, options.ownerId, options.claimedAt, claimExpiresAt]
    );
    const [row] = rowsFromPostgresResult<PostgresScheduleOccurrenceRow>(result);
    return row ? mapPostgresScheduleOccurrence(row) : undefined;
  }

  async markDispatched(occurrence: ScheduleOccurrence, options: ScheduleMarkDispatchedOptions): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ${this.tables.scheduleOccurrences}
       SET status = 'dispatched', dispatched_at = $4
       WHERE schedule_name = $1 AND occurrence_id = $2 AND owner_id = $3 AND status = 'claimed'`,
      [occurrence.scheduleName, occurrence.occurrenceId, options.ownerId, options.dispatchedAt]
    );
    return rowCountFromPostgresResult(result) > 0;
  }

  async markFailed(occurrence: ScheduleOccurrence, options: ScheduleMarkFailedOptions): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ${this.tables.scheduleOccurrences}
       SET status = 'failed', failed_at = $4, failure_reason = $5
       WHERE schedule_name = $1 AND occurrence_id = $2 AND owner_id = $3 AND status = 'claimed'`,
      [occurrence.scheduleName, occurrence.occurrenceId, options.ownerId, options.failedAt, options.failureReason]
    );
    return rowCountFromPostgresResult(result) > 0;
  }
}

const mapPostgresScheduleOccurrence = (row: PostgresScheduleOccurrenceRow): ScheduleOccurrence => ({
  scheduleName: row.schedule_name,
  occurrenceId: row.occurrence_id,
  scheduledAt: parsePostgresRequiredDate(row.scheduled_at, "scheduled_at"),
  status: parseScheduleStatus(row.status),
  ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
  claimedAt: parsePostgresOptionalDate(row.claimed_at),
  claimExpiresAt: parsePostgresOptionalDate(row.claim_expires_at),
  dispatchedAt: parsePostgresOptionalDate(row.dispatched_at),
  failedAt: parsePostgresOptionalDate(row.failed_at),
  failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined
});

const parseScheduleStatus = (status: string): ScheduleOccurrence["status"] => {
  if (status === "claimed" || status === "dispatched" || status === "failed") {
    return status;
  }
  throw new TypeError("Invalid Postgres schedule occurrence status.");
};
```

Export from `packages/postgres/src/index.ts`:

```ts
export { PostgresScheduleStore } from "./schedule-store.js";
export { ensurePostgresScheduleSchema } from "./schedule-schema.js";
```

- [ ] **Step 5: Run GREEN**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/postgres/test/schedule-store.test.ts
./node_modules/.bin/tsc -b packages/postgres
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/postgres/package.json packages/postgres/tsconfig.json packages/postgres/src packages/postgres/test/schedule-store.test.ts
git commit -m "feat : Postgres schedule store 추가" -m "- Postgres occurrence table과 claim 상태 전이를 구현"
```

---

### Task 7: MySQL and MariaDB Schedule Stores

**Files:**
- Create: `packages/mysql/src/schedule-schema.ts`
- Create: `packages/mysql/src/schedule-store.ts`
- Modify: `packages/mysql/src/sql.ts`
- Modify: `packages/mysql/src/index.ts`
- Modify: `packages/mysql/package.json`
- Modify: `packages/mysql/tsconfig.json`
- Test: `packages/mysql/test/schedule-store.test.ts`
- Create: `packages/mariadb/src/schedule-schema.ts`
- Create: `packages/mariadb/src/schedule-store.ts`
- Modify: `packages/mariadb/src/sql.ts`
- Modify: `packages/mariadb/src/index.ts`
- Modify: `packages/mariadb/package.json`
- Modify: `packages/mariadb/tsconfig.json`
- Test: `packages/mariadb/test/schedule-store.test.ts`

**Interfaces:**
- Consumes: Task 6 SQL store shape, `ScheduleStore`, MySQL/MariaDB driver helpers.
- Produces:
  - `MySqlScheduleStore implements ScheduleStore`
  - `MariaDbScheduleStore implements ScheduleStore`
  - `ensureMySqlScheduleSchema()`
  - `ensureMariaDbScheduleSchema()`

- [ ] **Step 1: Write failing MySQL tests**

Create `packages/mysql/test/schedule-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MySqlScheduleStore } from "@nest-batch/mysql";

describe("mysql schedule store / mysql schedule store를 검증한다", () => {
  it("claims and marks schedule occurrences through mysql SQL / mysql SQL로 schedule occurrence를 claim하고 상태를 기록한다", async () => {
    const pool = new FakeMySqlPool();
    const store = new MySqlScheduleStore({ pool, database: "nest_batch", tablePrefix: "nb" });
    pool.queueRows([{ schedule_name: "billing.daily", occurrence_id: "occ-1", scheduled_at: new Date("2026-01-01T00:00:00.000Z"), status: "claimed", owner_id: "scheduler-1", claimed_at: new Date("2026-01-01T00:00:01.000Z"), claim_expires_at: null, dispatched_at: null, failed_at: null, failure_reason: null }]);

    const claimed = await store.claimOccurrence({
      scheduleName: "billing.daily",
      occurrenceId: "occ-1",
      scheduledAt: new Date("2026-01-01T00:00:00.000Z")
    }, {
      ownerId: "scheduler-1",
      claimedAt: new Date("2026-01-01T00:00:01.000Z")
    });

    expect(claimed).toMatchObject({ occurrenceId: "occ-1", status: "claimed" });
    pool.queueAffectedRows(1);
    await expect(store.markFailed(claimed!, {
      ownerId: "scheduler-1",
      failedAt: new Date("2026-01-01T00:00:02.000Z"),
      failureReason: "enqueue failed"
    })).resolves.toBe(true);
    expect(pool.calls[0]?.sql).toContain("INSERT INTO `nest_batch`.`nb_schedule_occurrences`");
  });
});

class FakeMySqlPool {
  readonly calls: { readonly sql: string; readonly values?: unknown }[] = [];
  private readonly rows: unknown[][] = [];
  private readonly affectedRows: number[] = [];

  queueRows(rows: unknown[]): void {
    this.rows.push(rows);
  }

  queueAffectedRows(value: number): void {
    this.affectedRows.push(value);
  }

  async execute(sql: string, values?: unknown): Promise<unknown> {
    this.calls.push({ sql, values });
    if (sql.trim().startsWith("SELECT")) {
      return [this.rows.shift() ?? []];
    }
    return [{ affectedRows: this.affectedRows.shift() ?? 0 }];
  }
}
```

- [ ] **Step 2: Write failing MariaDB tests**

Create `packages/mariadb/test/schedule-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MariaDbScheduleStore } from "@nest-batch/mariadb";

describe("mariadb schedule store / mariadb schedule store를 검증한다", () => {
  it("claims and marks schedule occurrences through mariadb SQL / mariadb SQL로 schedule occurrence를 claim하고 상태를 기록한다", async () => {
    const pool = new FakeMariaDbPool();
    const store = new MariaDbScheduleStore({ pool, database: "nest_batch", tablePrefix: "nb" });
    pool.queueRows([{ schedule_name: "billing.daily", occurrence_id: "occ-1", scheduled_at: new Date("2026-01-01T00:00:00.000Z"), status: "claimed", owner_id: "scheduler-1", claimed_at: new Date("2026-01-01T00:00:01.000Z"), claim_expires_at: null, dispatched_at: null, failed_at: null, failure_reason: null }]);

    const claimed = await store.claimOccurrence({
      scheduleName: "billing.daily",
      occurrenceId: "occ-1",
      scheduledAt: new Date("2026-01-01T00:00:00.000Z")
    }, {
      ownerId: "scheduler-1",
      claimedAt: new Date("2026-01-01T00:00:01.000Z")
    });

    expect(claimed).toMatchObject({ occurrenceId: "occ-1", status: "claimed" });
    pool.queueAffectedRows(1);
    await expect(store.markDispatched(claimed!, {
      ownerId: "scheduler-1",
      dispatchedAt: new Date("2026-01-01T00:00:02.000Z")
    })).resolves.toBe(true);
    expect(pool.calls[0]?.sql).toContain("INSERT INTO `nest_batch`.`nb_schedule_occurrences`");
  });
});

class FakeMariaDbPool {
  readonly calls: { readonly sql: string; readonly values?: readonly unknown[] }[] = [];
  private readonly rows: unknown[][] = [];
  private readonly affectedRows: number[] = [];

  queueRows(rows: unknown[]): void {
    this.rows.push(rows);
  }

  queueAffectedRows(value: number): void {
    this.affectedRows.push(value);
  }

  async query(sql: string, values?: readonly unknown[]): Promise<unknown> {
    this.calls.push({ sql, values });
    if (sql.trim().startsWith("SELECT")) {
      return this.rows.shift() ?? [];
    }
    return { affectedRows: this.affectedRows.shift() ?? 0 };
  }
}
```

- [ ] **Step 3: Run RED**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/mysql/test/schedule-store.test.ts packages/mariadb/test/schedule-store.test.ts
```

Expected: FAIL because MySQL and MariaDB schedule stores are not exported.

- [ ] **Step 4: Implement MySQL schedule store**

Add `@nest-batch/scheduler-core` dependency and tsconfig reference in `packages/mysql`.

Add `scheduleOccurrences` to `MySqlTables` and `createMySqlTables()`:

```ts
readonly scheduleOccurrences: string;
scheduleOccurrences: qualify("schedule_occurrences")
```

Create `packages/mysql/src/schedule-schema.ts`:

```ts
import { resolveMySqlPool } from "./driver.js";
import type { MySqlBatchOptions } from "./options.js";
import { createMySqlTables } from "./sql.js";

export const ensureMySqlScheduleSchema = async (options: MySqlBatchOptions): Promise<void> => {
  const pool = resolveMySqlPool(options);
  const tables = createMySqlTables(options);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ${tables.scheduleOccurrences} (
      schedule_name VARCHAR(255) NOT NULL,
      occurrence_id VARCHAR(191) NOT NULL,
      scheduled_at DATETIME(3) NOT NULL,
      status VARCHAR(32) NOT NULL,
      owner_id VARCHAR(255) NULL,
      claimed_at DATETIME(3) NULL,
      claim_expires_at DATETIME(3) NULL,
      dispatched_at DATETIME(3) NULL,
      failed_at DATETIME(3) NULL,
      failure_reason TEXT NULL,
      PRIMARY KEY (schedule_name, occurrence_id),
      KEY idx_schedule_occurrences_latest (schedule_name, scheduled_at, occurrence_id)
    ) ENGINE=InnoDB
  `);
};
```

Create `packages/mysql/src/schedule-store.ts` with these methods:

```ts
initialize(): Promise<void>
findLatestOccurrence(scheduleName: string): Promise<ScheduleOccurrence | undefined>
claimOccurrence(candidate: ScheduleOccurrenceCandidate, options: ScheduleClaimOptions): Promise<ScheduleOccurrence | undefined>
markDispatched(occurrence: ScheduleOccurrence, options: ScheduleMarkDispatchedOptions): Promise<boolean>
markFailed(occurrence: ScheduleOccurrence, options: ScheduleMarkFailedOptions): Promise<boolean>
```

Use `pool.execute()`, `?` placeholders, `rowsFromMySqlResult()`, `affectedRowsFromMySqlResult()`, `parseMySqlRequiredDate()`, and `parseMySqlOptionalDate()`. The claim SQL must use MySQL-compatible upsert:

```sql
INSERT INTO ${tables.scheduleOccurrences} (
  schedule_name, occurrence_id, scheduled_at, status, owner_id, claimed_at, claim_expires_at
) VALUES (?, ?, ?, 'claimed', ?, ?, ?)
ON DUPLICATE KEY UPDATE
  status = IF(status = 'claimed' AND claim_expires_at IS NOT NULL AND claim_expires_at <= VALUES(claimed_at), 'claimed', status),
  owner_id = IF(status = 'claimed' AND claim_expires_at IS NOT NULL AND claim_expires_at <= VALUES(claimed_at), VALUES(owner_id), owner_id),
  claimed_at = IF(status = 'claimed' AND claim_expires_at IS NOT NULL AND claim_expires_at <= VALUES(claimed_at), VALUES(claimed_at), claimed_at),
  claim_expires_at = IF(status = 'claimed' AND claim_expires_at IS NOT NULL AND claim_expires_at <= VALUES(claimed_at), VALUES(claim_expires_at), claim_expires_at)
```

After the upsert, run `SELECT * FROM ${tables.scheduleOccurrences} WHERE schedule_name = ? AND occurrence_id = ? AND status = 'claimed' AND owner_id = ?` and return the row if present.

Export:

```ts
export { MySqlScheduleStore } from "./schedule-store.js";
export { ensureMySqlScheduleSchema } from "./schedule-schema.js";
```

- [ ] **Step 5: Implement MariaDB schedule store**

Add `@nest-batch/scheduler-core` dependency and tsconfig reference in `packages/mariadb`.

Add `scheduleOccurrences` to `MariaDbTables` and `createMariaDbTables()`:

```ts
readonly scheduleOccurrences: string;
scheduleOccurrences: qualify("schedule_occurrences")
```

Create `packages/mariadb/src/schedule-schema.ts`:

```ts
import { resolveMariaDbPool } from "./driver.js";
import type { MariaDbBatchOptions } from "./options.js";
import { createMariaDbTables } from "./sql.js";

export const ensureMariaDbScheduleSchema = async (options: MariaDbBatchOptions): Promise<void> => {
  const pool = resolveMariaDbPool(options);
  const tables = createMariaDbTables(options);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tables.scheduleOccurrences} (
      schedule_name VARCHAR(255) NOT NULL,
      occurrence_id VARCHAR(191) NOT NULL,
      scheduled_at DATETIME(3) NOT NULL,
      status VARCHAR(32) NOT NULL,
      owner_id VARCHAR(255) NULL,
      claimed_at DATETIME(3) NULL,
      claim_expires_at DATETIME(3) NULL,
      dispatched_at DATETIME(3) NULL,
      failed_at DATETIME(3) NULL,
      failure_reason TEXT NULL,
      PRIMARY KEY (schedule_name, occurrence_id),
      KEY idx_schedule_occurrences_latest (schedule_name, scheduled_at, occurrence_id)
    ) ENGINE=InnoDB
  `);
};
```

Create `packages/mariadb/src/schedule-store.ts` with these methods:

```ts
initialize(): Promise<void>
findLatestOccurrence(scheduleName: string): Promise<ScheduleOccurrence | undefined>
claimOccurrence(candidate: ScheduleOccurrenceCandidate, options: ScheduleClaimOptions): Promise<ScheduleOccurrence | undefined>
markDispatched(occurrence: ScheduleOccurrence, options: ScheduleMarkDispatchedOptions): Promise<boolean>
markFailed(occurrence: ScheduleOccurrence, options: ScheduleMarkFailedOptions): Promise<boolean>
```

Use `pool.query()`, `?` placeholders, `rowsFromMariaDbResult()`, `affectedRowsFromMariaDbResult()`, `parseMariaDbRequiredDate()`, and `parseMariaDbOptionalDate()`. The claim flow must run an upsert followed by `SELECT * FROM ${tables.scheduleOccurrences} WHERE schedule_name = ? AND occurrence_id = ? AND status = 'claimed' AND owner_id = ?`.

Export:

```ts
export { MariaDbScheduleStore } from "./schedule-store.js";
export { ensureMariaDbScheduleSchema } from "./schedule-schema.js";
```

- [ ] **Step 6: Run GREEN**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/mysql/test/schedule-store.test.ts packages/mariadb/test/schedule-store.test.ts
./node_modules/.bin/tsc -b packages/mysql packages/mariadb
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/mysql packages/mariadb
git commit -m "feat : MySQL MariaDB schedule store 추가" -m "- MySQL과 MariaDB occurrence table과 claim 상태 전이를 구현"
```

---

### Task 8: CLI Schedule Command

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `packages/cli/tsconfig.json`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/test/run-cli.test.ts`

**Interfaces:**
- Consumes: `SchedulerLoop`, `ScheduleDefinition`, `ScheduleStore`, `ScheduleDispatcher`, `createQueueScheduleDispatcher`, `createRunnerScheduleDispatcher`.
- Produces:
  - `CliContext.schedules?: readonly ScheduleDefinition[]`
  - `CliContext.scheduleStore?: ScheduleStore`
  - `CliContext.schedulerDispatcher?: ScheduleDispatcher`
  - `CliContext.schedulerLoop?: SchedulerLoop`
  - CLI command `schedule`

- [ ] **Step 1: Write failing CLI schedule tests**

Append to `packages/cli/test/run-cli.test.ts`:

```ts
it("runs scheduler once from CLI / CLI에서 scheduler를 한 번 실행한다", async () => {
  const loop = {
    async tick() {
      return {
        scannedSchedules: 1,
        claimedOccurrences: 1,
        dispatchedOccurrences: 1,
        failedOccurrences: 0
      };
    }
  };

  const result = await runCli(["schedule", "--once", "--scheduler-id", "scheduler-1"], {
    schedulerLoop: loop as any
  });

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.output)).toEqual({
    command: "schedule",
    schedulerId: "scheduler-1",
    result: {
      scannedSchedules: 1,
      claimedOccurrences: 1,
      dispatchedOccurrences: 1,
      failedOccurrences: 0
    }
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/cli/test/run-cli.test.ts
```

Expected: FAIL because `schedule` is an unknown command.

- [ ] **Step 3: Implement schedule command**

Add `@nest-batch/scheduler-core` dependency and tsconfig reference to `packages/cli`.

In `packages/cli/src/index.ts`, import:

```ts
import {
  SchedulerLoop,
  createQueueScheduleDispatcher,
  createRunnerScheduleDispatcher
} from "@nest-batch/scheduler-core";
import type {
  ScheduleDefinition,
  ScheduleDispatcher,
  ScheduleStore
} from "@nest-batch/scheduler-core";
```

Extend `CliContext`:

```ts
readonly schedules?: readonly ScheduleDefinition[];
readonly scheduleStore?: ScheduleStore;
readonly schedulerDispatcher?: ScheduleDispatcher;
readonly schedulerLoop?: SchedulerLoop;
```

Add `"schedule"` to command set and help output.

Add command branch:

```ts
if (command === "schedule") {
  return await runScheduler(options, context);
}
```

Add helper:

```ts
const runScheduler = async (options: ParsedFlags, context: CliContext): Promise<CliResult> => {
  const once = getBooleanFlag(options, "once");
  const schedulerId = getStringOption(options, "scheduler-id") ?? "nest-batch-cli-scheduler";
  const loop = context.schedulerLoop ?? createSchedulerLoop(options, context, schedulerId);

  if (once) {
    const result = await loop.tick({ signal: context.signal });
    return {
      exitCode: result.failedOccurrences === 0 ? 0 : 1,
      output: stringifyScheduleResult(schedulerId, result)
    };
  }

  await loop.runUntilStopped({ signal: context.signal });
  return {
    exitCode: 0,
    output: stringifyScheduleResult(schedulerId, {
      scannedSchedules: 0,
      claimedOccurrences: 0,
      dispatchedOccurrences: 0,
      failedOccurrences: 0
    })
  };
};
```

Add `createSchedulerLoop()` that requires `scheduleStore`, `storage.lockManager`, and either `schedulerDispatcher`, `queue`, or `runner/jobs`:

```ts
const createSchedulerLoop = (options: ParsedFlags, context: CliContext, ownerId: string): SchedulerLoop => {
  const storage = requireStorage(context);
  const store = requireScheduleStore(context);
  const dispatcher =
    context.schedulerDispatcher ??
    (context.queue
      ? createQueueScheduleDispatcher({ queue: context.queue })
      : createRunnerScheduleDispatcher({
          jobs: context.jobs ?? [],
          runner: context.runner ?? new DefaultBatchRunner(storage),
          ownerId
        }));

  return new SchedulerLoop({
    schedules: context.schedules ?? [],
    store,
    lockManager: storage.lockManager,
    dispatcher,
    ownerId,
    lockTtlMs: getNumberOption(options, "lock-ttl-ms"),
    claimTtlMs: getNumberOption(options, "claim-ttl-ms"),
    pollIntervalMs: getNumberOption(options, "poll-interval-ms")
  });
};
```

Add `requireScheduleStore()` and `stringifyScheduleResult()`.

- [ ] **Step 4: Run GREEN**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/cli/test/run-cli.test.ts
./node_modules/.bin/tsc -b packages/cli
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/package.json packages/cli/tsconfig.json packages/cli/src/index.ts packages/cli/test/run-cli.test.ts
git commit -m "feat : scheduler CLI command 추가" -m "- schedule command로 scheduler tick과 loop 실행을 연결"
```

---

### Task 9: Nest Scheduler Provider Boundary

**Files:**
- Modify: `packages/nest/package.json`
- Modify: `packages/nest/tsconfig.json`
- Modify: `packages/nest/src/constants.ts`
- Modify: `packages/nest/src/module-options.ts`
- Modify: `packages/nest/src/runtime.providers.ts`
- Modify: `packages/nest/src/index.ts`
- Test: `packages/nest/test/module.test.ts`
- Test: `packages/nest/test/exports.test.ts`

**Interfaces:**
- Consumes: `SchedulerLoop`, `ScheduleDefinition`, `ScheduleDispatcher`, `ScheduleStore`.
- Produces:
  - `BATCH_SCHEDULE_STORE`
  - `BATCH_SCHEDULES`
  - `BATCH_SCHEDULER_DISPATCHER`
  - `BATCH_SCHEDULER_LOOP`
  - `NestBatchModuleOptions.scheduleStore`
  - `NestBatchModuleOptions.schedules`
  - `NestBatchModuleOptions.schedulerDispatcher`
  - `NestBatchModuleOptions.schedulerLoop`
  - `NestBatchModuleOptions.scheduler`

- [ ] **Step 1: Write failing Nest module tests**

Append to `packages/nest/test/module.test.ts`:

```ts
it("accepts scheduler providers / scheduler provider를 설정한다", () => {
  const scheduleStore = { findLatestOccurrence: async () => undefined, claimOccurrence: async () => undefined, markDispatched: async () => true, markFailed: async () => true };
  const schedules = [{ name: "billing.daily", jobName: "billing", trigger: { getDueOccurrences: () => [] } }];
  const schedulerDispatcher = async () => undefined;
  const schedulerLoop = { tick: async () => ({ scannedSchedules: 0, claimedOccurrences: 0, dispatchedOccurrences: 0, failedOccurrences: 0 }) };
  const module = NestBatchModule.forRoot({
    storage: createStorage(),
    scheduleStore: scheduleStore as any,
    schedules: schedules as any,
    schedulerDispatcher,
    schedulerLoop: schedulerLoop as any,
    scheduler: { autoStart: false, pollIntervalMs: 1_000, ownerId: "scheduler-1" }
  });

  expect(module.providers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ provide: BATCH_SCHEDULE_STORE, useValue: scheduleStore }),
      expect.objectContaining({ provide: BATCH_SCHEDULES, useValue: schedules }),
      expect.objectContaining({ provide: BATCH_SCHEDULER_DISPATCHER, useValue: schedulerDispatcher }),
      expect.objectContaining({ provide: BATCH_SCHEDULER_LOOP, useValue: schedulerLoop })
    ])
  );
});
```

Update imports in the test for new constants.

- [ ] **Step 2: Run RED**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/nest/test/module.test.ts packages/nest/test/exports.test.ts
```

Expected: FAIL because scheduler constants and options are missing.

- [ ] **Step 3: Implement Nest provider boundary**

Add `@nest-batch/scheduler-core` dependency and tsconfig reference to `packages/nest`.

Add constants in `packages/nest/src/constants.ts`:

```ts
export const BATCH_SCHEDULE_STORE = Symbol("nest-batch:schedule-store");
export const BATCH_SCHEDULES = Symbol("nest-batch:schedules");
export const BATCH_SCHEDULER_DISPATCHER = Symbol("nest-batch:scheduler-dispatcher");
export const BATCH_SCHEDULER_LOOP = Symbol("nest-batch:scheduler-loop");
```

Extend `NestBatchModuleOptions` in `packages/nest/src/module-options.ts`:

```ts
readonly scheduleStore?: ScheduleStore;
readonly schedules?: readonly ScheduleDefinition[];
readonly schedulerDispatcher?: ScheduleDispatcher;
readonly schedulerLoop?: SchedulerLoop;
readonly scheduler?: {
  readonly autoStart?: boolean;
  readonly pollIntervalMs?: number;
  readonly ownerId?: string;
  readonly lockTtlMs?: number;
  readonly claimTtlMs?: number;
};
```

Import scheduler types from `@nest-batch/scheduler-core`.

In `packages/nest/src/runtime.providers.ts`, add scheduler value providers when options contain each value. Do not auto-start yet. The first implementation only exposes tokens.

Export scheduler constants and option types from `packages/nest/src/index.ts`.

- [ ] **Step 4: Run GREEN**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/nest/test/module.test.ts packages/nest/test/exports.test.ts
./node_modules/.bin/tsc -b packages/nest
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/nest/package.json packages/nest/tsconfig.json packages/nest/src packages/nest/test
git commit -m "feat : Nest scheduler provider 경계 추가" -m "- scheduler store와 loop를 Nest module option으로 주입할 수 있게 연결"
```

---

### Task 10: Scheduler Queue E2E and Documentation

**Files:**
- Create: `e2e/scheduler-queue.e2e.test.ts`
- Modify: `README.md`
- Modify: `README-kr.md`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: end-to-end proof that scheduler queue dispatch creates work and worker executes the job.

- [ ] **Step 1: Write failing e2e test**

Create `e2e/scheduler-queue.e2e.test.ts`:

```ts
import { defineJob, defineStep, DefaultBatchRunner } from "@nest-batch/core";
import { InMemoryBatchStorage, InMemoryScheduleStore } from "@nest-batch/inmemory";
import { WorkerLoop, type WorkQueue, type WorkUnit } from "@nest-batch/queue-core";
import {
  SchedulerLoop,
  createIntervalTrigger,
  createQueueScheduleDispatcher,
  defineSchedule
} from "@nest-batch/scheduler-core";
import { runCli } from "@nest-batch/cli";
import { describe, expect, it } from "vitest";

describe("scheduler queue e2e / scheduler queue e2e를 검증한다", () => {
  it("enqueues scheduled work and worker runs the job / schedule work를 enqueue하고 worker가 job을 실행한다", async () => {
    const storage = new InMemoryBatchStorage();
    const scheduleStore = new InMemoryScheduleStore();
    const queue = new InMemoryWorkQueue();
    const written: string[] = [];
    const job = defineJob({
      name: "billing",
      steps: [
        defineStep({
          name: "charge",
          async execute({ parameters }) {
            written.push(String(parameters.billingDate));
          }
        })
      ]
    });
    const schedule = defineSchedule({
      name: "billing.daily",
      jobName: "billing",
      trigger: createIntervalTrigger({
        everyMs: 86_400_000,
        startAt: new Date("2026-01-01T00:00:00.000Z")
      }),
      parameters: ({ scheduledAt }) => ({
        billingDate: scheduledAt.toISOString().slice(0, 10)
      })
    });
    const scheduler = new SchedulerLoop({
      schedules: [schedule],
      store: scheduleStore,
      lockManager: storage.lockManager,
      dispatcher: createQueueScheduleDispatcher({ queue }),
      ownerId: "scheduler-1",
      now: () => new Date("2026-01-01T00:00:00.000Z")
    });
    const scheduleResult = await scheduler.tick();

    expect(scheduleResult).toMatchObject({ dispatchedOccurrences: 1 });

    const workerResult = await runCli(["worker", "--once"], {
      storage,
      jobs: [job],
      queue,
      runner: new DefaultBatchRunner(storage, {
        generateOwnerId: () => "worker-1"
      })
    });

    expect(workerResult.exitCode).toBe(0);
    expect(written).toEqual(["2026-01-01"]);
  });
});

class InMemoryWorkQueue implements WorkQueue {
  private readonly items: WorkUnit[] = [];
  private claimed: WorkUnit | undefined;

  async enqueue(work: WorkUnit): Promise<void> {
    this.items.push(work);
  }

  async claim(): Promise<WorkUnit | undefined> {
    this.claimed = this.items.shift();
    return this.claimed;
  }

  async complete(work: WorkUnit): Promise<void> {
    if (this.claimed?.id === work.id) {
      this.claimed = undefined;
    }
  }

  async fail(work: WorkUnit, error: unknown): Promise<void> {
    throw error instanceof Error ? error : new Error(String(error));
  }
}
```

- [ ] **Step 2: Run RED**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.e2e.config.ts e2e/scheduler-queue.e2e.test.ts
```

Expected before Tasks 1-9 are complete: FAIL because the scheduler stack is not fully wired. Expected after Tasks 1-9 are complete: PASS and lock the queue scheduling flow as e2e coverage.

- [ ] **Step 3: Update docs**

In `README.md` and `README-kr.md`:

- Replace the statement that production scheduling is not implemented.
- Add `@nest-batch/scheduler-core` to package list.
- Add a `Production Scheduling` section after `Distributed Workers`.
- Include queue scheduling example with `defineSchedule`, `createIntervalTrigger`, `SchedulerLoop`, `createQueueScheduleDispatcher`.
- State that scheduler dispatch is at-least-once and writers must be idempotent.
- Add CLI example:

```bash
nest-batch schedule --once
nest-batch schedule --poll-interval-ms 1000 --scheduler-id scheduler-1
```

In `docs/architecture.md`, add scheduler responsibility:

```md
## `@nest-batch/scheduler-core`

Scheduler core owns code-defined schedule definitions, trigger evaluation,
occurrence claim orchestration, and dispatch to `BatchRunner` or `WorkQueue`.
It does not own job execution semantics.
```

Update Runtime Constraints with:

```md
- scheduler dispatch is at-least-once and uses deterministic occurrence ids
- scheduler failure records dispatch failure, not job failure
- schedule definitions live in application code; durable stores persist occurrence state
```

- [ ] **Step 4: Run GREEN**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.e2e.config.ts e2e/scheduler-queue.e2e.test.ts
pnpm typecheck
pnpm test
pnpm test:e2e
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e/scheduler-queue.e2e.test.ts README.md README-kr.md docs/architecture.md
git commit -m "docs : production scheduling 문서와 e2e 추가" -m "- scheduler queue dispatch 흐름을 e2e로 검증" -m "- at-least-once scheduling 의미와 CLI 사용법을 문서화"
```

---

### Task 11: Final Verification

**Files:**
- Check: all changed files from Tasks 1-10.

**Interfaces:**
- Consumes: complete production scheduling implementation.
- Produces: final verification evidence.

- [ ] **Step 1: Check public exports**

Run:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts packages/scheduler-core/test packages/inmemory/test/schedule-store.test.ts packages/postgres/test/schedule-store.test.ts packages/mysql/test/schedule-store.test.ts packages/mariadb/test/schedule-store.test.ts packages/cli/test/run-cli.test.ts packages/nest/test/module.test.ts packages/nest/test/exports.test.ts
```

Expected: PASS.

- [ ] **Step 2: Check package build**

Run:

```bash
pnpm typecheck
pnpm build
```

Expected: PASS.

- [ ] **Step 3: Check full tests**

Run:

```bash
pnpm test
pnpm test:e2e
```

Expected: PASS.

- [ ] **Step 4: Inspect git state**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: working tree has no unintended changes; latest commits are the production scheduling task commits.

- [ ] **Step 5: Commit final fixes if required**

If verification required small fixes, commit them with:

```bash
git add packages/scheduler-core packages/inmemory packages/postgres packages/mysql packages/mariadb packages/cli packages/nest e2e README.md README-kr.md docs/architecture.md package.json tsconfig.base.json tsconfig.json vitest.config.ts vitest.e2e.config.ts
git commit -m "fix : production scheduling 검증 보완" -m "- 최종 검증에서 발견한 scheduler wiring 문제를 수정"
```

If no fixes were required, do not create an empty commit.

---

## Plan Self-Review

- Spec coverage: scheduler-core, interval trigger, deterministic occurrence id, schedule loop, in-memory store, SQL stores, CLI, Nest provider boundary, docs, and e2e are covered.
- Scope: dynamic DB-backed schedule definition editing, cron parser, dashboard, and scheduler-owned runtime restart are excluded.
- Type consistency: `ScheduleStore`, `ScheduleOccurrence`, `SchedulerLoop`, `ScheduleDispatcher`, and dispatcher option names are consistent across tasks.
- Testing: unit, adapter fake-driver, CLI/Nest integration, and e2e commands are listed with expected outcomes.
