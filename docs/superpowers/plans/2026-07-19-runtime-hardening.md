# Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the requested sequence: step-aware restart, SQL execution creation transaction boundary, observability hooks, and storage-backed CLI commands.

**Architecture:** Keep durable semantics in `@nest-batch/core` contracts and runner code. Keep database concurrency details inside SQL adapter packages. Keep CLI storage-agnostic by introducing small command helpers that consume `DatabaseBatchStorage`.

**Tech Stack:** TypeScript, Vitest, `@nest-batch/core`, Postgres/MySQL/MariaDB adapter packages, `@nest-batch/cli`.

## Global Constraints

- `@nest-batch/core` must not depend on NestJS or database clients.
- Restart must use the same `JobInstance` and failed execution history as source of truth.
- Checkpoints are valid only after writer success.
- SQL adapters must not expose dialect internals through core types.
- Tests use `English / 한국어` descriptions.

---

### Task 1: Step-Aware Restart

**Files:**
- Modify: `packages/core/src/types/runner.ts`
- Modify: `packages/core/src/runner/default-batch-runner.ts`
- Modify: `packages/core/src/runner/step-execution-runner.ts`
- Modify: `packages/core/src/runner/step-run-context.ts`
- Test: `packages/core/test/runner.test.ts`

**Interfaces:**
- Consumes: `JobRepository.findStepExecutions(jobExecutionId)`
- Produces: step-aware restart context that records skipped completed steps in the new execution.

- [x] **Step 1: Write failing tests**

Add tests showing restart skips completed steps before the first failed step and still uses failed execution checkpoints.

- [x] **Step 2: Run RED**

Run: `./node_modules/.bin/vitest run packages/core/test/runner.test.ts`
Expected: FAIL because restart currently reruns all steps.

- [x] **Step 3: Implement minimal restart planning**

Compute previous step executions from latest failed execution, pass a skip set into step runner, and record skipped step executions in the new execution.

- [x] **Step 4: Run GREEN**

Run: `./node_modules/.bin/vitest run packages/core/test/runner.test.ts`
Expected: PASS.

### Task 2: SQL Execution Creation Transaction Boundary

**Files:**
- Modify: `packages/core/src/types/repository.ts`
- Modify: `packages/core/src/runner/default-batch-runner.ts`
- Modify: `packages/postgres/src/repository/repository.ts`
- Modify: `packages/mysql/src/repository/repository.ts`
- Modify: `packages/mariadb/src/repository/repository.ts`
- Test: adapter tests for Postgres/MySQL/MariaDB.

**Interfaces:**
- Produces: `JobRepository.createExecutionAttempt(instance, execution): Promise<JobExecutionAttempt>`

- [x] **Step 1: Write failing tests**

Add fake repository and SQL adapter tests proving instance lookup/create, active execution check, and execution insert are a single repository operation.

- [x] **Step 2: Run RED**

Run: `./node_modules/.bin/vitest run packages/core/test/runner.test.ts packages/postgres/test/adapter.test.ts packages/mysql/test/adapter.test.ts packages/mariadb/test/adapter.test.ts`
Expected: FAIL because `createExecutionAttempt` does not exist.

- [x] **Step 3: Implement minimal contract and adapter behavior**

Default in-memory style repositories can implement the operation directly. SQL adapters use transaction statements where their fake pool supports them and lock the job instance row with `FOR UPDATE`.

- [x] **Step 4: Run GREEN**

Run the same test command and `./node_modules/.bin/tsc -b`.

### Task 3: Observability Hooks

**Files:**
- Modify: `packages/core/src/types/runner.ts`
- Modify: `packages/core/src/runner/default-batch-runner.ts`
- Modify: `packages/core/src/runner/step-execution-runner.ts`
- Modify: `packages/core/src/runner/chunk-step-runner.ts`
- Test: `packages/core/test/runner.test.ts`, `packages/core/test/step-runners.test.ts`

**Interfaces:**
- Produces: `BatchObserver` with job, step, chunk, retry, skip events.

- [x] **Step 1: Write failing tests**

Assert observer event order for job start/complete, step start/complete, chunk write, retry, and skip.

- [x] **Step 2: Run RED**

Run core runner tests and step runner tests.

- [x] **Step 3: Implement observer dispatch**

Pass optional observer through runner options and run options, keep events best-effort, awaited, and isolated from execution semantics.

- [x] **Step 4: Run GREEN**

Run core tests and typecheck.

### Task 4: Storage-Backed CLI

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/test/run-cli.test.ts`
- Test: CLI tests.

**Interfaces:**
- Produces: `runCli(args, { storage?, jobs? })`
- Commands: `run`, `status`, `list`, `retry`

- [x] **Step 1: Write failing tests**

Assert `status`, `list`, `run`, and `retry` use injected storage and jobs instead of scaffold messages.

- [x] **Step 2: Run RED**

Run: `./node_modules/.bin/vitest run packages/cli/test/run-cli.test.ts`
Expected: FAIL because commands are scaffold-only.

- [x] **Step 3: Implement minimal CLI command helpers**

Parse `--job`, `--execution-id`, and JSON `--parameters`, then call `DefaultBatchRunner` or repository methods.

- [x] **Step 4: Run GREEN**

Run CLI tests, full unit tests, and typecheck. E2E/perf tests remain separate DB-dependent verification paths.
