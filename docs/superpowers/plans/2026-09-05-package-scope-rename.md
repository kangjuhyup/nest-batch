# npm Package Scope Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공개 package 8개의 identity를 `@nest-batch/*`에서 `@rv-nest-batch/*`로 원자적으로 변경하고 기존 `0.1.0` release automation과 검증 계약을 유지한다.

**Architecture:** package directory와 책임은 유지하고 `scripts/release/package-catalog.mjs`의 `PUBLIC_PACKAGE_SCOPE`를 새 package identity의 source of truth로 둔다. source graph를 먼저 새 scope로 옮긴 뒤 release verifier와 tombstone invariant를 강화하고, 마지막으로 public docs와 maintainer checklist를 같은 이름으로 동기화한다.

**Tech Stack:** Node.js 24/20, TypeScript 5.7, pnpm 10.34.5 workspace, Vitest, Changesets 3, npm public registry, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-09-05-package-scope-rename-design.md`

**Depends on:** `docs/superpowers/plans/2026-09-04-public-release-automation.md` 완료

## Global Constraints

- 공개 package는 `@rv-nest-batch/{core,nest,inmemory,postgres,mysql,mariadb,bullmq,cli}` 8개다.
- package suffix, `packages/*` directory, package 책임과 dependency 방향은 변경하지 않는다.
- `core` subpath는 `queue`, `scheduler`, `polling`, `worker`를 그대로 유지한다.
- root와 공개 package version은 정확히 `0.1.0`을 유지하고 Changesets fixed group으로 함께 관리한다.
- source 내부 dependency는 `workspace:*`, packed/installed 내부 dependency는 exact current fixed version이어야 한다.
- root private package 이름 `nest-batch`와 repository URL `https://github.com/kangjuhyup/nest-batch.git`은 변경하지 않는다.
- package는 ESM-only이고 runtime은 Node `>=20.18.0`, publish workflow는 Node 24와 npm `12.0.2`를 유지한다.
- 모든 npm 조회와 publish는 `https://registry.npmjs.org/` 및 `--@rv-nest-batch:registry=https://registry.npmjs.org/`를 함께 명시한다.
- active source, test, example, manifest, lockfile, user/maintainer 문서에는 `@nest-batch/` reference가 남지 않는다.
- 날짜가 지난 `docs/superpowers/plans/`와 `docs/superpowers/specs/`의 역사적 설명은 tombstone scan에서 제외할 수 있다.
- compatibility alias package를 만들지 않는다.
- 실제 npm publish, npm scope/settings 변경, Git tag push, GitHub Release 생성은 실행하지 않는다.
- 테스트 설명은 `English / 한국어` 형식을 유지한다.

## File Structure

- `scripts/release/package-catalog.mjs`: `PUBLIC_PACKAGE_SCOPE`, 8개 package identity, canonical npm registry argument의 단일 source
- `scripts/release/package-entrypoints.mjs`: 새 scope의 `core`/`cli` exact entrypoint 계약
- `scripts/release/verify-release.mjs`: 새 scope manifest, Changesets graph, active-tree old-scope tombstone와 release guide 검증
- `scripts/release/pack-packages.mjs`: 새 package identity와 exact packed dependency/entrypoint 검증
- `scripts/release/publish-packages.mjs`: 새 scoped registry로 lookup/publish/confirmation 수행
- `scripts/release/smoke-packages.mjs`: 새 package와 core subpath를 clean consumer에서 compile/import/CLI 검증
- `packages/*/package.json`: 새 package name과 새 scope 내부 dependency
- `.changeset/config.json`: 새 8-package fixed group
- `tsconfig.base.json`, `vitest*.config.ts`: 새 package alias
- `examples/*/package.json`, `pnpm-lock.yaml`: 새 workspace dependency graph
- `README.md`, `README-kr.md`, `DATABASE.md`, `PLAN.md`, `docs/*.md`, `packages/*/{README.md,CHANGELOG.md}`, `examples/*/README.md`: 새 설치/import 이름
- `docs/releasing.md`: 새 scope ownership, audit, bootstrap, Trusted Publisher checklist
- `scripts/release/*.test.ts`: scope, registry, tombstone, pack/publish/smoke/document mutation coverage

---

### Task 1: Workspace package identity와 import graph 변경

**Files:**
- Modify: `scripts/release/package-catalog.mjs`
- Modify: `scripts/release/package-entrypoints.mjs`
- Modify: `scripts/release/verify-release.test.ts`
- Modify: `packages/{core,nest,inmemory,postgres,mysql,mariadb,bullmq,cli}/package.json`
- Modify: `packages/{core,nest,inmemory,postgres,mysql,mariadb,bullmq,cli}/{src,test}/**/*.ts`
- Modify: `e2e/**/*.ts`
- Modify: `examples/{basic,nestjs}/package.json`
- Modify: `examples/{basic,nestjs}/{src,test}/**/*.ts`
- Modify: `.changeset/config.json`
- Modify: `tsconfig.base.json`
- Modify: `vitest.config.ts`
- Modify: `vitest.e2e.config.ts`
- Modify: `vitest.perf.config.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `PUBLIC_PACKAGE_SCOPE = "@rv-nest-batch"`
- Produces: `PUBLIC_PACKAGES`의 exact 8-name catalog
- Produces: `NPM_SCOPE_REGISTRY_ARGUMENT = "--@rv-nest-batch:registry=https://registry.npmjs.org/"`
- Preserves: `CORE_SUBPATHS = ["queue", "scheduler", "polling", "worker"]`

- [ ] **Step 1: 새 catalog identity를 요구하는 failing test 작성**

`scripts/release/verify-release.test.ts`의 catalog test를 다음 계약으로 바꾸고 scope 상수를 import한다.

```ts
import {
  CORE_SUBPATHS,
  NPM_SCOPE_REGISTRY_ARGUMENT,
  PUBLIC_PACKAGE_SCOPE,
  PUBLIC_PACKAGES
} from "./package-catalog.mjs";

it("defines the rv-nest-batch public scope / rv-nest-batch 공개 scope를 정의한다", () => {
  expect(PUBLIC_PACKAGE_SCOPE).toBe("@rv-nest-batch");
  expect(PUBLIC_PACKAGES.map(({ name }) => name)).toEqual([
    "@rv-nest-batch/core",
    "@rv-nest-batch/nest",
    "@rv-nest-batch/inmemory",
    "@rv-nest-batch/postgres",
    "@rv-nest-batch/mysql",
    "@rv-nest-batch/mariadb",
    "@rv-nest-batch/bullmq",
    "@rv-nest-batch/cli"
  ]);
  expect(CORE_SUBPATHS).toEqual(["queue", "scheduler", "polling", "worker"]);
  expect(NPM_SCOPE_REGISTRY_ARGUMENT)
    .toBe("--@rv-nest-batch:registry=https://registry.npmjs.org/");
});
```

- [ ] **Step 2: catalog test가 기존 scope 때문에 실패하는지 확인**

Run:

```bash
source /Users/kangjuhyup/.nvm/nvm.sh
nvm use
corepack pnpm exec vitest run --config vitest.config.ts scripts/release/verify-release.test.ts
```

Expected: FAIL because `PUBLIC_PACKAGE_SCOPE`가 없거나 catalog 이름이 `@nest-batch/*`다.

- [ ] **Step 3: catalog를 새 scope의 단일 source로 변경**

`scripts/release/package-catalog.mjs`의 public identity를 다음 형태로 바꾼다.

```js
export const PUBLIC_PACKAGE_SCOPE = "@rv-nest-batch";

export const PUBLIC_PACKAGES = [
  { name: `${PUBLIC_PACKAGE_SCOPE}/core`, directory: "packages/core" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/nest`, directory: "packages/nest" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/inmemory`, directory: "packages/inmemory" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/postgres`, directory: "packages/postgres" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/mysql`, directory: "packages/mysql" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/mariadb`, directory: "packages/mariadb" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/bullmq`, directory: "packages/bullmq" },
  { name: `${PUBLIC_PACKAGE_SCOPE}/cli`, directory: "packages/cli" }
];

export const CORE_SUBPATHS = ["queue", "scheduler", "polling", "worker"];
export const NPM_REGISTRY_URL = "https://registry.npmjs.org/";
export const NPM_SCOPE_REGISTRY_ARGUMENT =
  `--${PUBLIC_PACKAGE_SCOPE}:registry=${NPM_REGISTRY_URL}`;
```

`scripts/release/package-entrypoints.mjs`는 hard-coded package name 대신
`${PUBLIC_PACKAGE_SCOPE}/core`와 `${PUBLIC_PACKAGE_SCOPE}/cli`를 사용한다.

- [ ] **Step 4: workspace manifest와 TypeScript import를 원자적으로 rename**

다음 active code/config 범위에서 exact `@nest-batch/` prefix를 `@rv-nest-batch/`로
기계적으로 바꾼다. `docs/superpowers/**`와 public Markdown은 Task 3에서 처리한다.

```bash
rg -l '@nest-batch/' \
  packages/*/package.json packages/*/src packages/*/test \
  examples/*/package.json examples/*/src examples/*/test e2e \
  .changeset/config.json tsconfig.base.json \
  vitest.config.ts vitest.e2e.config.ts vitest.perf.config.ts \
  | xargs perl -pi -e 's/\@nest-batch\//\@rv-nest-batch\//g'
```

변경 결과는 다음을 만족해야 한다.

```json
{
  "name": "@rv-nest-batch/nest",
  "dependencies": {
    "@rv-nest-batch/core": "workspace:*"
  }
}
```

root private `package.json`의 `name: "nest-batch"`는 유지한다.

- [ ] **Step 5: lockfile을 workspace manifest에서 재생성**

Run:

```bash
source /Users/kangjuhyup/.nvm/nvm.sh
nvm use
corepack pnpm install --lockfile-only
corepack pnpm install --frozen-lockfile
```

Expected: `pnpm-lock.yaml`의 importer dependency가 `@rv-nest-batch/*`로 바뀌고 frozen
install이 exit 0이다.

- [ ] **Step 6: package graph, typecheck와 build 검증**

Run:

```bash
source /Users/kangjuhyup/.nvm/nvm.sh
nvm use
corepack pnpm exec vitest run --config vitest.config.ts \
  scripts/release/verify-release.test.ts \
  packages/core/test packages/nest/test packages/inmemory/test \
  packages/postgres/test packages/mysql/test packages/mariadb/test \
  packages/bullmq/test packages/cli/test
corepack pnpm typecheck
corepack pnpm build
```

Expected: 새 scope catalog test, package unit tests, typecheck와 build가 통과한다. 실제 checkout
전체 `release:verify`는 Task 2와 Task 3의 release/docs migration 전까지 실행하지 않는다.

- [ ] **Step 7: package graph 변경 커밋**

```bash
git add scripts/release/package-catalog.mjs scripts/release/package-entrypoints.mjs \
  scripts/release/verify-release.test.ts packages examples e2e .changeset/config.json \
  tsconfig.base.json vitest.config.ts vitest.e2e.config.ts vitest.perf.config.ts pnpm-lock.yaml
git commit -m "feat : 공개 package scope 변경" \
  -m "- 8개 package와 내부 import를 @rv-nest-batch scope로 변경" \
  -m "- Changesets와 TypeScript workspace graph를 새 identity로 동기화"
```

---

### Task 2: Release automation과 old-scope tombstone 강화

**Files:**
- Modify: `scripts/release/package-catalog.mjs`
- Modify: `scripts/release/package-entrypoints.mjs`
- Modify: `scripts/release/verify-release.mjs`
- Modify: `scripts/release/verify-release.test.ts`
- Modify: `scripts/release/pack-packages.mjs`
- Modify: `scripts/release/pack-packages.test.ts`
- Modify: `scripts/release/publish-packages.mjs`
- Modify: `scripts/release/publish-packages.test.ts`
- Modify: `scripts/release/smoke-packages.mjs`
- Modify: `scripts/release/smoke-packages.test.ts`
- Modify: `scripts/release/release-check.mjs`
- Modify: `scripts/release/release-check.test.ts`
- Modify: `scripts/release/version-packages.test.ts`

**Interfaces:**
- Consumes: Task 1의 `PUBLIC_PACKAGE_SCOPE`, `PUBLIC_PACKAGES`, `NPM_SCOPE_REGISTRY_ARGUMENT`
- Produces: active tree의 모든 `@nest-batch/` reference를 거부하는 namespace tombstone
- Produces: 새 scope로 pack, consumer install/import, registry lookup/publish를 수행하는 release path

- [ ] **Step 1: old namespace와 제거된 package suffix mutation test 작성**

`scripts/release/verify-release.test.ts`에 다음 두 종류를 추가한다.

```ts
it("rejects the previous package namespace / 이전 package namespace를 거부한다", async () => {
  const root = createReleaseRepository();
  writeFileSync(
    join(root, "e2e", "old-scope.e2e.test.ts"),
    'import { defineJob } from "@nest-batch/core";\nvoid defineJob;\n'
  );

  await expect(verifyReleaseRepository(root))
    .rejects.toThrow(/@nest-batch\/core/u);
});

it("rejects removed packages in the new scope / 새 scope의 제거된 package를 거부한다", async () => {
  const root = createReleaseRepository();
  writeFileSync(
    join(root, "packages", "core", "src", "legacy.ts"),
    'export * from "@rv-nest-batch/queue-core";\n'
  );

  await expect(verifyReleaseRepository(root))
    .rejects.toThrow(/@rv-nest-batch\/queue-core/u);
});
```

동일한 old-scope mutation을 package manifest dependency, root Markdown과 lockfile fixture에도
넣어 active text scan이 모두 거부하는지 검사한다.

- [ ] **Step 2: old-scope mutation이 현재 validator에서 false-green인지 확인**

Run:

```bash
source /Users/kangjuhyup/.nvm/nvm.sh
nvm use
corepack pnpm exec vitest run --config vitest.config.ts scripts/release/verify-release.test.ts
```

Expected: 최소 old `@nest-batch/core` prefix mutation이 예상과 달리 통과하거나 error가 새
namespace tombstone을 가리키지 않아 FAIL한다.

- [ ] **Step 3: manifest scope와 namespace tombstone을 구조적으로 구현**

`scripts/release/verify-release.mjs`는 manifest name을 `packageInfo.name`과 exact 비교하고,
package name 형식은 `PUBLIC_PACKAGE_SCOPE` 뒤의 단일 valid npm name segment만 허용한다.

```js
const LEGACY_PACKAGE_PREFIXES = ["@nest-batch/"];
const REMOVED_PUBLIC_PACKAGE_SUFFIXES = [
  "queue-core",
  "scheduler-core",
  "scheduler-calendar",
  "polling-core",
  "worker-local",
  "worker-threads",
  "queue-bullmq"
];
const REMOVED_PUBLIC_PACKAGE_NAMES = REMOVED_PUBLIC_PACKAGE_SUFFIXES
  .map((suffix) => `${PUBLIC_PACKAGE_SCOPE}/${suffix}`);
```

`validateLegacyPackageAbsence()`는 다음을 각각 검사한다.

- `packages/<removed-suffix>` directory가 존재하면 실패
- historical `docs/superpowers/**`와 generated/vendor directory를 제외한 text file에
  `@nest-batch/`가 한 건이라도 있으면 실패
- 같은 active tree에 `REMOVED_PUBLIC_PACKAGE_NAMES`가 있으면 실패

scope prefix와 removed package name을 하나의 배열 index나 string slice에 결합하지 않는다.

- [ ] **Step 4: pack, publish, smoke fixture를 새 scope에 맞춤**

다음 exact 동작을 반영한다.

- `smoke-packages.mjs` consumer source와 runtime specifier가 `@rv-nest-batch/*` 및 네 core
  subpath를 import한다.
- `pack-packages.mjs`와 installed metadata 검사는 catalog name과 새 scope 내부 dependency
  exact `0.1.0`을 검증한다.
- `publish-packages.mjs` lookup/publish argv는 generic registry와
  `NPM_SCOPE_REGISTRY_ARGUMENT`을 모두 사용한다.
- hostile config test의 환경 key는
  `npm_config_@rv-nest-batch:registry=http://127.0.0.1:9/`이고, `npm config get`의 key는
  `@rv-nest-batch:registry`다.
- npm 11 scalar/npm 12 one-element array, inherited publish TTY, integrity skip/mismatch/retry
  의미는 바꾸지 않는다.

`scripts/release/publish-packages.test.ts`의 argv assertion은 다음 값을 포함해야 한다.

```ts
expect(NPM_SCOPE_REGISTRY_ARGUMENT)
  .toBe("--@rv-nest-batch:registry=https://registry.npmjs.org/");
expect(arguments_).toContain(NPM_SCOPE_REGISTRY_ARGUMENT);
expect(arguments_).not.toContain("--@nest-batch:registry=https://registry.npmjs.org/");
```

- [ ] **Step 5: release script focused test 실행**

Run:

```bash
source /Users/kangjuhyup/.nvm/nvm.sh
nvm use
corepack pnpm exec vitest run --config vitest.config.ts \
  scripts/release/verify-release.test.ts \
  scripts/release/pack-packages.test.ts \
  scripts/release/publish-packages.test.ts \
  scripts/release/smoke-packages.test.ts \
  scripts/release/release-check.test.ts \
  scripts/release/version-packages.test.ts
```

Expected: scope/catalog/tombstone/pack/publish/smoke/version mutation이 모두 통과한다. checkout
전체 guide 검증은 Task 3의 문서 migration 뒤 통과한다.

- [ ] **Step 6: release automation 변경 커밋**

```bash
git add scripts/release
git commit -m "fix : 새 package scope 배포 검증 강화" \
  -m "- old scope와 제거된 package reference를 release gate에서 차단" \
  -m "- pack publish smoke 경로를 @rv-nest-batch identity로 고정"
```

---

### Task 3: Public docs와 maintainer release guide 동기화

**Files:**
- Modify: `README.md`
- Modify: `README-kr.md`
- Modify: `DATABASE.md`
- Modify: `PLAN.md`
- Modify: `AGENTS.md`
- Modify: `.agents/orm-integration-engineer.md`
- Modify: `.agents/skills/database-adapters/SKILL.md`
- Modify: `.agents/skills/orm-integrations/SKILL.md`
- Modify: `docs/architecture.md`
- Modify: `docs/readers-kr.md`
- Modify: `docs/releasing.md`
- Modify: `examples/basic/README.md`
- Modify: `examples/nestjs/README.md`
- Modify: `packages/{core,nest,inmemory,postgres,mysql,mariadb,bullmq,cli}/README.md`
- Modify: `packages/{core,nest,inmemory,postgres,mysql,mariadb,bullmq,cli}/CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-09-03-package-release-readiness-design.md`
- Modify: `docs/superpowers/plans/2026-09-04-package-boundary-consolidation.md`
- Modify: `docs/superpowers/plans/2026-09-04-public-release-automation.md`
- Modify: `docs/superpowers/specs/2026-09-05-package-scope-rename-design.md`
- Modify: `scripts/release/verify-release.test.ts`

**Interfaces:**
- Consumes: Task 1의 exact 8-name catalog와 Task 2의 guide validator
- Produces: 새 scope 설치/import 문서, ownership/Trusted Publisher/bootstrap checklist
- Preserves: Version PR 승인 → Node 20/24 Quality/E2E → merge/local 검증 → identity audit → bootstrap → Trusted Publisher → signed tag/provenance/recovery 순서

**Required skill:** repo-local skill 문서를 수정하므로 이 Task를 시작하기 전에
`superpowers:writing-skills`를 읽고 해당 검증 절차를 함께 적용한다.

- [ ] **Step 1: 새 scope guide 요구사항과 old command rejection test 작성**

`scripts/release/verify-release.test.ts`의 guide fixture를 새 이름으로 바꾸고 다음 mutation을
추가한다.

```ts
it("rejects an old-scope npm audit command / 이전 scope npm audit 명령을 거부한다", async () => {
  const root = createReleaseRepository();
  const guide = join(root, "docs", "releasing.md");
  writeFileSync(
    guide,
    readFileSync(guide, "utf8").replace(
      "npm view @rv-nest-batch/core",
      "npm view @nest-batch/core"
    )
  );

  await expect(verifyReleaseRepository(root))
    .rejects.toThrow(/@rv-nest-batch\/core|@nest-batch\/core/u);
});
```

catalog 8개 audit와 `0.1.0` integrity confirmation, `npm whoami`, `npm profile get` 모두
`--@rv-nest-batch:registry=https://registry.npmjs.org/`를 요구하게 한다.

- [ ] **Step 2: guide test가 기존 공개 문서와 불일치해 실패하는지 확인**

Run:

```bash
source /Users/kangjuhyup/.nvm/nvm.sh
nvm use
corepack pnpm exec vitest run --config vitest.config.ts scripts/release/verify-release.test.ts
```

Expected: checkout guide나 fixture의 `@nest-batch/*` name/registry command 때문에 FAIL한다.

- [ ] **Step 3: active public docs와 changelog를 새 identity로 변경**

다음 public/maintainer 문서 범위의 exact package prefix를 바꾼다.

```bash
rg -l '@nest-batch/' \
  README.md README-kr.md DATABASE.md PLAN.md AGENTS.md \
  .agents/orm-integration-engineer.md \
  .agents/skills/database-adapters/SKILL.md \
  .agents/skills/orm-integrations/SKILL.md \
  docs/architecture.md docs/readers-kr.md docs/releasing.md \
  examples/basic/README.md examples/nestjs/README.md \
  packages/*/README.md packages/*/CHANGELOG.md \
  docs/superpowers/specs/2026-09-03-package-release-readiness-design.md \
  docs/superpowers/plans/2026-09-04-package-boundary-consolidation.md \
  docs/superpowers/plans/2026-09-04-public-release-automation.md \
  | xargs perl -pi -e 's/\@nest-batch\//\@rv-nest-batch\//g'
```

문맥을 다시 읽고 과거 collision 설명, old→new mapping, tombstone 설명처럼 이전 scope 자체를
설명해야 하는 문장은 기계적 치환을 되돌려 정확한 역사적 의미를 유지한다. npm 사용자에게
복사 가능한 install/import command와 현재 2026-09 release plan/spec의 최종 공개 이름은 모두
`@rv-nest-batch/*`여야 한다.

- [ ] **Step 4: release checklist를 새 scope manual gate로 갱신**

`docs/releasing.md`는 다음 명령 형태를 8개 package에 사용한다.

```bash
npm view @rv-nest-batch/core name version maintainers repository dist-tags --json \
  --registry https://registry.npmjs.org/ \
  --@rv-nest-batch:registry=https://registry.npmjs.org/
```

scope gate는 다음 의미를 명시한다.

- npm의 `rv-nest-batch` scope ownership과 publish 권한을 maintainer가 직접 확인
- 8개 `E404`는 이름의 public 조회 결과일 뿐 권한 증거가 아님
- 기존/새 package identity가 예상과 다르면 즉시 STOP
- bootstrap 뒤 새 package 8개 각각에 Trusted Publisher 등록
- local bootstrap `0.1.0` provenance 예외와 후속 OIDC version provenance 유지

- [ ] **Step 5: package README와 실제 imports 검증**

Run:

```bash
rg -n 'npm install @rv-nest-batch/' README.md README-kr.md packages/*/README.md
rg -n 'from "@rv-nest-batch/' README.md README-kr.md DATABASE.md docs examples packages
```

Expected: 8개 package README에 자기 package install command가 있고, core subpath 예제는
`@rv-nest-batch/core/{queue,scheduler,polling,worker}`를 사용한다.

- [ ] **Step 6: release verifier와 전체 Node 24 gate 실행**

Run:

```bash
source /Users/kangjuhyup/.nvm/nvm.sh
nvm use
corepack pnpm release:check
corepack pnpm test:e2e
```

Expected: metadata, fixed group, old-scope tombstone, entrypoint, docs/workflow, 8-package tarball,
clean consumer type/runtime/CLI smoke와 E2E가 모두 통과한다.

- [ ] **Step 7: public docs 변경 커밋**

```bash
git add README.md README-kr.md DATABASE.md PLAN.md AGENTS.md .agents docs examples/*/README.md \
  packages/*/README.md packages/*/CHANGELOG.md scripts/release/verify-release.test.ts
git commit -m "docs : 새 package scope 공개 문서 반영" \
  -m "- 설치 import release checklist를 @rv-nest-batch 이름으로 통일" \
  -m "- scope ownership과 Trusted Publisher 수동 gate를 명시"
```

---

### Task 4: Registry audit와 최종 branch verification

**Files:**
- Verify only: repository 전체 tracked state

**Interfaces:**
- Consumes: Task 1~3의 새 package graph, release automation과 문서
- Produces: implementation merge-readiness evidence와 actual publish STOP/GO 판단 자료

- [ ] **Step 1: public npm registry에서 새 8개 identity를 read-only로 재확인**

Run:

```bash
source /Users/kangjuhyup/.nvm/nvm.sh
nvm use
for suffix in core nest inmemory postgres mysql mariadb bullmq cli; do
  npm view "@rv-nest-batch/$suffix" name version maintainers repository dist-tags --json \
    --registry https://registry.npmjs.org/ \
    --@rv-nest-batch:registry=https://registry.npmjs.org/
done
```

Expected on 2026-09-05: 8개 모두 `E404`. 하나라도 package metadata를 반환하면 identity와
ownership을 조사하고 actual publish를 STOP한다. 모든 `E404`여도 scope ownership은 별도
manual gate로 남긴다.

- [ ] **Step 2: Node 24 clean release verification 실행**

Run:

```bash
source /Users/kangjuhyup/.nvm/nvm.sh
nvm use
node --version
corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm release:check
corepack pnpm test:e2e
```

Expected: Node `v24.x`, pnpm `10.34.5`, frozen install, unit/typecheck/build/repository verify,
8-package clean consumer smoke와 E2E가 모두 exit 0이다.

- [ ] **Step 3: Node 20 runtime floor verification 실행 후 Node 24로 복귀**

Run:

```bash
source /Users/kangjuhyup/.nvm/nvm.sh
nvm use 20.18.3
CI=1 corepack pnpm release:check
nvm use
node --version
```

Expected: Node 20 release gate가 exit 0이고 마지막 version은 다시 `v24.x`다.

- [ ] **Step 4: active old-scope, credential, artifact와 diff scan 실행**

Run:

```bash
if rg --hidden -n '@nest-batch/' \
  packages examples e2e scripts .github .agents .codex \
  README.md README-kr.md DATABASE.md PLAN.md AGENTS.md \
  docs/architecture.md docs/readers-kr.md docs/releasing.md \
  .changeset/config.json tsconfig.base.json vitest.config.ts \
  vitest.e2e.config.ts vitest.perf.config.ts pnpm-lock.yaml; then
  exit 1
fi

git diff --check

if git ls-files | rg '(^|/)(\.env($|\.)|\.npmrc$)|\.(tgz|tsbuildinfo|pem|key|p12|pfx)$'; then
  exit 1
fi

git status --short
```

Expected: old-scope/credential/artifact/diff scan 출력이 없고 tracked worktree가 clean이다.

- [ ] **Step 5: final review handoff**

Reviewer에게 spec, 이 plan, Task 1~3 commit range, Node 24/20 검증 결과와 read-only registry
audit 결과를 전달한다. 다음을 분리해 판정한다.

- implementation merge readiness: code/test/docs/release automation 기준
- actual public publish readiness: `rv-nest-batch` scope ownership, npm 2FA, package별 Trusted
  Publisher, GitHub `npm` environment required reviewer가 모두 확인된 뒤에만 GO

실제 publish, tag, GitHub Release와 외부 settings write는 reviewer나 implementer가 실행하지
않는다.
