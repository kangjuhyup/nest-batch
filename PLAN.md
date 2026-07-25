# Performance Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `nest-batch`가 단일 sequential runner를 넘어 local concurrency, CPU-bound worker thread, DB-backed partition execution, distributed worker까지 확장할 수 있는 runtime 구조를 만든다.

**Architecture:** `@nest-batch/core`는 execution, partition, worker, queue contract만 정의하고 NestJS, `worker_threads`, Redis, database client에 의존하지 않는다. 실제 확장 방식은 `worker-local`, `worker-threads`, queue adapter, SQL adapter 같은 별도 package가 구현한다. Repository 상태를 source of truth로 유지하고, queue나 worker는 실행 전달 수단으로만 사용한다.

**Tech Stack:** TypeScript, Node.js `AsyncIterable`, `AbortSignal`, optional `worker_threads`, `@nest-batch/core`, SQL storage adapters, Vitest, Docker Compose.

## Global Constraints

- `@nest-batch/core`는 NestJS, database client, queue client, `worker_threads`에 의존하지 않는다.
- Job 실행은 durable해야 하며 실패, 취소, 재시작을 정상 경로로 다룬다.
- 확장 실행은 at-least-once를 기본 의미로 두고 writer idempotency를 문서화한다.
- checkpoint는 writer 성공 이후의 안전한 경계에서만 저장한다.
- scheduler는 execution 생성과 enqueue 책임만 갖고 runtime 상태 전이를 우회하지 않는다.
- CPU core 수는 worker thread adapter의 기본 capacity 산정 기준으로만 사용한다.
- I/O-bound 성능 확장은 async concurrency와 backpressure를 우선하고, CPU-bound 확장은 worker thread/process pool로 분리한다.
- 테스트 설명은 `English / 한국어` 형식을 유지한다.
- 커밋 메시지는 `feat|fix|refactor|chore|docs : 제목` 형식을 사용한다.

---

## Target Runtime Model

성능 확장은 thread를 직접 노출하는 방식이 아니라 다음 runtime 단위를 명확히 나누는 방식으로 진행한다.

```text
JobExecution
  StepExecution
    PartitionExecution
      WorkUnit
```

- `JobExecution`: 같은 `JobInstance`에 대한 하나의 실행 시도.
- `StepExecution`: job 안의 step 실행 상태와 aggregate counters.
- `PartitionExecution`: 하나의 step을 나눈 독립 실행 단위.
- `WorkUnit`: local worker, worker thread, distributed worker가 실제로 claim해서 처리하는 최소 작업 단위.

## Package Direction

```text
packages/
  core/              # execution engine, partition, worker, queue contract
  worker-local/      # 같은 process 안에서 async concurrency로 WorkUnit 실행
  worker-threads/    # CPU-bound processor용 worker_threads pool
  queue-core/        # queue adapter contract와 worker loop helper
  queue-bullmq/      # Redis/BullMQ 기반 distributed queue adapter
  cli/               # worker 실행, status, retry, drain 같은 운영 command
  nest/              # Nest module option으로 engine/worker/queue provider wiring
```

초기 구현에서는 새 package를 한 번에 모두 만들지 않는다. 먼저 `core` contract와 sequential compatibility를 만든 뒤 `worker-local`로 I/O-bound 확장을 검증하고, 그 다음 `worker-threads`, queue adapter 순서로 넓힌다.

## Public API Sketch

아래 API는 구현 방향을 고정하기 위한 초안이다. 실제 구현 시 이름은 테스트와 문서에서 한 번 더 검증한다.

```ts
export interface ExecutionEngine {
  runJob<Parameters extends JobParameters>(
    job: JobDefinition<Parameters>,
    parameters: Parameters,
    options?: BatchRunOptions
  ): Promise<JobExecution<Parameters>>;
}

export interface PartitionPlan<TPartition = unknown> {
  readonly stepName: string;
  readonly partitions: readonly TPartition[];
}

export interface PartitionHandler<TPartition = unknown> {
  handle(partition: TPartition, context: PartitionExecutionContext): Promise<void>;
}

export interface WorkerPool {
  readonly capacity: number;
  run<T>(task: WorkerTask<T>, signal?: AbortSignal): Promise<T>;
}

export interface WorkQueue {
  enqueue(work: WorkUnit): Promise<void>;
  claim(options: WorkClaimOptions): Promise<WorkUnit | undefined>;
  complete(work: WorkUnit): Promise<void>;
  fail(work: WorkUnit, error: unknown): Promise<void>;
}
```

---

### Task 1: Performance Baseline And Guard Rails

**Files:**
- Create: `packages/core/test/performance-baseline.perf.test.ts`
- Create: `docs/performance.md`
- Modify: `README.md`
- Modify: `README-kr.md`

**Interfaces:**
- Consumes: existing `DefaultBatchRunner`, `defineChunkStep`, `InMemoryBatchStorage`.
- Produces: repeatable performance baseline for chunk throughput, checkpoint overhead, retry/skip overhead.

- [x] **Step 1: Write baseline perf tests**

Create a perf test that runs a chunk job with controlled item count and records throughput without asserting machine-specific numbers.

```ts
it("measures chunk throughput baseline / chunk 처리 기준 성능을 측정한다", async () => {
  const itemCount = Number(process.env.NEST_BATCH_PERF_ITEMS ?? 10_000);
  const chunkSize = Number(process.env.NEST_BATCH_PERF_CHUNK_SIZE ?? 100);
  const startedAt = performance.now();

  const execution = await runner.run(job, { itemCount });
  const durationMs = performance.now() - startedAt;

  expect(execution.status).toBe("completed");
  expect(durationMs).toBeGreaterThan(0);
  console.table([{ itemCount, chunkSize, durationMs, itemsPerSecond: itemCount / (durationMs / 1000) }]);
});
```

- [x] **Step 2: Run RED/GREEN check**

Run: `./node_modules/.bin/vitest run --config vitest.perf.config.ts packages/core/test/performance-baseline.perf.test.ts`

Expected: PASS and prints baseline table. This test should not fail on slow machines unless the runtime is functionally broken.

- [x] **Step 3: Document baseline command and result**

Add a short README section explaining `NEST_BATCH_PERF_ITEMS`, `NEST_BATCH_PERF_CHUNK_SIZE`, why perf tests are excluded from normal unit tests, and where completed run results are recorded.

- [x] **Step 4: Commit**

```bash
git add PLAN.md packages/core/test/performance-baseline.perf.test.ts docs/performance.md README.md README-kr.md
git commit -m "test : runtime 성능 기준 테스트 추가" -m "- chunk 처리 기준 성능 측정 경로를 추가" -m "- 성능 테스트 실행 환경 변수와 결과 기록 문서를 추가"
```

### Task 2: Core Execution Engine Contract

**Files:**
- Create: `packages/core/src/types/execution-engine.ts`
- Modify: `packages/core/src/types/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/runner/default-batch-runner.ts`
- Test: `packages/core/test/execution-engine.test.ts`

**Interfaces:**
- Consumes: `BatchRunner`, `JobDefinition`, `BatchRunOptions`, `JobExecution`.
- Produces: `ExecutionEngine` contract and a compatibility path where `DefaultBatchRunner` implements it.

- [x] **Step 1: Write failing contract test**

```ts
it("uses DefaultBatchRunner as an execution engine / DefaultBatchRunner를 execution engine으로 사용한다", async () => {
  const engine: ExecutionEngine = new DefaultBatchRunner(storage, {
    generateExecutionId: () => "engine-execution-1"
  });

  const execution = await engine.runJob(job, {});

  expect(execution).toMatchObject({
    id: "engine-execution-1",
    status: "completed"
  });
});
```

Run: `./node_modules/.bin/vitest run packages/core/test/execution-engine.test.ts`

Expected: FAIL because `ExecutionEngine` does not exist.

- [x] **Step 2: Add `ExecutionEngine` type**

```ts
export interface ExecutionEngine {
  runJob<Parameters extends JobParameters = JobParameters>(
    job: JobDefinition<Parameters>,
    parameters: Parameters,
    options?: BatchRunOptions
  ): Promise<JobExecution<Parameters>>;
}
```

- [x] **Step 3: Implement compatibility method**

Add `runJob()` to `DefaultBatchRunner` and delegate to `run()` so existing code keeps working.

```ts
async runJob<Parameters extends JobParameters = JobParameters>(
  job: JobDefinition<Parameters>,
  parameters: Parameters,
  options: BatchRunOptions = {}
): Promise<JobExecution<Parameters>> {
  return this.run(job, parameters, options);
}
```

- [x] **Step 4: Run tests**

Run:

```bash
./node_modules/.bin/vitest run packages/core/test/execution-engine.test.ts packages/core/test/runner.test.ts
./node_modules/.bin/tsc -b
```

- [x] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat : execution engine contract 추가" -m "- core에 ExecutionEngine contract를 추가" -m "- DefaultBatchRunner가 execution engine으로 동작하도록 연결"
```

### Task 3: Partition Contract And Repository State

**Files:**
- Create: `packages/core/src/types/partition.ts`
- Modify: `packages/core/src/types/repository.ts`
- Modify: `packages/core/src/types/execution.ts`
- Modify: `packages/core/src/types/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/partition-repository.test.ts`
- Test: `packages/postgres/test/adapter.test.ts`
- Test: `packages/mysql/test/adapter.test.ts`
- Test: `packages/mariadb/test/adapter.test.ts`

**Interfaces:**
- Consumes: current `JobRepository`, `StepExecution`.
- Produces: `PartitionExecution`, `PartitionExecutionStatus`, repository methods for create/update/find/claim.

- [x] **Step 1: Define failing repository contract test**

```ts
it("claims one pending partition at a time / pending partition을 하나씩 claim한다", async () => {
  await repository.createPartitionExecution(createPartition({ id: "partition-1" }));
  await repository.createPartitionExecution(createPartition({ id: "partition-2" }));

  const first = await repository.claimPartitionExecution({
    stepExecutionId: "step-1",
    ownerId: "worker-1",
    now: new Date("2026-07-20T00:00:00.000Z")
  });

  expect(first).toMatchObject({
    id: "partition-1",
    status: "running",
    ownerId: "worker-1"
  });
});
```

Expected: FAIL because partition repository APIs do not exist.

- [x] **Step 2: Add core partition types**

```ts
export type PartitionExecutionStatus = "created" | "running" | "completed" | "failed" | "cancelled";

export interface PartitionExecution<TPartition = unknown> {
  readonly id: string;
  readonly stepExecutionId: BatchStepExecutionId;
  readonly stepName: string;
  readonly status: PartitionExecutionStatus;
  readonly partition: TPartition;
  readonly ownerId?: string;
  readonly readCount: number;
  readonly writeCount: number;
  readonly skipCount: number;
  readonly retryCount: number;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly endedAt?: Date;
  readonly failureReason?: string;
}
```

- [x] **Step 3: Extend repository contract**

```ts
createPartitionExecution(execution: PartitionExecution): Promise<void>;
updatePartitionExecution(execution: PartitionExecution): Promise<void>;
findPartitionExecutions(stepExecutionId: BatchStepExecutionId): Promise<readonly PartitionExecution[]>;
claimPartitionExecution(options: PartitionClaimOptions): Promise<PartitionExecution | undefined>;
```

- [x] **Step 4: Implement in-memory and SQL adapters**

Add `partition_executions` tables to Postgres/MySQL/MariaDB schema. SQL `claimPartitionExecution` must use dialect-specific row locking:

- Postgres: `FOR UPDATE SKIP LOCKED`
- MySQL: `FOR UPDATE SKIP LOCKED`
- MariaDB: verify supported syntax; if unsupported for target version, use transaction plus owner update condition.

- [x] **Step 5: Run matrix tests**

```bash
./node_modules/.bin/vitest run packages/core/test/partition-repository.test.ts packages/inmemory/test/storage.test.ts packages/postgres/test/adapter.test.ts packages/mysql/test/adapter.test.ts packages/mariadb/test/adapter.test.ts
./node_modules/.bin/tsc -b
```

- [x] **Step 6: Commit**

```bash
git add packages/core packages/inmemory packages/postgres packages/mysql packages/mariadb
git commit -m "feat : partition execution 상태 저장 추가" -m "- core repository contract에 partition execution을 추가" -m "- in-memory와 SQL adapter에 partition claim 흐름을 구현"
```

### Task 4: Local Concurrent Partition Engine

**Files:**
- Create: `packages/core/src/runner/partitioned-step-runner.ts`
- Create: `packages/core/src/types/partitioned-step.ts`
- Modify: `packages/core/src/definitions.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/partitioned-step-runner.test.ts`

**Interfaces:**
- Consumes: `PartitionExecution`, repository claim/update methods.
- Produces: `definePartitionedStep()` and local `maxConcurrency` partition execution.

- [x] **Step 1: Write failing concurrency test**

```ts
it("runs partitions with max concurrency / max concurrency로 partition을 실행한다", async () => {
  const activeCounts: number[] = [];
  let active = 0;

  const step = definePartitionedStep({
    name: "partition-users",
    maxConcurrency: 2,
    partitions: () => [{ shard: 0 }, { shard: 1 }, { shard: 2 }],
    async execute() {
      active += 1;
      activeCounts.push(active);
      await delay(10);
      active -= 1;
    }
  });

  const execution = await runner.run(defineJob({ name: "partition-job", steps: [step] }), {});

  expect(execution.status).toBe("completed");
  expect(Math.max(...activeCounts)).toBe(2);
});
```

Expected: FAIL because `definePartitionedStep` does not exist.

- [x] **Step 2: Add partitioned step type**

```ts
export interface PartitionedStepDefinition<TPartition = unknown> {
  readonly kind: "partitioned";
  readonly name: string;
  readonly maxConcurrency?: number;
  readonly partitions: () => readonly TPartition[] | Promise<readonly TPartition[]>;
  readonly execute: (partition: TPartition, context: PartitionExecutionContext) => Promise<void> | void;
}
```

- [x] **Step 3: Implement local scheduler**

Use a bounded async loop, not `Promise.all()` over all partitions. Respect `AbortSignal` before claiming each partition and before starting execution.

- [x] **Step 4: Aggregate counters**

After partitions complete, aggregate `readCount`, `writeCount`, `skipCount`, and `retryCount` into the parent `StepExecution`.

- [x] **Step 5: Run tests**

```bash
./node_modules/.bin/vitest run packages/core/test/partitioned-step-runner.test.ts packages/core/test/runner.test.ts
./node_modules/.bin/tsc -b
```

- [x] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat : local partitioned step 실행 추가" -m "- partitioned step 정의와 local bounded concurrency 실행을 추가" -m "- partition 결과를 parent step execution에 집계"
```

### Task 5: Worker Pool Contract And Local Worker Package

**Files:**
- Create: `packages/core/src/types/worker.ts`
- Create: `packages/worker-local/package.json`
- Create: `packages/worker-local/src/index.ts`
- Create: `packages/worker-local/src/local-worker-pool.ts`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Test: `packages/worker-local/test/local-worker-pool.test.ts`

**Interfaces:**
- Consumes: `WorkerPool`, `WorkerTask`, `AbortSignal`.
- Produces: `LocalWorkerPool` with bounded async execution.

- [x] **Step 1: Write failing worker pool test**

```ts
it("limits concurrent tasks / 동시에 실행되는 task 수를 제한한다", async () => {
  const pool = new LocalWorkerPool({ capacity: 2 });
  const activeCounts: number[] = [];
  let active = 0;

  await Promise.all(Array.from({ length: 5 }, () => pool.run(async () => {
    active += 1;
    activeCounts.push(active);
    await delay(10);
    active -= 1;
  })));

  expect(Math.max(...activeCounts)).toBe(2);
});
```

Expected: FAIL because package and class do not exist.

- [x] **Step 2: Add core worker contract**

```ts
export interface WorkerTask<T = unknown> {
  run(signal: AbortSignal): Promise<T> | T;
}

export interface WorkerPool {
  readonly capacity: number;
  run<T>(task: WorkerTask<T> | ((signal: AbortSignal) => Promise<T> | T), signal?: AbortSignal): Promise<T>;
  close?(): Promise<void>;
}
```

- [x] **Step 3: Implement `LocalWorkerPool`**

Use an internal FIFO queue and start at most `capacity` active tasks. If `signal` aborts before start, reject with abort error.

- [x] **Step 4: Run tests**

```bash
./node_modules/.bin/vitest run packages/worker-local/test/local-worker-pool.test.ts
./node_modules/.bin/tsc -b
```

- [x] **Step 5: Commit**

```bash
git add packages/core packages/worker-local tsconfig.json vitest.config.ts
git commit -m "feat : local worker pool package 추가" -m "- core WorkerPool contract를 추가" -m "- bounded async 실행을 제공하는 LocalWorkerPool을 구현"
```

### Task 6: Worker Threads Adapter For CPU-Bound Processing

**Files:**
- Create: `packages/worker-threads/package.json`
- Create: `packages/worker-threads/src/index.ts`
- Create: `packages/worker-threads/src/worker-thread-pool.ts`
- Create: `packages/worker-threads/src/worker-entry.ts`
- Modify: `tsconfig.json`
- Test: `packages/worker-threads/test/worker-thread-pool.test.ts`

**Interfaces:**
- Consumes: core `WorkerPool`.
- Produces: `WorkerThreadPool` with default capacity from `os.availableParallelism()`.

- [x] **Step 1: Write failing CPU offload test**

```ts
it("runs CPU tasks in worker threads / CPU 작업을 worker thread에서 실행한다", async () => {
  const pool = new WorkerThreadPool({ capacity: 2 });

  try {
    const result = await pool.run({
      moduleUrl: new URL("./fixtures/fibonacci-worker.js", import.meta.url).href,
      payload: { n: 10 }
    });

    expect(result).toEqual({ value: 55 });
  } finally {
    await pool.close();
  }
});
```

Expected: FAIL because package and implementation do not exist.

- [x] **Step 2: Implement worker thread pool**

The package may import Node `worker_threads`; `@nest-batch/core` must not. Default capacity:

```ts
const defaultCapacity = Math.max(1, availableParallelism() - 1);
```

- [x] **Step 3: Add cancellation behavior**

If `AbortSignal` aborts while queued, remove the task. If it aborts while running, terminate the worker and mark the task failed.

- [x] **Step 4: Run tests**

```bash
./node_modules/.bin/vitest run packages/worker-threads/test/worker-thread-pool.test.ts
./node_modules/.bin/tsc -b
```

- [x] **Step 5: Commit**

```bash
git add packages/worker-threads tsconfig.json
git commit -m "feat : worker thread pool adapter 추가" -m "- CPU-bound 작업을 worker_threads로 실행하는 adapter를 추가" -m "- capacity 기본값을 availableParallelism 기반으로 계산"
```

### Task 7: DB-Backed Worker Claim And Heartbeat

**Files:**
- Modify: `packages/core/src/types/partition.ts`
- Modify: `packages/core/src/types/repository.ts`
- Modify: `packages/postgres/src/repository/repository.ts`
- Modify: `packages/mysql/src/repository/repository.ts`
- Modify: `packages/mariadb/src/repository/repository.ts`
- Test: `e2e/full-runtime-flow.e2e.test.ts`
- Test: `packages/postgres/test/adapter.test.ts`
- Test: `packages/mysql/test/adapter.test.ts`
- Test: `packages/mariadb/test/adapter.test.ts`

**Interfaces:**
- Consumes: `PartitionExecution`.
- Produces: heartbeat and stale partition recovery.

- [ ] **Step 1: Write stale claim test**

```ts
it("recovers stale running partitions / 오래된 running partition을 회수한다", async () => {
  await repository.createPartitionExecution(createPartition({
    id: "partition-1",
    status: "running",
    ownerId: "dead-worker",
    heartbeatAt: new Date("2026-07-20T00:00:00.000Z")
  }));

  const claimed = await repository.claimPartitionExecution({
    stepExecutionId: "step-1",
    ownerId: "worker-2",
    staleAfterMs: 30_000,
    now: new Date("2026-07-20T00:01:00.000Z")
  });

  expect(claimed).toMatchObject({ id: "partition-1", ownerId: "worker-2", status: "running" });
});
```

- [ ] **Step 2: Add heartbeat fields**

Add `heartbeatAt?: Date`, `claimExpiresAt?: Date`, and repository method:

```ts
heartbeatPartitionExecution(id: string, ownerId: string, now: Date): Promise<void>;
```

- [ ] **Step 3: Implement SQL semantics**

Claim query must only recover stale work when `heartbeatAt` is older than `now - staleAfterMs`. Completion must verify `ownerId` so another worker cannot complete stolen work.

- [ ] **Step 4: Run database matrix**

```bash
docker compose up -d postgres mysql mariadb
./node_modules/.bin/vitest run --config vitest.e2e.config.ts e2e/full-runtime-flow.e2e.test.ts
./node_modules/.bin/vitest run packages/postgres/test/adapter.test.ts packages/mysql/test/adapter.test.ts packages/mariadb/test/adapter.test.ts
./node_modules/.bin/tsc -b
```

- [ ] **Step 5: Commit**

```bash
git add packages/core packages/postgres packages/mysql packages/mariadb e2e
git commit -m "feat : partition heartbeat와 stale 회수 추가" -m "- DB-backed worker claim에 heartbeat 의미를 추가" -m "- 오래된 running partition 회수 경로를 adapter별로 검증"
```

### Task 8: Queue Contract And Distributed Worker Loop

**Files:**
- Create: `packages/queue-core/package.json`
- Create: `packages/queue-core/src/index.ts`
- Create: `packages/queue-core/src/worker-loop.ts`
- Create: `packages/queue-core/src/work-queue.ts`
- Modify: `tsconfig.json`
- Test: `packages/queue-core/test/worker-loop.test.ts`

**Interfaces:**
- Consumes: `WorkUnit`, `WorkQueue`, `ExecutionEngine`, repository claim APIs.
- Produces: queue-independent distributed worker loop.

- [ ] **Step 1: Write failing worker loop test**

```ts
it("claims, runs, and completes queued work / queue work를 claim, 실행, 완료한다", async () => {
  const queue = new InMemoryWorkQueue([createWorkUnit("work-1")]);
  const completed: string[] = [];
  const loop = new WorkerLoop({
    queue,
    workerId: "worker-1",
    handler: async (work) => {
      completed.push(work.id);
    }
  });

  await loop.runOnce();

  expect(completed).toEqual(["work-1"]);
  expect(queue.completed).toEqual(["work-1"]);
});
```

- [ ] **Step 2: Define queue contract**

```ts
export interface WorkQueue {
  enqueue(work: WorkUnit): Promise<void>;
  claim(options: WorkClaimOptions): Promise<WorkUnit | undefined>;
  complete(work: WorkUnit): Promise<void>;
  fail(work: WorkUnit, error: unknown): Promise<void>;
}
```

- [ ] **Step 3: Implement worker loop**

Loop must respect `AbortSignal`, support `runOnce()` for tests, and expose `runUntilStopped()` for production workers.

- [ ] **Step 4: Run tests**

```bash
./node_modules/.bin/vitest run packages/queue-core/test/worker-loop.test.ts
./node_modules/.bin/tsc -b
```

- [ ] **Step 5: Commit**

```bash
git add packages/queue-core tsconfig.json
git commit -m "feat : queue 독립 worker loop 추가" -m "- WorkQueue contract와 worker loop를 분리" -m "- distributed worker 실행의 최소 단위를 테스트로 고정"
```

### Task 9: BullMQ Queue Adapter

**Files:**
- Create: `packages/queue-bullmq/package.json`
- Create: `packages/queue-bullmq/src/index.ts`
- Create: `packages/queue-bullmq/src/bullmq-work-queue.ts`
- Modify: `tsconfig.json`
- Test: `packages/queue-bullmq/test/bullmq-work-queue.test.ts`

**Interfaces:**
- Consumes: `WorkQueue`.
- Produces: Redis/BullMQ-backed `BullMqWorkQueue`.

- [ ] **Step 1: Write adapter contract test**

Use Testcontainers or Docker Compose Redis only when Redis is added to `compose.yaml`. Until then, keep adapter tests behind explicit env:

```ts
const redisUrl = process.env.NEST_BATCH_E2E_REDIS_URL;
const describeWithRedis = redisUrl ? describe : describe.skip;
```

- [ ] **Step 2: Implement adapter**

Adapter maps `WorkUnit.id` to BullMQ job id and stores serialized work payload. Retries remain runtime-owned; BullMQ retry should be disabled by default to avoid double retry semantics.

- [ ] **Step 3: Document distributed semantics**

Document at-least-once execution, idempotent writer expectation, and why repository status is the source of truth.

- [ ] **Step 4: Run tests**

```bash
NEST_BATCH_E2E_REDIS_URL=redis://127.0.0.1:6379 ./node_modules/.bin/vitest run --config vitest.e2e.config.ts packages/queue-bullmq/test/bullmq-work-queue.test.ts
./node_modules/.bin/tsc -b
```

- [ ] **Step 5: Commit**

```bash
git add packages/queue-bullmq README.md README-kr.md tsconfig.json
git commit -m "feat : BullMQ queue adapter 추가" -m "- WorkQueue contract의 Redis/BullMQ 구현을 추가" -m "- at-least-once와 idempotency 기대치를 문서화"
```

### Task 10: Nest And CLI Wiring

**Files:**
- Modify: `packages/nest/src/module-options.ts`
- Modify: `packages/nest/src/module.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `examples/nestjs/src/app.module.ts`
- Test: `packages/nest/test/module.test.ts`
- Test: `packages/cli/test/run-cli.test.ts`
- Test: `examples/nestjs/test/nestjs-example.e2e.test.ts`

**Interfaces:**
- Consumes: `ExecutionEngine`, `WorkerPool`, `WorkQueue`.
- Produces: Nest DI and CLI options for selecting execution mode.

- [ ] **Step 1: Write Nest wiring test**

```ts
it("accepts an execution engine provider / execution engine provider를 설정한다", () => {
  const engine = new FakeExecutionEngine();
  const module = NestBatchModule.forRoot({ storage, executionEngine: engine });

  expect(findValueProvider(module.providers ?? [], ExecutionEngineToken).useValue).toBe(engine);
});
```

- [ ] **Step 2: Write CLI worker command test**

```ts
it("runs worker loop once from CLI / CLI에서 worker loop를 한 번 실행한다", async () => {
  const result = await runCli(["worker", "--once"], { storage, jobs: [job], queue });

  expect(result.exitCode).toBe(0);
});
```

- [ ] **Step 3: Implement wiring**

Nest module should accept optional `executionEngine`, `workerPool`, and `workQueue`. CLI should keep storage injection explicit and avoid owning database or Redis construction.

- [ ] **Step 4: Run tests**

```bash
./node_modules/.bin/vitest run packages/nest/test/module.test.ts packages/cli/test/run-cli.test.ts examples/nestjs/test/nestjs-example.e2e.test.ts
./node_modules/.bin/tsc -b
```

- [ ] **Step 5: Commit**

```bash
git add packages/nest packages/cli examples/nestjs
git commit -m "feat : execution engine wiring 추가" -m "- Nest module option으로 engine과 worker provider를 연결" -m "- CLI worker command의 기본 실행 경로를 추가"
```

## Verification Matrix

각 milestone은 다음 검증을 기준으로 완료한다.

```bash
./node_modules/.bin/vitest run
./node_modules/.bin/tsc -b
```

DB-backed runtime 또는 partition 변경이 포함된 milestone은 다음 검증을 추가한다.

```bash
docker compose up -d postgres mysql mariadb
./node_modules/.bin/vitest run --config vitest.e2e.config.ts ./e2e/
```

worker thread 변경이 포함된 milestone은 CPU-bound fixture를 사용한 package test를 추가한다.

```bash
./node_modules/.bin/vitest run packages/worker-threads/test
```

queue 변경이 포함된 milestone은 Redis/BullMQ adapter e2e를 별도 env로 실행한다.

```bash
NEST_BATCH_E2E_REDIS_URL=redis://127.0.0.1:6379 ./node_modules/.bin/vitest run --config vitest.e2e.config.ts packages/queue-bullmq/test
```

## Execution Order

1. 성능 기준 측정과 regression guard를 먼저 만든다.
2. `core`에 `ExecutionEngine` contract를 추가해 기존 sequential runner를 호환시킨다.
3. `PartitionExecution` 상태 저장을 추가해 local/distributed 실행의 공통 상태 모델을 만든다.
4. local partition concurrency로 I/O-bound 확장을 먼저 검증한다.
5. `WorkerPool` contract와 `worker-local` package를 분리한다.
6. CPU-bound 처리를 위해 `worker-threads` adapter를 추가한다.
7. DB-backed worker claim, heartbeat, stale recovery를 추가한다.
8. queue-independent worker loop를 만든다.
9. BullMQ adapter를 붙인다.
10. Nest module과 CLI에서 engine, worker, queue를 주입할 수 있게 한다.

## Open Design Decisions

- `PartitionExecution`을 `StepExecution` 하위 table로만 둘지, `WorkUnit` table을 별도로 둘지 결정해야 한다.
- partition checkpoint key를 `jobExecutionId + stepName + partitionId`로 둘지, 별도 partition checkpoint table을 둘지 결정해야 한다.
- CPU-bound processor API를 function module URL 기반으로 둘지, serializable task registry 기반으로 둘지 결정해야 한다.
- queue adapter가 `JobExecution` 단위만 enqueue할지, `PartitionExecution` 단위까지 enqueue할지 단계별로 나눠야 한다.
- skip limit, retry exhausted, partition partial failure의 failure reason enum을 public type으로 고정할지 검토해야 한다.

## Non-Goals For The First Performance Milestone

- Spring Batch thread model을 그대로 복제하지 않는다.
- `@nest-batch/core`에서 `worker_threads`, BullMQ, Redis, database client를 직접 import하지 않는다.
- 긴 job 전체를 하나의 database transaction으로 묶지 않는다.
- queue retry와 runtime retry를 동시에 활성화하지 않는다.
- CPU core 수를 모든 batch의 기본 concurrency로 강제하지 않는다.
