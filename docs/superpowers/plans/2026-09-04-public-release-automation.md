# Public Release Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 통합된 8개 package를 `0.1.0` public npm package로 검증하고 Changesets, tag-gated OIDC publish, GitHub release notes로 안전하게 릴리스할 수 있게 한다.

**Architecture:** 하나의 package catalog를 release 검사의 source of truth로 사용하고 metadata, tarball, consumer install, version/tag를 자동 검증한다. Changesets는 고정 버전과 package별 changelog를 관리하고, `vX.Y.Z` tag workflow는 npm publish와 GitHub Release를 분리된 최소 권한 job으로 실행한다.

**Tech Stack:** Node.js ESM scripts, TypeScript 5.7, pnpm 10.34.5, Vitest, Changesets 3, GitHub Actions, npm Trusted Publishing OIDC

**Spec:** `docs/superpowers/specs/2026-09-03-package-release-readiness-design.md`

**Depends on:** `docs/superpowers/plans/2026-09-04-package-boundary-consolidation.md` 완료

## Global Constraints

- 공개 package는 `core`, `nest`, `inmemory`, `postgres`, `mysql`, `mariadb`, `bullmq`, `cli` 8개다.
- root와 모든 공개 package의 최초 version은 정확히 `0.1.0`이다.
- 8개 package는 Changesets fixed group으로 항상 같은 version을 사용한다.
- package runtime은 Node `>=20.18.0`, publish workflow는 Node 24와 npm `12.0.2`를 사용한다.
- package는 ESM-only이며 CommonJS export를 추가하지 않는다.
- tarball에는 `dist`, `src`, `README.md`, `LICENSE`, `package.json`만 허용한다.
- repository URL은 `https://github.com/kangjuhyup/nest-batch.git`과 일치해야 한다.
- 실제 npm publish, npm 설정 변경, Git tag push는 이 계획에서 실행하지 않는다.
- credential이나 `NPM_TOKEN`을 repository 또는 workflow에 저장하지 않는다.
- 로컬 bootstrap `0.1.0`은 provenance 예외이고 처음으로 OIDC publish되는 후속
  version부터 provenance를 필수로 확인한다.
- 모든 npm 조회와 publish는 `https://registry.npmjs.org/`를 명시한다.
- 테스트 설명은 `English / 한국어` 형식을 유지한다.

## File Structure

- `scripts/release/package-catalog.mjs`: 공개 package와 core subpath의 단일 목록
- `scripts/release/verify-release.mjs`: version, metadata, LICENSE, entrypoint 정적 검사
- `scripts/release/pack-packages.mjs`: 재사용 가능한 deterministic pack orchestration
- `scripts/release/smoke-packages.mjs`: tarball contents와 clean consumer 설치/compile 검사
- `scripts/release/sync-root-version.mjs`: Changesets version 이후 private root version 동기화
- `scripts/release/version-packages.mjs`: pending Changesets version과 idempotent root version 동기화
- `scripts/release/publish-packages.mjs`: tag 검증, registry 조회, integrity 비교, idempotent publish
- `scripts/release/*.test.ts`: pure validation/publish decision unit test
- `.changeset/config.json`: 8개 package fixed group과 `develop` base branch
- `.github/workflows/ci.yml`: Node compatibility와 DB/Redis E2E
- `.github/workflows/release-pr.yml`: Changesets Version PR
- `.github/workflows/publish.yml`: tag-gated OIDC publish와 GitHub Release
- `.github/release.yml`: generated release notes category
- `docs/releasing.md`: maintainer checklist와 최초 bootstrap manual gate
- `packages/*/{README.md,LICENSE,CHANGELOG.md}`: npm package page와 package별 변경 기록

---

### Task 1: Release catalog, version, 공통 metadata와 LICENSE

**Files:**
- Create: `scripts/release/package-catalog.mjs`
- Create: `scripts/release/verify-release.mjs`
- Test: `scripts/release/verify-release.test.ts`
- Create: `LICENSE`
- Create: `packages/{core,nest,inmemory,postgres,mysql,mariadb,bullmq,cli}/LICENSE`
- Modify: `package.json`
- Modify: `packages/{core,nest,inmemory,postgres,mysql,mariadb,bullmq,cli}/package.json`
- Modify: `packages/{core,nest,inmemory,postgres,mysql,mariadb,bullmq,cli}/tsconfig.json`
- Modify: `.gitignore`
- Modify: `vitest.config.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `PUBLIC_PACKAGES`, `CORE_SUBPATHS`, `readJson()`, `verifyReleaseRepository()`
- Produces: 8개 package의 version `0.1.0`과 npm public metadata

- [ ] **Step 1: package catalog와 manifest validator unit test 작성**

`scripts/release/verify-release.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CORE_SUBPATHS, PUBLIC_PACKAGES } from "./package-catalog.mjs";
import { validateManifest } from "./verify-release.mjs";

describe("release metadata validation / release metadata 검증", () => {
  it("defines exactly eight public packages / 공개 package를 정확히 8개 정의한다", () => {
    expect(PUBLIC_PACKAGES.map(({ name }) => name)).toEqual([
      "@nest-batch/core",
      "@nest-batch/nest",
      "@nest-batch/inmemory",
      "@nest-batch/postgres",
      "@nest-batch/mysql",
      "@nest-batch/mariadb",
      "@nest-batch/bullmq",
      "@nest-batch/cli"
    ]);
    expect(CORE_SUBPATHS).toEqual(["queue", "scheduler", "polling", "worker"]);
  });

  it("rejects missing public access / public access 누락을 거부한다", () => {
    expect(() => validateManifest({ name: "@nest-batch/core", version: "0.1.0" }, "packages/core"))
      .toThrow(/publishConfig\.access/);
  });
});
```

`vitest.config.ts`의 include에 `scripts/**/*.test.ts`를 추가한다.

- [ ] **Step 2: test가 module 부재로 실패하는지 확인**

Run: `pnpm exec vitest run --config vitest.config.ts scripts/release/verify-release.test.ts`

Expected: FAIL resolving `package-catalog.mjs`.

- [ ] **Step 3: package catalog 구현**

`scripts/release/package-catalog.mjs`:

```js
export const PUBLIC_PACKAGES = [
  { name: "@nest-batch/core", directory: "packages/core" },
  { name: "@nest-batch/nest", directory: "packages/nest" },
  { name: "@nest-batch/inmemory", directory: "packages/inmemory" },
  { name: "@nest-batch/postgres", directory: "packages/postgres" },
  { name: "@nest-batch/mysql", directory: "packages/mysql" },
  { name: "@nest-batch/mariadb", directory: "packages/mariadb" },
  { name: "@nest-batch/bullmq", directory: "packages/bullmq" },
  { name: "@nest-batch/cli", directory: "packages/cli" }
];

export const CORE_SUBPATHS = ["queue", "scheduler", "polling", "worker"];
export const REPOSITORY_URL = "https://github.com/kangjuhyup/nest-batch.git";
```

- [ ] **Step 4: pure manifest validation과 repository runner 구현**

`validateManifest(manifest, directory)`는 name/version/type/license/author/repository,
homepage, bugs, engines, files, publishConfig를 검사한다. version은 strict SemVer인지
검사하되 `0.1.0`을 상수로 고정하지 않는다. `verifyReleaseRepository(root)`는 root와
catalog의 manifest 및 LICENSE를 읽고 모든 package가 현재 root version과 같은지,
license text가 같은지 검사한다. direct execution은 오류를 stderr에 출력하고 exit
code 1을 설정한다.

필수 manifest shape:

```json
{
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "author": "kangjuhyup",
  "repository": {
    "type": "git",
    "url": "https://github.com/kangjuhyup/nest-batch.git",
    "directory": "packages/core"
  },
  "homepage": "https://github.com/kangjuhyup/nest-batch#readme",
  "bugs": {
    "url": "https://github.com/kangjuhyup/nest-batch/issues"
  },
  "engines": {
    "node": ">=20.18.0"
  },
  "files": ["dist", "src", "README.md", "LICENSE"],
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  }
}
```

각 package의 `description`과 `keywords`는 역할에 맞게 유지/보강하고
`repository.directory`만 실제 directory로 바꾼다. root package도 version `0.1.0`,
author/repository/homepage/bugs/engines를 가지되 `private: true`를 유지한다.

- [ ] **Step 5: MIT LICENSE와 build metadata 위치 변경**

root LICENSE와 8개 복제본의 내용:

```text
MIT License

Copyright (c) 2026 kangjuhyup

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

각 package tsconfig의 `tsBuildInfoFile`을 `.tsbuildinfo/tsconfig.tsbuildinfo`로 바꾸고
root `.gitignore`에 `.tsbuildinfo/`를 추가한다.

- [ ] **Step 6: package metadata에 대한 추가 failure case와 실제 repository 검사**

version mismatch, repository directory mismatch, non-public access, LICENSE mismatch를
각각 `it("... / ...")` test로 추가한다.

Run: `pnpm install && pnpm exec vitest run --config vitest.config.ts scripts/release/verify-release.test.ts && node scripts/release/verify-release.mjs`

Expected: tests와 실제 repository verification PASS.

- [ ] **Step 7: commit**

```bash
git add LICENSE .gitignore package.json pnpm-lock.yaml vitest.config.ts scripts/release packages/*/package.json packages/*/tsconfig.json packages/*/LICENSE
git commit -m "chore : 공개 package metadata와 라이선스 정비" -m "- 8개 package version과 npm 공개 metadata를 0.1.0 기준으로 통일
- MIT LICENSE와 release catalog 검증을 추가
- tsbuildinfo를 배포 산출물 밖으로 이동"
```

---

### Task 2: Package별 README와 공개 설치 문서

**Files:**
- Create: `packages/{core,nest,inmemory,postgres,mysql,mariadb,bullmq,cli}/README.md`
- Modify: `scripts/release/verify-release.mjs`
- Modify: `scripts/release/verify-release.test.ts`
- Modify: `README.md`
- Modify: `README-kr.md`

**Interfaces:**
- Consumes: Task 1의 catalog와 manifest metadata
- Produces: `verifyPackageDocuments(root, packageInfo): Promise<void>`
- Produces: npm package page에서 직접 읽을 수 있는 package별 설치/사용/운영 안내

- [ ] **Step 1: README 누락 검증 test 작성**

```ts
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PUBLIC_PACKAGES } from "./package-catalog.mjs";
import { verifyPackageDocuments } from "./verify-release.mjs";

it("rejects a package without a README / README가 없는 package를 거부한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "nest-batch-readme-test-"));
  const packageInfo = PUBLIC_PACKAGES[0];

  try {
    await mkdir(join(root, packageInfo.directory), { recursive: true });
    await expect(verifyPackageDocuments(root, packageInfo)).rejects.toThrow(/README\.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

fixture는 test의 temporary directory에 manifest와 LICENSE만 생성하고 test 종료 시
그 temporary directory만 제거한다.

- [ ] **Step 2: test 실패 확인 후 document validator 구현**

Run: `pnpm exec vitest run --config vitest.config.ts scripts/release/verify-release.test.ts`

Expected: FAIL because `verifyPackageDocuments` is missing.

README는 package name, `pnpm add <name>`, 실제 public import, repository link를 반드시
포함해야 한다. validator는 8개 package에 대해 이를 검사한다.

- [ ] **Step 3: 8개 package README 작성**

각 README의 첫 example은 다음 public API를 사용한다.

| Package | 첫 example |
| --- | --- |
| `core` | `defineJob`, `defineStep`, `DefaultBatchRunner`; 이어서 `core/queue`, `core/scheduler`, `core/polling`, `core/worker` 링크 |
| `nest` | `NestBatchModule.forRoot({ storage })`, `@BatchJob`, `@BatchStep` |
| `inmemory` | `new InMemoryBatchStorage()`와 non-durable 경고 |
| `postgres` | `new PostgresBatchStorage({ connectionString })`, `initialize()` |
| `mysql` | `new MySqlBatchStorage({ connectionString })` |
| `mariadb` | `new MariaDbBatchStorage({ connectionString })` |
| `bullmq` | `new BullMqWorkQueue({ queue, worker })`에서 실제 constructor option을 source와 대조 |
| `cli` | `runCli(args, context)`와 `nest-batch --help`; application이 storage/job registry를 공급해야 함을 명시 |

SQL/BullMQ example은 작성 전에 각 `options.ts`와 constructor signature를 읽고 실제
option 이름만 사용한다. 모든 README 하단에는 MIT license와 issue URL을 둔다.

- [ ] **Step 4: root README의 공개 설치와 지원 정책 보강**

영문/한국어 README에 다음을 같은 의미로 추가한다.

```text
Requirements: Node.js >=20.18.0, ESM
Initial release line: 0.x APIs can change before 1.0.0
Install: pnpm add @nest-batch/core
```

8개 공개 package와 네 core subpath를 구분해 나열하고 maintainer release 문서는 Task 7에서
추가할 링크 자리 없이 그때 한 번에 추가한다.

- [ ] **Step 5: document 검증과 example E2E 실행**

Run: `node scripts/release/verify-release.mjs && pnpm test:e2e:examples`

Expected: README validation과 example E2E PASS.

- [ ] **Step 6: commit**

```bash
git add README.md README-kr.md packages/*/README.md scripts/release
git commit -m "docs : 공개 package 설치 문서 추가" -m "- 8개 npm package별 설치와 최소 사용 예제를 작성
- Node 지원 범위와 0.x 호환성 정책을 명시"
```

---

### Task 3: Tarball 검사와 clean consumer smoke test

**Files:**
- Create: `scripts/release/pack-packages.mjs`
- Create: `scripts/release/smoke-packages.mjs`
- Test: `scripts/release/pack-packages.test.ts`
- Modify: `package.json`
- Modify: `scripts/release/verify-release.mjs`

**Interfaces:**
- Consumes: `PUBLIC_PACKAGES`, built `dist/`, package manifests
- Produces: `packPackages(destination): Promise<PackageArtifact[]>`
- Produces: `PackageArtifact { name, version, directory, tarball, files, integrity }`
- Produces: `validatePackedFiles(artifact): void`

- [ ] **Step 1: 허용/금지 tarball path에 대한 failing test 작성**

```ts
import { describe, expect, it } from "vitest";
import { validatePackedFiles } from "./pack-packages.mjs";

describe("package tarball validation / package tarball 검증", () => {
  it("rejects build metadata / build metadata 포함을 거부한다", () => {
    expect(() => validatePackedFiles({
      name: "@nest-batch/core",
      files: ["dist/index.js", "dist/.tsbuildinfo", "README.md", "LICENSE", "package.json"]
    })).toThrow(/tsbuildinfo/);
  });

  it("accepts release files / 배포 대상 파일만 허용한다", () => {
    expect(() => validatePackedFiles({
      name: "@nest-batch/core",
      files: ["dist/index.js", "dist/index.d.ts", "src/index.ts", "README.md", "LICENSE", "package.json"]
    })).not.toThrow();
  });
});
```

- [ ] **Step 2: test 실패 확인**

Run: `pnpm exec vitest run --config vitest.config.ts scripts/release/pack-packages.test.ts`

Expected: FAIL resolving `pack-packages.mjs`.

- [ ] **Step 3: reusable pack orchestration 구현**

`packPackages(destination)`은 catalog 순서대로 아래 명령을 실행하고 JSON을 parse한다.

```text
pnpm --dir <package.directory> pack --pack-destination <destination> --json
```

각 tarball bytes의 SHA-512를 계산해 npm integrity 형식
`sha512-<base64 digest>`로 저장한다. pack JSON의 file path가 다음 prefix/filename 외에
있으면 실패한다.

```text
dist/
src/
README.md
LICENSE
package.json
```

`.tsbuildinfo`, `test/`, `.env`, npmrc, key/certificate 확장자는 prefix와 무관하게
거부한다. core artifact는 root entrypoint와 네 subpath의 `.js`/`.d.ts`를 검사하고 CLI
artifact는 `dist/bin.js`를 검사한다.

- [ ] **Step 4: clean consumer smoke script 구현**

`smoke-packages.mjs`는 `mkdtemp`로 directory를 만들고 `finally`에서 해당 exact path만
`fs.rm({ recursive: true, force: true })`로 정리한다. 8개 tarball을 모두 direct
dependency로 `npm install --ignore-scripts --no-audit --no-fund`하고 다음 파일을 만든다.

`consumer.ts` 핵심 import:

```ts
import { DefaultBatchRunner, defineJob } from "@nest-batch/core";
import { WorkerLoop } from "@nest-batch/core/queue";
import { SchedulerLoop } from "@nest-batch/core/scheduler";
import { ContinuousPollingLoop } from "@nest-batch/core/polling";
import { LocalWorkerPool, WorkerThreadPool } from "@nest-batch/core/worker";
import { NestBatchModule } from "@nest-batch/nest";
import { InMemoryBatchStorage } from "@nest-batch/inmemory";
import { PostgresBatchStorage } from "@nest-batch/postgres";
import { MySqlBatchStorage } from "@nest-batch/mysql";
import { MariaDbBatchStorage } from "@nest-batch/mariadb";
import { BullMqWorkQueue } from "@nest-batch/bullmq";
import { runCli } from "@nest-batch/cli";

void [DefaultBatchRunner, defineJob, WorkerLoop, SchedulerLoop, ContinuousPollingLoop,
  LocalWorkerPool, WorkerThreadPool, NestBatchModule, InMemoryBatchStorage,
  PostgresBatchStorage, MySqlBatchStorage, MariaDbBatchStorage, BullMqWorkQueue, runCli];
```

root `node_modules/typescript/bin/tsc`를 사용해 temp consumer를 NodeNext/strict/noEmit으로
compile하고, 별도 `.mjs`에서 같은 package를 dynamic import한 뒤
`node_modules/.bin/nest-batch --help`가 exit 0인지 확인한다.

- [ ] **Step 5: root release scripts 연결**

`package.json` scripts:

```json
{
  "release:verify": "node scripts/release/verify-release.mjs",
  "release:smoke": "node scripts/release/smoke-packages.mjs",
  "release:check": "pnpm typecheck && pnpm test && pnpm build && pnpm release:verify && pnpm release:smoke"
}
```

- [ ] **Step 6: unit, pack, clean consumer 검증**

Run: `pnpm exec vitest run --config vitest.config.ts scripts/release && pnpm release:check`

Expected: 8개 tarball이 검증되고 consumer compile/import/CLI가 PASS. 실행 후 worktree에
`.tgz`, temp consumer, `.tsbuildinfo`가 남지 않는다.

- [ ] **Step 7: commit**

```bash
git add package.json scripts/release
git commit -m "chore : package tarball smoke test 추가" -m "- 배포 파일 allowlist와 core subpath 산출물을 검사
- clean consumer에서 타입 import runtime import CLI를 검증"
```

---

### Task 4: Changesets fixed version과 changelog 자동화

**Files:**
- Create: `.changeset/config.json`
- Create: `.changeset/README.md`
- Create: `scripts/release/sync-root-version.mjs`
- Test: `scripts/release/sync-root-version.test.ts`
- Create: `scripts/release/version-packages.mjs`
- Test: `scripts/release/version-packages.test.ts`
- Create: `packages/{core,nest,inmemory,postgres,mysql,mariadb,bullmq,cli}/CHANGELOG.md`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: 8개 package version과 `PUBLIC_PACKAGES`
- Produces: `syncRootVersion(root): Promise<string>`
- Produces: `versionPackages(root): Promise<string>`
- Produces: `pnpm changeset`, `pnpm release:version`

- [ ] **Step 1: root version sync failing test 작성**

```ts
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PUBLIC_PACKAGES } from "./package-catalog.mjs";
import { syncRootVersion } from "./sync-root-version.mjs";

const createVersionFixture = async (packageVersions: readonly string[]): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "nest-batch-version-test-"));
  await writeFile(join(root, "package.json"), '{"name":"fixture","private":true,"version":"0.1.0"}\n');

  await Promise.all(PUBLIC_PACKAGES.map(async (packageInfo, index) => {
    const directory = join(root, packageInfo.directory);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      `${JSON.stringify({ name: packageInfo.name, version: packageVersions[index] }, null, 2)}\n`
    );
  }));

  return root;
};

const readFixtureRootVersion = async (root: string): Promise<string> => {
  return JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
};

it("syncs the private root version / private root version을 공개 package와 동기화한다", async () => {
  const root = await createVersionFixture(PUBLIC_PACKAGES.map(() => "0.2.0"));
  try {
    await expect(syncRootVersion(root)).resolves.toBe("0.2.0");
    expect(await readFixtureRootVersion(root)).toBe("0.2.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects divergent package versions / 서로 다른 package version을 거부한다", async () => {
  const versions = PUBLIC_PACKAGES.map(() => "0.2.0");
  versions[versions.length - 1] = "0.2.1";
  const root = await createVersionFixture(versions);
  try {
    await expect(syncRootVersion(root)).rejects.toThrow(/fixed version/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: test 실패 확인 후 sync script 구현**

Run: `pnpm exec vitest run --config vitest.config.ts scripts/release/sync-root-version.test.ts`

Expected: FAIL resolving sync module.

`syncRootVersion`은 catalog package version이 하나인지 검사하고 root `package.json`의
version만 같은 값으로 갱신한다. JSON은 기존 2-space formatting과 trailing newline을
유지한다.

- [ ] **Step 3: Changesets dependency와 fixed config 추가**

`@changesets/cli` `3.0.1`을 root devDependency로 추가한다.

`.changeset/config.json`:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@4.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [[
    "@nest-batch/core",
    "@nest-batch/nest",
    "@nest-batch/inmemory",
    "@nest-batch/postgres",
    "@nest-batch/mysql",
    "@nest-batch/mariadb",
    "@nest-batch/bullmq",
    "@nest-batch/cli"
  ]],
  "linked": [],
  "access": "public",
  "baseBranch": "develop",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

`.changeset/README.md`에는 사용자 영향이 있는 PR은 `pnpm changeset`, package 산출물과
무관한 변경은 `pnpm changeset --empty`를 사용한다고 한국어로 설명한다.

- [ ] **Step 4: root scripts와 initial changelog 추가**

`package.json` scripts:

```json
{
  "changeset": "changeset",
  "release:version": "node scripts/release/version-packages.mjs"
}
```

각 package CHANGELOG는 다음 형식을 사용하고 package 역할에 맞는 첫 bullet을 쓴다.

```markdown
# @nest-batch/core

## 0.1.0

### Minor Changes

- Node-native durable batch runtime의 첫 공개 버전입니다.
```

- [ ] **Step 5: fixed group 계산을 temporary changeset으로 검증**

worktree 원본을 바꾸지 않도록 `mktemp -d`에 repository를 복사하고 아래 changeset을
그 복사본에만 만든다.

```markdown
---
"@nest-batch/core": minor
---

고정 버전 계산 검증
```

복사본에서 `pnpm changeset version`을 실행하고 8개 manifest가 모두 `0.2.0`인지
검사한다. 원본에서는 sync unit test와 `pnpm release:verify`를 실행한다.

- [ ] **Step 6: commit**

```bash
git add .changeset package.json pnpm-lock.yaml scripts/release packages/*/CHANGELOG.md
git commit -m "chore : Changesets 고정 버전 관리 추가" -m "- 8개 공개 package를 fixed group으로 구성
- package changelog와 root version 동기화를 추가"
```

---

### Task 5: Tag 검증과 idempotent npm publish script

**Files:**
- Create: `scripts/release/publish-packages.mjs`
- Test: `scripts/release/publish-packages.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `PackageArtifact[]` from `packPackages()`
- Produces: `parseReleaseTag(tag, expectedVersion): string`
- Produces: `decidePublication(localIntegrity, remoteIntegrity?: string): "publish" | "skip"`
- Produces: `publishRelease(options): Promise<{ published: string[], skipped: string[] }>`

- [ ] **Step 1: tag와 partial publish decision test 작성**

```ts
describe("idempotent package publishing / 멱등 package 배포", () => {
  it("rejects a tag version mismatch / tag와 package version 불일치를 거부한다", () => {
    expect(() => parseReleaseTag("v0.2.0", "0.1.0")).toThrow(/does not match/);
  });

  it("skips the same published tarball / 같은 tarball이 이미 배포되면 건너뛴다", () => {
    expect(decidePublication("sha512-same", "sha512-same")).toBe("skip");
  });

  it("rejects an occupied version with different integrity / 다른 tarball의 같은 version을 거부한다", () => {
    expect(() => decidePublication("sha512-local", "sha512-remote")).toThrow(/integrity/);
  });
});
```

- [ ] **Step 2: test 실패 확인**

Run: `pnpm exec vitest run --config vitest.config.ts scripts/release/publish-packages.test.ts`

Expected: FAIL resolving publish module.

- [ ] **Step 3: pure tag/integrity decision 구현**

허용 tag는 `v` + strict SemVer `major.minor.patch`다. prerelease/build suffix는 이 최초
workflow에서 거부한다. tag, root version, 8개 artifact version이 모두 같아야 한다.
remote integrity가 없으면 publish, local과 같으면 skip, 다르면 error를 반환한다.

- [ ] **Step 4: registry adapter와 publish orchestration 구현**

기본 adapter가 실행할 명령:

```text
npm view <name>@<version> dist.integrity --json --registry https://registry.npmjs.org/ --@nest-batch:registry=https://registry.npmjs.org/
npm publish <tarball> --access public --registry https://registry.npmjs.org/ --@nest-batch:registry=https://registry.npmjs.org/
```

`npm view`의 404만 unpublished로 처리하고 network/auth 오류는 실패시킨다.
generic registry와 `@nest-batch` scope registry를 모두 CLI에서 고정하여 ambient
`.npmrc`의 hostile scope mapping이 lookup/publish destination을 바꾸지 못하게 한다.
`publishRelease`는 catalog 순서로 publish/skip하고, 완료 후 최대 6회·5초 간격으로 8개
remote integrity를 재조회한다. test에서는 lookup/publish/sleep을 주입해 실제 registry를
호출하지 않고 `missing -> publish`, `same -> skip`, `different -> fail`, partial retry를
모두 검증한다.

- [ ] **Step 5: CLI entry와 root script 연결**

tag는 `--tag v0.1.0` 또는 `GITHUB_REF_NAME`에서 읽으며 둘 다 없으면 실패한다.

```json
{
  "release:publish": "node scripts/release/publish-packages.mjs"
}
```

로컬 bootstrap 명령은 `pnpm run release:publish --tag v0.1.0`이다. 이 명령은 test에서
mock adapter로만 검증하고 실제로 실행하지 않는다.

- [ ] **Step 6: publish unit test와 전체 release check 실행**

Run: `pnpm exec vitest run --config vitest.config.ts scripts/release/publish-packages.test.ts && pnpm release:check`

Expected: unit test와 release check PASS, npm registry 변경 없음.

- [ ] **Step 7: commit**

```bash
git add package.json scripts/release
git commit -m "chore : 멱등 npm publish script 추가" -m "- tag와 package version 일치를 publish 전에 검증
- 동일 integrity는 건너뛰고 부분 배포를 안전하게 재실행"
```

---

### Task 6: CI, Version PR, OIDC publish와 GitHub Release workflow

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release-pr.yml`
- Create: `.github/workflows/publish.yml`
- Create: `.github/release.yml`
- Create: `scripts/release/verify-workflows.mjs`
- Test: `scripts/release/verify-workflows.test.ts`
- Modify: `scripts/release/verify-release.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `pnpm release:check`, `pnpm release:version`, `pnpm release:publish`
- Produces: PR 검증, Changesets Version PR, tag-gated npm publish, generated GitHub Release
- Produces: `verifyWorkflowFiles(root): Promise<void>`

- [ ] **Step 1: CI workflow 작성**

모든 action은 아래 exact commit SHA로 pin한다.

```text
actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803        # v6
actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38      # v6
pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86       # v6.0.10
changesets/action@8488615a623b1b9c987934bb89eae8af6a946ac1         # v2.1.1
```

`ci.yml`은 `pull_request`와 `develop` push에 실행한다. `quality` job은 Node
`20.18.3`, `24` matrix에서 install/typecheck/unit/build를 실행하고 Node 24에서만
release verify/smoke를 실행한다. `e2e` job은 Node 24와 아래 service를 사용한다.

```yaml
services:
  postgres:
    image: postgres:16-alpine
    env:
      POSTGRES_DB: nest_batch
      POSTGRES_USER: nest_batch
      POSTGRES_PASSWORD: nest_batch
    ports: [15432:5432]
    options: >-
      --health-cmd "pg_isready -U nest_batch -d nest_batch"
      --health-interval 5s --health-timeout 5s --health-retries 12
  mysql:
    image: mysql:8.4
    env:
      MYSQL_DATABASE: nest_batch
      MYSQL_USER: nest_batch
      MYSQL_PASSWORD: nest_batch
      MYSQL_ROOT_PASSWORD: nest_batch_root
    ports: [13306:3306]
    options: >-
      --health-cmd "mysqladmin ping -h 127.0.0.1 -unest_batch -pnest_batch --silent"
      --health-interval 5s --health-timeout 5s --health-retries 20
  mariadb:
    image: mariadb:11.4
    env:
      MARIADB_DATABASE: nest_batch
      MARIADB_USER: nest_batch
      MARIADB_PASSWORD: nest_batch
      MARIADB_ROOT_PASSWORD: nest_batch_root
    ports: [13307:3306]
    options: >-
      --health-cmd "mariadb-admin ping -h 127.0.0.1 -unest_batch -pnest_batch --silent"
      --health-interval 5s --health-timeout 5s --health-retries 20
  redis:
    image: redis:7-alpine
    ports: [16379:6379]
    options: >-
      --health-cmd "redis-cli ping" --health-interval 5s
      --health-timeout 5s --health-retries 12
```

E2E step은 `pnpm test:e2e`를 실행한다.

- [ ] **Step 2: Changesets Version PR workflow 작성**

`release-pr.yml`은 `develop` push에서 `contents: write`, `pull-requests: write`만 갖는다.
frozen install 후 official root `changesets/action@8488615a623b1b9c987934bb89eae8af6a946ac1`
(`v2.1.1` commit)을 사용한다. 2026-09-04 upstream `action.yml` 검증에서 root action의
공식 입력은 `version-script`, `commit-message`, `pr-title`, `pr-base-branch`,
`create-github-releases`, `push-git-tags`이고 공식 output은 `pr-number`임을 확인했다.
`GITHUB_TOKEN: ${{ github.token }}`을 제공한다. upstream implementation은 pending changeset이
없거나 changeset이 모두 empty이면 publish script 없이 no-op으로 반환하므로, root action에서
`create-github-releases: false`, `push-git-tags: false`를 명시해 Version PR만 관리한다.
`pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86`의 공식 metadata는 기본
`package_json_file: package.json`에서 `packageManager` pin을 읽어 설치한다.

```yaml
uses: changesets/action@8488615a623b1b9c987934bb89eae8af6a946ac1
env:
  GITHUB_TOKEN: ${{ github.token }}
with:
  version-script: pnpm release:version
  commit-message: "chore : package version 업데이트"
  pr-title: "chore : package version 업데이트"
  pr-base-branch: develop
  create-github-releases: false
  push-git-tags: false
```

action output `pr-number`가 있으면 `gh label create release --force` 후 해당 PR에
`release` label을 붙인다. step은 repository `GITHUB_TOKEN`만 사용한다.

- [ ] **Step 3: tag-gated publish workflow 작성**

`publish.yml` trigger와 job 경계:

```yaml
on:
  push:
    tags:
      - "v*.*.*"

jobs:
  publish:
    environment: npm
    permissions:
      contents: read
      id-token: write
  github-release:
    needs: publish
    permissions:
      contents: write
```

publish job은 cache 없이 Node 24를 설정하고 `npm install --global npm@12.0.2`, frozen
pnpm install, `pnpm release:check`, `pnpm run release:publish --tag "$GITHUB_REF_NAME"`을
실행한다. `NODE_AUTH_TOKEN`이나 npm secret을 설정하지 않는다.

GitHub Release job은 tag source를 checkout하고 `HEAD`와 tag ref가 모두
`GITHUB_SHA`로 resolve되는지 검사한 뒤 explicit repository의 release-by-tag API를
`gh api --include`로 조회한다. HTTP 404가 확인된 경우에만 아래 create 명령을 실행한다.
기존 release는 exact tag, non-draft, non-prerelease를 검증하고 건너뛴다.
`target_commitish`가 40자리 SHA이면 workflow SHA와 일치해야 하며, branch 이름이면
검증된 tag ref를 authoritative source로 삼는다. 인증/network/기타 조회 실패는 그대로
실패시켜 create를 실행하지 않는다.

```bash
gh release create "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" --verify-tag --generate-notes --title "$GITHUB_REF_NAME"
```

`GH_TOKEN: ${{ github.token }}`만 환경에 제공한다.

- [ ] **Step 4: generated release notes category 작성**

`.github/release.yml`:

```yaml
changelog:
  exclude:
    labels:
      - release
  categories:
    - title: Features
      labels: [feature, enhancement]
    - title: Fixes
      labels: [bug, fix]
    - title: Documentation
      labels: [documentation]
    - title: Dependencies
      labels: [dependencies]
    - title: Maintenance
      labels: [chore, refactor]
    - title: Other Changes
      labels: ["*"]
```

- [ ] **Step 5: workflow syntax와 보안 설정 자동 검증**

root devDependency에 `yaml@2.9.0`을 추가한다. `verifyWorkflowFiles(root)`는 YAML 1.2로
세 workflow와 release config를 parse하고 duplicate key, anchor, alias를 거부한다. 승인된
workflow의 root/job permission, trigger, job/step 순서, action owner/SHA allowlist, YAML parser가
보존한 `run` scalar와 block scalar의 마지막 줄바꿈, cache, Node matrix, Node 24 release-only
condition, E2E service image/env/port/healthcheck, release category를 전체 exact schema로 비교한다.
`release:check` 뒤에만 publish를
허용하며 `always()`·`continue-on-error`·추가 privileged job을 거부한다.

```text
publish trigger: v*.*.*
publish environment: npm
publish permission: id-token write, contents read
github-release permission: contents write, id-token 없음
금지 설정: secrets.*, NPM_TOKEN, NODE_AUTH_TOKEN, registry auth/.npmrc
모든 uses 값: 검토한 owner/action의 exact 40자리 commit SHA
필수 command: release:check, pnpm run release:publish --tag "$GITHUB_REF_NAME",
  node scripts/release/create-github-release.mjs
```

`verify-workflows.test.ts`는 exact valid workflow가 통과하고 trigger, permission, root action
input, cache, command 순서, GitHub Release tag checkout, service, release category,
secret/registry auth, YAML type/duplicate/
anchor/alias 및 shell-significant Unicode whitespace/마지막 줄바꿈 변이가 각각 실패하는
`English / 한국어` mutation test를 작성한다.
`verify-release.mjs`의 repository runner가 `verifyWorkflowFiles`를 호출하게 한다.

- [ ] **Step 6: workflow 정적 점검**

Run:

```bash
pnpm install
pnpm exec vitest run --config vitest.config.ts scripts/release/verify-workflows.test.ts
node scripts/release/verify-release.mjs
rg -n 'NPM_TOKEN|NODE_AUTH_TOKEN|secrets\.|registry-url|always-auth|_auth' .github/workflows
rg -n 'id-token: write|environment: npm|release:check|pnpm run release:publish --tag|--repo "\$GITHUB_REPOSITORY"' .github/workflows/publish.yml
git diff --check
```

Expected: token 검색 0건. publish workflow 검색은 네 필수 설정을 출력한다. YAML
indentation과 shell quoting을 직접 재검토한다.

- [ ] **Step 7: commit**

```bash
git add .github package.json pnpm-lock.yaml scripts/release
git commit -m "chore : package release workflow 추가" -m "- Node 호환성과 database queue E2E를 CI에서 검증
- Changesets Version PR과 tag 기반 OIDC publish를 구성
- npm 배포 후 GitHub release note를 자동 생성"
```

---

### Task 7: 공개 배포 checklist와 최종 검증

**Files:**
- Create: `docs/releasing.md`
- Create: `.github/pull_request_template.md`
- Modify: `README.md`
- Modify: `README-kr.md`
- Modify: `scripts/release/verify-release.mjs`

**Interfaces:**
- Consumes: Tasks 1–6의 command와 manual npm/GitHub 설정
- Produces: contributor Changeset flow와 maintainer bootstrap/release/recovery checklist

- [ ] **Step 1: `docs/releasing.md` checklist 작성**

문서는 아래 순서와 checkbox를 그대로 갖고 각 항목에 실행 명령 또는 UI 값을 쓴다.

```markdown
## 1. Release candidate 준비
- [ ] worktree가 clean이고 release commit이 `develop`에 포함됨
- [ ] 8개 package와 root version이 동일함
- [ ] `pnpm release:check` 성공
- [ ] `pnpm test:e2e` 성공

## 2. 최초 0.1.0 bootstrap
- [ ] npm에서 `@nest-batch` scope 권한 확인
- [ ] `npm whoami`와 2FA 상태 확인
- [ ] `pnpm run release:publish --tag v0.1.0`을 maintainer가 직접 실행
- [ ] 8개 package의 `0.1.0`과 integrity 확인

## 3. Trusted Publisher 등록
- [ ] owner `kangjuhyup`, repository `nest-batch`, workflow `publish.yml`, environment `npm` 등록
- [ ] 8개 package 모두 Allowed action `npm publish` 설정
- [ ] GitHub `npm` environment와 required reviewer 설정
- [ ] npm token publish 제한 설정

## 4. Tag release
- [ ] `git tag -s vX.Y.Z <release-commit>`
- [ ] `git push origin vX.Y.Z`
- [ ] publish workflow 성공 확인
- [ ] npm provenance와 GitHub generated release notes 확인
  - 로컬 bootstrap `0.1.0`은 provenance 예외로 두고, 처음으로 OIDC publish되는 후속
    version부터 provenance를 필수로 확인한다.

## 5. 실패 복구
- [ ] 같은 tag workflow 재실행으로 동일 integrity package를 skip
- [ ] integrity가 다르면 즉시 중단하고 원인 조사
- [ ] publish된 version은 덮어쓰지 않고 필요 시 다음 patch version 준비
```

실제 publish와 tag 명령에는 `Manual gate` 경고를 붙이고 이 구현 작업 중 실행하지
않는다고 명시한다.

- [ ] **Step 2: contributor Changeset 안내 추가**

PR template:

```markdown
## 변경 사항

## 검증

- [ ] 관련 test를 실행했습니다.
- [ ] 사용자에게 보이는 package 변경이면 `pnpm changeset`을 추가했습니다.
- [ ] package 산출물과 무관한 변경이면 `pnpm changeset --empty` 또는 생략 이유를 적었습니다.
```

root README/README-kr의 Development section에는 `pnpm changeset`과
`docs/releasing.md` 링크를 추가한다.

- [ ] **Step 3: checklist와 catalog 일치 검증 추가**

`verify-release.mjs`는 `docs/releasing.md`에 8개 package name, `publish.yml`, `npm`
environment, `pnpm release:check`, bootstrap command가 있는지 확인한다. 문서가 workflow
filename이나 package catalog와 달라지면 release check가 실패해야 한다.

- [ ] **Step 4: 전체 local verification**

Run:

```bash
pnpm install --frozen-lockfile
pnpm release:check
pnpm test:e2e
rg -n '@nest-batch/(queue-core|scheduler-core|scheduler-calendar|polling-core|worker-local|worker-threads|queue-bullmq)' --glob '!docs/superpowers/**'
git diff --check
git status --short
```

Expected: install/release check/E2E PASS, old package import 0건, diff check PASS. status에는
Task 7에서 의도한 문서와 validator 변경만 나타난다.

- [ ] **Step 5: npm registry read-only availability audit**

각 catalog name에 `npm view <name> version --json --registry https://registry.npmjs.org/ --@nest-batch:registry=https://registry.npmjs.org/`을 실행한다. 404는 최초 bootstrap
대상으로 checklist에 기록하고, 이미 존재하면 owner/version을 확인하되 publish나 access
변경은 하지 않는다.

- [ ] **Step 6: commit**

```bash
git add docs/releasing.md .github/pull_request_template.md README.md README-kr.md scripts/release/verify-release.mjs
git commit -m "docs : 공개 배포 checklist 추가" -m "- 최초 npm bootstrap과 Trusted Publisher 등록 절차를 정리
- tag release와 부분 배포 실패 복구 방법을 문서화
- contributor Changeset 확인 항목을 추가"
```

- [ ] **Step 7: 최종 branch verification과 handoff**

Run: `pnpm release:check && pnpm test:e2e && git status --short && git log --oneline -10`

Expected: 모든 검증 PASS, worktree clean. 사용자에게 실제 publish가 수행되지 않았고
`docs/releasing.md`의 manual gate부터 maintainer가 진행해야 함을 보고한다.
