# nest-batch Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first `nest-batch` monorepo scaffold with package boundaries, minimal public contracts, docs, examples, and verification commands.

**Architecture:** The workspace is split into `packages/core`, `packages/nest`, `packages/postgres`, and `packages/cli`. `@nest-batch/core` owns framework-independent contracts and helpers; all NestJS, Postgres, and CLI concerns stay in adapter packages that depend inward on core.

**Tech Stack:** pnpm workspaces, TypeScript `NodeNext`, Vitest, Node.js ESM packages, NestJS peer dependencies only in `@nest-batch/nest`.

## Global Constraints

- `@nest-batch/core` must not depend on NestJS, database clients, queue clients, or CLI frameworks.
- NestJS integration belongs in `packages/nest`.
- Postgres repository, lock, and checkpoint adapter boundaries belong in `packages/postgres`.
- CLI command bootstrap belongs in `packages/cli`.
- Durable execution, real persistence, distributed workers, and production scheduling are out of scope for this scaffold.
- Public docs must not describe unimplemented durable runtime behavior as already available.
- Existing `.agents/`, `.skills/`, `.codex/`, and `AGENTS.md` are repository guidance; do not rewrite them for this scaffold.

---

## File Structure

Create or modify these files:

- Modify `package.json`: convert the root package into a private pnpm workspace with build, test, typecheck, and clean scripts.
- Create `pnpm-workspace.yaml`: include `packages/*` and `examples/*`.
- Create `.gitignore`: ignore dependencies and build artifacts.
- Create `tsconfig.base.json`: shared strict TypeScript options.
- Create `tsconfig.json`: root project references.
- Create `vitest.config.ts`: root test configuration and package aliases.
- Create `packages/core/package.json`: package metadata and exports.
- Create `packages/core/tsconfig.json`: package build configuration.
- Create `packages/core/src/index.ts`: public core export surface.
- Create `packages/core/src/types.ts`: stable execution and contract types.
- Create `packages/core/src/definitions.ts`: `defineJob` and `defineStep`.
- Create `packages/core/test/definitions.test.ts`: core behavior tests.
- Create `packages/nest/package.json`: package metadata, exports, peer dependencies.
- Create `packages/nest/tsconfig.json`: package build configuration and reference to core.
- Create `packages/nest/src/constants.ts`: Nest metadata tokens.
- Create `packages/nest/src/decorators.ts`: `BatchJob` and `BatchStep`.
- Create `packages/nest/src/module.ts`: `NestBatchModule`.
- Create `packages/nest/src/index.ts`: public Nest export surface.
- Create `packages/nest/test/exports.test.ts`: Nest package export test.
- Create `packages/postgres/package.json`: package metadata and exports.
- Create `packages/postgres/tsconfig.json`: package build configuration and reference to core.
- Create `packages/postgres/src/errors.ts`: explicit scaffold error helper.
- Create `packages/postgres/src/options.ts`: adapter options.
- Create `packages/postgres/src/repository.ts`: `PostgresJobRepository` scaffold.
- Create `packages/postgres/src/checkpoint-store.ts`: `PostgresCheckpointStore` scaffold.
- Create `packages/postgres/src/index.ts`: public Postgres export surface.
- Create `packages/postgres/test/exports.test.ts`: Postgres package export test.
- Create `packages/cli/package.json`: package metadata, exports, bin mapping.
- Create `packages/cli/tsconfig.json`: package build configuration and reference to core.
- Create `packages/cli/src/index.ts`: CLI command boundary.
- Create `packages/cli/src/bin.ts`: executable entry point.
- Create `packages/cli/test/run-cli.test.ts`: CLI behavior test.
- Modify `README.md`: describe current scaffold, package split, and quickstart commands.
- Create `docs/architecture.md`: explain package boundaries and runtime constraints.
- Create `examples/basic/README.md`: programmatic example aligned with implemented core API.
- Create `examples/basic/src/index.ts`: minimal `defineJob` example.
- Create `examples/nestjs/README.md`: Nest sketch clearly marked as scaffold-level.
- Create `examples/nestjs/src/billing.job.ts`: decorator example using exported Nest APIs.

---

### Task 1: Root Workspace Tooling

**Files:**
- Modify: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`

**Interfaces:**
- Consumes: existing root package metadata.
- Produces: root commands `build`, `typecheck`, `test`, `clean`; package aliases for tests; TypeScript project references used by all later tasks.

- [ ] **Step 1: Write root workspace configuration**

Replace `package.json` with:

```json
{
  "name": "nest-batch",
  "version": "0.0.1",
  "description": "Node-native batch framework packages for NestJS applications.",
  "private": true,
  "type": "module",
  "license": "MIT",
  "scripts": {
    "build": "tsc -b",
    "clean": "tsc -b --clean",
    "test": "vitest run",
    "typecheck": "tsc -b"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "examples/*"
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
.DS_Store
*.log
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@nest-batch/core": ["packages/core/src/index.ts"],
      "@nest-batch/nest": ["packages/nest/src/index.ts"],
      "@nest-batch/postgres": ["packages/postgres/src/index.ts"],
      "@nest-batch/cli": ["packages/cli/src/index.ts"]
    }
  }
}
```

Create `tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./packages/core" },
    { "path": "./packages/nest" },
    { "path": "./packages/postgres" },
    { "path": "./packages/cli" }
  ]
}
```

Create `vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@nest-batch/core": fromRoot("./packages/core/src/index.ts"),
      "@nest-batch/nest": fromRoot("./packages/nest/src/index.ts"),
      "@nest-batch/postgres": fromRoot("./packages/postgres/src/index.ts"),
      "@nest-batch/cli": fromRoot("./packages/cli/src/index.ts")
    }
  },
  test: {
    include: ["packages/**/*.test.ts"]
  }
});
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && env COREPACK_DEFAULT_TO_LATEST=0 pnpm install
```

Expected: pnpm installs `typescript`, `vitest`, and `@types/node`, then creates `pnpm-lock.yaml`.

- [ ] **Step 3: Verify root commands fail only because packages are not present yet**

Run:

```bash
pnpm typecheck
```

Expected: FAIL with TypeScript errors about missing package tsconfig files or no matching `packages/*/tsconfig.json`. This confirms the root command is wired before packages exist.

- [ ] **Step 4: Commit root tooling**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml .gitignore tsconfig.base.json tsconfig.json vitest.config.ts
git commit -m "chore: configure workspace tooling"
```

---

### Task 2: Core Package Contracts

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/definitions.ts`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/test/definitions.test.ts`

**Interfaces:**
- Consumes: root TypeScript and Vitest config from Task 1.
- Produces:
  - `JobExecutionStatus`
  - `JobParameters`
  - `BatchExecutionId`
  - `StepExecutionContext`
  - `StepDefinition<Input, Output>`
  - `JobDefinition<Parameters>`
  - `JobExecution<Parameters>`
  - `JobRepository`
  - `CheckpointStore`
  - `BatchRunOptions`
  - `BatchRunner`
  - `defineStep<Input, Output>(definition): StepDefinition<Input, Output>`
  - `defineJob<Parameters>(definition): JobDefinition<Parameters>`

- [ ] **Step 1: Write failing core tests**

Create `packages/core/test/definitions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defineJob, defineStep } from "../src/index.js";

describe("core definitions", () => {
  it("defines a job with ordered steps without NestJS", async () => {
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

  it("rejects jobs without steps", () => {
    expect(() => defineJob({ name: "empty-job", steps: [] })).toThrow(
      'Job "empty-job" must include at least one step.'
    );
  });

  it("rejects blank names", () => {
    expect(() =>
      defineStep({
        name: " ",
        async execute() {
          return undefined;
        }
      })
    ).toThrow("Step name is required.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test packages/core/test/definitions.test.ts
```

Expected: FAIL because `packages/core/src/index.ts` does not exist yet.

- [ ] **Step 3: Implement core package metadata and TypeScript config**

Create `packages/core/package.json`:

```json
{
  "name": "@nest-batch/core",
  "version": "0.0.1",
  "description": "Framework-independent contracts and helpers for nest-batch.",
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
    "test": "vitest run"
  }
}
```

Create `packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/.tsbuildinfo"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Implement core contracts**

Create `packages/core/src/types.ts`:

```ts
export type JobExecutionStatus = "created" | "running" | "completed" | "failed" | "cancelled";

export type JobParameters = Record<string, unknown>;

export type BatchExecutionId = string;

export interface StepExecutionContext<Input = unknown> {
  readonly input?: Input;
  readonly signal: AbortSignal;
  readonly checkpoint?: unknown;
}

export interface StepDefinition<Input = unknown, Output = unknown> {
  readonly name: string;
  readonly execute: (context: StepExecutionContext<Input>) => Promise<Output> | Output;
}

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

Create `packages/core/src/definitions.ts`:

```ts
import type { JobDefinition, JobParameters, StepDefinition } from "./types.js";

const assertName = (kind: "Job" | "Step", name: string): void => {
  if (name.trim().length === 0) {
    throw new Error(`${kind} name is required.`);
  }
};

export const defineStep = <Input = unknown, Output = unknown>(
  definition: StepDefinition<Input, Output>
): StepDefinition<Input, Output> => {
  assertName("Step", definition.name);

  return Object.freeze({
    ...definition,
    name: definition.name.trim()
  });
};

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

Create `packages/core/src/index.ts`:

```ts
export { defineJob, defineStep } from "./definitions.js";
export type {
  BatchExecutionId,
  BatchRunOptions,
  BatchRunner,
  CheckpointStore,
  JobDefinition,
  JobExecution,
  JobExecutionStatus,
  JobParameters,
  JobRepository,
  StepDefinition,
  StepExecutionContext
} from "./types.js";
```

- [ ] **Step 5: Run core tests**

Run:

```bash
pnpm test packages/core/test/definitions.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run core typecheck**

Run:

```bash
pnpm typecheck
```

Expected: FAIL because later packages are still missing. No errors should point to `packages/core`.

- [ ] **Step 7: Commit core scaffold**

```bash
git add packages/core
git commit -m "feat(core): add initial batch contracts"
```

---

### Task 3: Nest Integration Package Shell

**Files:**
- Create: `packages/nest/package.json`
- Create: `packages/nest/tsconfig.json`
- Create: `packages/nest/src/constants.ts`
- Create: `packages/nest/src/decorators.ts`
- Create: `packages/nest/src/module.ts`
- Create: `packages/nest/src/index.ts`
- Create: `packages/nest/test/exports.test.ts`

**Interfaces:**
- Consumes: `BatchRunOptions` from `@nest-batch/core`.
- Produces:
  - `NEST_BATCH_OPTIONS`
  - `BATCH_JOB_METADATA`
  - `BATCH_STEP_METADATA`
  - `NestBatchModuleOptions`
  - `NestBatchModule.forRoot(options?: NestBatchModuleOptions): DynamicModule`
  - `BatchJob(nameOrOptions?: string | BatchJobOptions): ClassDecorator`
  - `BatchStep(nameOrOptions?: string | BatchStepOptions): MethodDecorator`

- [ ] **Step 1: Write failing Nest export test**

Create `packages/nest/test/exports.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BatchJob, BatchStep, NestBatchModule } from "../src/index.js";

describe("nest package exports", () => {
  it("creates a dynamic module with options provider", () => {
    const dynamicModule = NestBatchModule.forRoot({ defaultTimeoutMs: 5000 });

    expect(dynamicModule.module).toBe(NestBatchModule);
    expect(dynamicModule.providers).toHaveLength(1);
    expect(dynamicModule.exports).toHaveLength(1);
  });

  it("exports decorator factories", () => {
    expect(typeof BatchJob("daily-billing")).toBe("function");
    expect(typeof BatchStep("charge-account")).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test packages/nest/test/exports.test.ts
```

Expected: FAIL because `packages/nest/src/index.ts` does not exist yet.

- [ ] **Step 3: Implement package metadata and TypeScript config**

Create `packages/nest/package.json`:

```json
{
  "name": "@nest-batch/nest",
  "version": "0.0.1",
  "description": "NestJS integration for nest-batch.",
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
    "test": "vitest run"
  },
  "dependencies": {
    "@nest-batch/core": "workspace:*"
  },
  "peerDependencies": {
    "@nestjs/common": "^10.0.0 || ^11.0.0",
    "@nestjs/core": "^10.0.0 || ^11.0.0",
    "reflect-metadata": "^0.1.13 || ^0.2.0"
  },
  "devDependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "reflect-metadata": "^0.2.2"
  }
}
```

Create `packages/nest/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "tsBuildInfoFile": "dist/.tsbuildinfo"
  },
  "include": ["src/**/*.ts"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 4: Implement Nest constants, decorators, and module**

Create `packages/nest/src/constants.ts`:

```ts
export const NEST_BATCH_OPTIONS = Symbol("nest-batch:options");
export const BATCH_JOB_METADATA = Symbol("nest-batch:job");
export const BATCH_STEP_METADATA = Symbol("nest-batch:step");
```

Create `packages/nest/src/decorators.ts`:

```ts
import { SetMetadata } from "@nestjs/common";
import { BATCH_JOB_METADATA, BATCH_STEP_METADATA } from "./constants.js";

export interface BatchJobOptions {
  readonly name?: string;
}

export interface BatchStepOptions {
  readonly name?: string;
}

const normalizeOptions = <TOptions extends { readonly name?: string }>(
  nameOrOptions?: string | TOptions
): TOptions => {
  if (typeof nameOrOptions === "string") {
    return { name: nameOrOptions } as TOptions;
  }

  return (nameOrOptions ?? {}) as TOptions;
};

export const BatchJob = (nameOrOptions?: string | BatchJobOptions): ClassDecorator =>
  SetMetadata(BATCH_JOB_METADATA, normalizeOptions<BatchJobOptions>(nameOrOptions));

export const BatchStep = (nameOrOptions?: string | BatchStepOptions): MethodDecorator =>
  SetMetadata(BATCH_STEP_METADATA, normalizeOptions<BatchStepOptions>(nameOrOptions));
```

Create `packages/nest/src/module.ts`:

```ts
import { DynamicModule, Module } from "@nestjs/common";
import type { BatchRunOptions } from "@nest-batch/core";
import { NEST_BATCH_OPTIONS } from "./constants.js";

export interface NestBatchModuleOptions {
  readonly defaultTimeoutMs?: number;
  readonly runner?: Partial<BatchRunOptions>;
}

@Module({})
export class NestBatchModule {
  static forRoot(options: NestBatchModuleOptions = {}): DynamicModule {
    return {
      module: NestBatchModule,
      providers: [
        {
          provide: NEST_BATCH_OPTIONS,
          useValue: options
        }
      ],
      exports: [NEST_BATCH_OPTIONS]
    };
  }
}
```

Create `packages/nest/src/index.ts`:

```ts
export { BATCH_JOB_METADATA, BATCH_STEP_METADATA, NEST_BATCH_OPTIONS } from "./constants.js";
export { BatchJob, BatchStep } from "./decorators.js";
export type { BatchJobOptions, BatchStepOptions } from "./decorators.js";
export { NestBatchModule } from "./module.js";
export type { NestBatchModuleOptions } from "./module.js";
```

- [ ] **Step 5: Install Nest package dependencies**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use && env COREPACK_DEFAULT_TO_LATEST=0 pnpm install
```

Expected: pnpm installs NestJS development dependencies for `@nest-batch/nest` and updates `pnpm-lock.yaml`.

- [ ] **Step 6: Run Nest export test**

Run:

```bash
pnpm test packages/nest/test/exports.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Nest package scaffold**

```bash
git add packages/nest pnpm-lock.yaml
git commit -m "feat(nest): add integration package shell"
```

---

### Task 4: Postgres Adapter Package Shell

**Files:**
- Create: `packages/postgres/package.json`
- Create: `packages/postgres/tsconfig.json`
- Create: `packages/postgres/src/errors.ts`
- Create: `packages/postgres/src/options.ts`
- Create: `packages/postgres/src/repository.ts`
- Create: `packages/postgres/src/checkpoint-store.ts`
- Create: `packages/postgres/src/index.ts`
- Create: `packages/postgres/test/exports.test.ts`

**Interfaces:**
- Consumes: `BatchExecutionId`, `CheckpointStore`, `JobExecution`, `JobRepository` from `@nest-batch/core`.
- Produces:
  - `PostgresBatchOptions`
  - `createPostgresScaffoldError(component: string): Error`
  - `PostgresJobRepository implements JobRepository`
  - `PostgresCheckpointStore implements CheckpointStore`

- [ ] **Step 1: Write failing Postgres export test**

Create `packages/postgres/test/exports.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PostgresCheckpointStore,
  PostgresJobRepository,
  createPostgresScaffoldError
} from "../src/index.js";

describe("postgres package exports", () => {
  it("constructs adapter shells with explicit options", () => {
    const options = { connectionString: "postgres://localhost/nest_batch" };

    expect(new PostgresJobRepository(options)).toBeInstanceOf(PostgresJobRepository);
    expect(new PostgresCheckpointStore(options)).toBeInstanceOf(PostgresCheckpointStore);
  });

  it("reports scaffold-only behavior explicitly", () => {
    expect(createPostgresScaffoldError("repository").message).toBe(
      "Postgres repository is scaffolded but not implemented yet."
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test packages/postgres/test/exports.test.ts
```

Expected: FAIL because `packages/postgres/src/index.ts` does not exist yet.

- [ ] **Step 3: Implement package metadata and TypeScript config**

Create `packages/postgres/package.json`:

```json
{
  "name": "@nest-batch/postgres",
  "version": "0.0.1",
  "description": "Postgres persistence adapter boundary for nest-batch.",
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
    "test": "vitest run"
  },
  "dependencies": {
    "@nest-batch/core": "workspace:*"
  }
}
```

Create `packages/postgres/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/.tsbuildinfo"
  },
  "include": ["src/**/*.ts"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 4: Implement Postgres adapter shell**

Create `packages/postgres/src/errors.ts`:

```ts
export const createPostgresScaffoldError = (component: string): Error =>
  new Error(`Postgres ${component} is scaffolded but not implemented yet.`);
```

Create `packages/postgres/src/options.ts`:

```ts
export interface PostgresBatchOptions {
  readonly connectionString?: string;
  readonly schema?: string;
}
```

Create `packages/postgres/src/repository.ts`:

```ts
import type { BatchExecutionId, JobExecution, JobRepository } from "@nest-batch/core";
import { createPostgresScaffoldError } from "./errors.js";
import type { PostgresBatchOptions } from "./options.js";

export class PostgresJobRepository implements JobRepository {
  constructor(readonly options: PostgresBatchOptions) {}

  async create(_execution: JobExecution): Promise<void> {
    throw createPostgresScaffoldError("repository");
  }

  async update(_execution: JobExecution): Promise<void> {
    throw createPostgresScaffoldError("repository");
  }

  async findById(_id: BatchExecutionId): Promise<JobExecution | undefined> {
    throw createPostgresScaffoldError("repository");
  }
}
```

Create `packages/postgres/src/checkpoint-store.ts`:

```ts
import type { BatchExecutionId, CheckpointStore } from "@nest-batch/core";
import { createPostgresScaffoldError } from "./errors.js";
import type { PostgresBatchOptions } from "./options.js";

export class PostgresCheckpointStore implements CheckpointStore {
  constructor(readonly options: PostgresBatchOptions) {}

  async read<TCheckpoint = unknown>(
    _executionId: BatchExecutionId,
    _stepName: string
  ): Promise<TCheckpoint | undefined> {
    throw createPostgresScaffoldError("checkpoint store");
  }

  async write<TCheckpoint = unknown>(
    _executionId: BatchExecutionId,
    _stepName: string,
    _checkpoint: TCheckpoint
  ): Promise<void> {
    throw createPostgresScaffoldError("checkpoint store");
  }

  async delete(_executionId: BatchExecutionId, _stepName: string): Promise<void> {
    throw createPostgresScaffoldError("checkpoint store");
  }
}
```

Create `packages/postgres/src/index.ts`:

```ts
export { PostgresCheckpointStore } from "./checkpoint-store.js";
export { createPostgresScaffoldError } from "./errors.js";
export type { PostgresBatchOptions } from "./options.js";
export { PostgresJobRepository } from "./repository.js";
```

- [ ] **Step 5: Run Postgres export test**

Run:

```bash
pnpm test packages/postgres/test/exports.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Postgres package scaffold**

```bash
git add packages/postgres
git commit -m "feat(postgres): add adapter package shell"
```

---

### Task 5: CLI Package Shell

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/bin.ts`
- Create: `packages/cli/test/run-cli.test.ts`

**Interfaces:**
- Consumes: root TypeScript and Vitest config.
- Produces:
  - `CliResult`
  - `runCli(args: readonly string[]): Promise<CliResult>`
  - executable bin `nest-batch`

- [ ] **Step 1: Write failing CLI test**

Create `packages/cli/test/run-cli.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

describe("runCli", () => {
  it("prints help for empty args", async () => {
    await expect(runCli([])).resolves.toEqual({
      exitCode: 0,
      output: "nest-batch commands: run, status, retry, list"
    });
  });

  it("rejects unknown commands", async () => {
    await expect(runCli(["unknown"])).resolves.toEqual({
      exitCode: 1,
      output: 'Unknown command "unknown".'
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test packages/cli/test/run-cli.test.ts
```

Expected: FAIL because `packages/cli/src/index.ts` does not exist yet.

- [ ] **Step 3: Implement package metadata and TypeScript config**

Create `packages/cli/package.json`:

```json
{
  "name": "@nest-batch/cli",
  "version": "0.0.1",
  "description": "Operational CLI boundary for nest-batch.",
  "type": "module",
  "license": "MIT",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "nest-batch": "./dist/bin.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@nest-batch/core": "workspace:*"
  }
}
```

Create `packages/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/.tsbuildinfo"
  },
  "include": ["src/**/*.ts"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 4: Implement CLI command boundary**

Create `packages/cli/src/index.ts`:

```ts
export interface CliResult {
  readonly exitCode: number;
  readonly output: string;
}

const commands = new Set(["run", "status", "retry", "list"]);

export const runCli = async (args: readonly string[]): Promise<CliResult> => {
  const [command] = args;

  if (command === undefined || command === "--help" || command === "-h") {
    return {
      exitCode: 0,
      output: "nest-batch commands: run, status, retry, list"
    };
  }

  if (!commands.has(command)) {
    return {
      exitCode: 1,
      output: `Unknown command "${command}".`
    };
  }

  return {
    exitCode: 0,
    output: `Command "${command}" is scaffolded but not implemented yet.`
  };
};
```

Create `packages/cli/src/bin.ts`:

```ts
#!/usr/bin/env node
import { runCli } from "./index.js";

const result = await runCli(process.argv.slice(2));

if (result.output.length > 0) {
  console.log(result.output);
}

process.exitCode = result.exitCode;
```

- [ ] **Step 5: Run CLI test**

Run:

```bash
pnpm test packages/cli/test/run-cli.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit CLI package scaffold**

```bash
git add packages/cli
git commit -m "feat(cli): add command package shell"
```

---

### Task 6: Docs and Examples

**Files:**
- Modify: `README.md`
- Create: `docs/architecture.md`
- Create: `examples/basic/README.md`
- Create: `examples/basic/src/index.ts`
- Create: `examples/nestjs/README.md`
- Create: `examples/nestjs/src/billing.job.ts`

**Interfaces:**
- Consumes: exported APIs from Tasks 2 and 3.
- Produces: documentation that accurately describes current scaffold status and package boundaries.

- [ ] **Step 1: Write README**

Replace `README.md` with:

```md
# nest-batch

`nest-batch` is a Node-native batch framework project for the NestJS ecosystem.

This repository is currently in scaffold stage. The package boundaries and
public entry points are present, but durable execution, persistence, distributed
workers, and production scheduling are not implemented yet.

## Packages

- `@nest-batch/core`: framework-independent job and step contracts.
- `@nest-batch/nest`: NestJS module and decorator integration.
- `@nest-batch/postgres`: Postgres adapter boundary for repository and checkpoint storage.
- `@nest-batch/cli`: operational CLI boundary.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Core Example

```ts
import { defineJob, defineStep } from "@nest-batch/core";

const step = defineStep({
  name: "load-users",
  async execute({ signal }) {
    signal.throwIfAborted();
    return "loaded";
  }
});

export const job = defineJob({
  name: "daily-user-import",
  steps: [step]
});
```

See `docs/architecture.md` for package boundaries and runtime constraints.
```

- [ ] **Step 2: Write architecture docs**

Create `docs/architecture.md`:

```md
# Architecture

`nest-batch` is split by runtime responsibility.

## `@nest-batch/core`

Core contains framework-independent contracts and helpers. It must not import
NestJS, database clients, queue clients, or CLI frameworks.

Core owns:

- job and step definitions
- execution identifiers and status types
- repository and checkpoint contracts
- runner-facing options

## `@nest-batch/nest`

Nest integration contains module APIs, decorators, discovery, and lifecycle
integration. It depends on `@nest-batch/core`; core does not depend on NestJS.

## `@nest-batch/postgres`

The Postgres package contains adapter boundaries for job repository,
checkpoint storage, and future locking. The current scaffold does not implement
real persistence.

## `@nest-batch/cli`

The CLI package owns operational commands such as `run`, `status`, `retry`, and
`list`. The current scaffold exposes command boundaries only.

## Runtime Constraints

Future runtime work should treat failure and restart as normal paths:

- job execution has a durable identity
- step execution can be checkpointed
- cancellation uses `AbortSignal`
- distributed execution assumes at-least-once delivery
- idempotency expectations are documented near job parameters and retry behavior
- schedulers create or enqueue executions instead of bypassing the runtime
```

- [ ] **Step 3: Write examples**

Create `examples/basic/README.md`:

```md
# Basic Example

This example shows the scaffold-level programmatic API from `@nest-batch/core`.
It defines a job and a step, but does not run durable execution yet.
```

Create `examples/basic/src/index.ts`:

```ts
import { defineJob, defineStep } from "@nest-batch/core";

const loadUsers = defineStep({
  name: "load-users",
  async execute({ signal }) {
    signal.throwIfAborted();
    return ["user-1", "user-2"];
  }
});

export const dailyUserImport = defineJob({
  name: "daily-user-import",
  steps: [loadUsers]
});
```

Create `examples/nestjs/README.md`:

```md
# NestJS Example

This is a scaffold-level sketch of the NestJS decorator API. Discovery and
runtime execution are not implemented yet.
```

Create `examples/nestjs/src/billing.job.ts`:

```ts
import { BatchJob, BatchStep } from "@nest-batch/nest";

@BatchJob("daily-billing")
export class BillingJob {
  @BatchStep("charge-accounts")
  async chargeAccounts(): Promise<void> {
    return undefined;
  }
}
```

- [ ] **Step 4: Commit docs and examples**

```bash
git add README.md docs/architecture.md examples/basic examples/nestjs
git commit -m "docs: add scaffold docs and examples"
```

---

### Task 7: Full Workspace Verification

**Files:**
- Modify only if verification finds concrete issues in files created by Tasks 1-6.

**Interfaces:**
- Consumes: full workspace scaffold.
- Produces: passing root verification and a final scaffold commit if fixes are needed.

- [ ] **Step 1: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Run tests**

Run:

```bash
pnpm test
```

Expected: PASS with tests from `packages/core`, `packages/nest`, `packages/postgres`, and `packages/cli`.

- [ ] **Step 3: Run build**

Run:

```bash
pnpm build
```

Expected: PASS and creates `dist` directories under package folders.

- [ ] **Step 4: Confirm core has no Nest dependency**

Run:

```bash
rg -n "@nestjs|reflect-metadata" packages/core
```

Expected: no matches.

- [ ] **Step 5: Inspect git state**

Run:

```bash
git status --short
```

Expected: only intentionally untracked pre-existing guidance files remain, plus build artifacts ignored by `.gitignore`.

- [ ] **Step 6: Commit verification fixes if any were required**

If Steps 1-4 required code changes, commit them:

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json vitest.config.ts packages README.md docs/architecture.md examples
git commit -m "chore: finish scaffold verification"
```

Expected: commit is created only when verification produced necessary file changes.

---

## Self-Review

Spec coverage:

- Package boundaries are covered by Tasks 1-5.
- Core framework independence is covered by Task 2 and verified in Task 7.
- Nest integration lives in `packages/nest` in Task 3.
- Postgres adapter details stay in `packages/postgres` in Task 4.
- CLI boundary lives in `packages/cli` in Task 5.
- README, architecture docs, and examples are covered by Task 6.
- Build, test, and public export verification are covered by Task 7.

Placeholder scan:

- No banned placeholder markers or undefined implementation steps remain.
- Scaffold-only behavior is explicit in Postgres and CLI outputs.

Type consistency:

- `BatchRunOptions` is produced by `@nest-batch/core` and consumed by `@nest-batch/nest`.
- `JobRepository` and `CheckpointStore` are produced by `@nest-batch/core` and implemented by `@nest-batch/postgres`.
- `runCli` is produced by `@nest-batch/cli` and tested directly.
