# npm package scope 변경 설계

## 배경

공개 배포 준비가 끝난 8개 package는 현재 `@nest-batch/*` 이름을 사용한다. 그러나
2026-09-04 public npm registry read-only audit에서 `@nest-batch/core`,
`@nest-batch/mysql`, `@nest-batch/bullmq`가 다른 maintainer와 repository identity로
이미 배포된 package임을 확인했다. 기존 scope를 유지하면 이 repository의 `0.1.0`을
일관된 package 집합으로 bootstrap할 수 없다.

사용자가 새 scope로 `@rv-nest-batch`를 선택했다. 2026-09-05에 canonical public npm
registry와 exact scoped registry override를 사용해 8개 후보 이름을 조회한 결과는 모두
`E404`였다. `E404`는 package가 공개 조회되지 않는다는 뜻일 뿐 scope publish 권한의
증거는 아니므로, 실제 publish 전 ownership 확인은 계속 수동 gate로 둔다.

## 목표

- 공개 package 8개의 scope를 `@rv-nest-batch`로 원자적으로 변경한다.
- package suffix, directory, 책임과 dependency 방향은 유지한다.
- source, test, example, public docs, release automation과 lockfile이 하나의 package
  identity를 사용하게 한다.
- 기존 `@nest-batch/*` active reference가 release gate를 통과하지 못하게 한다.
- 새 이름으로도 `0.1.0` fixed-version release, deterministic pack, clean consumer smoke,
  Changesets release notes와 OIDC publish 계약을 유지한다.

## 비목표

- 8개 package를 다시 합치거나 package directory를 변경하지 않는다.
- runtime API, type, job/step 동작 또는 adapter 구현을 변경하지 않는다.
- 기존 `@nest-batch/*` 이름으로 compatibility wrapper나 alias package를 배포하지 않는다.
- root private package 이름 `nest-batch`와 GitHub repository 이름을 변경하지 않는다.
- 이 작업에서 npm organization 생성, ownership 변경, Trusted Publisher 등록, 실제 npm
  publish 또는 Git tag push를 수행하지 않는다.

## package mapping

| 현재 이름 | 새 공개 이름 | directory |
| --- | --- | --- |
| `@nest-batch/core` | `@rv-nest-batch/core` | `packages/core` |
| `@nest-batch/nest` | `@rv-nest-batch/nest` | `packages/nest` |
| `@nest-batch/inmemory` | `@rv-nest-batch/inmemory` | `packages/inmemory` |
| `@nest-batch/postgres` | `@rv-nest-batch/postgres` | `packages/postgres` |
| `@nest-batch/mysql` | `@rv-nest-batch/mysql` | `packages/mysql` |
| `@nest-batch/mariadb` | `@rv-nest-batch/mariadb` | `packages/mariadb` |
| `@nest-batch/bullmq` | `@rv-nest-batch/bullmq` | `packages/bullmq` |
| `@nest-batch/cli` | `@rv-nest-batch/cli` | `packages/cli` |

`core`의 공개 subpath는 다음과 같이 suffix와 module 경계를 그대로 유지한다.

- `@rv-nest-batch/core/queue`
- `@rv-nest-batch/core/scheduler`
- `@rv-nest-batch/core/polling`
- `@rv-nest-batch/core/worker`

## 설계

### package 경계와 의존성

directory와 책임은 바꾸지 않는다. `core`는 framework-independent 상태를 유지하고,
`nest`, storage adapter, BullMQ adapter와 CLI가 새 이름의 `core`에만 의존한다. source
manifest의 내부 dependency는 계속 exact `workspace:*`를 사용하며, packed manifest에서는
현재 fixed version인 exact `0.1.0`으로 치환되어야 한다.

package catalog를 새 scope의 단일 source of truth로 갱신한다. npm scope registry argument도
별도 hard-coded 문자열이 아니라 catalog의 canonical scope에서 파생해 lookup, publish,
identity audit와 confirmation이 모두 다음 두 값을 명시하게 한다.

- `--registry https://registry.npmjs.org/`
- `--@rv-nest-batch:registry=https://registry.npmjs.org/`

### active reference migration

다음 active surface의 package name과 import를 모두 새 scope로 변경한다.

- 8개 `package.json`, `.changeset/config.json`, `pnpm-lock.yaml`
- package source와 test, root E2E, example source/test/package manifest
- root README, Korean README, architecture/database/reader/release 운영 문서
- 8개 package README와 아직 공개되지 않은 `0.1.0` changelog
- TypeScript path mapping과 Vitest alias/config
- release catalog, pack/publish/smoke/verify script와 관련 test fixture
- 현재 공개 배포 설계와 구현 계획

과거 날짜의 `docs/superpowers/plans/`와 `docs/superpowers/specs/` 문서는 당시 설계 기록으로
남길 수 있다. 다만 2026-09 공개 배포 계획·설계와 이 설계는 최종 package identity인
`@rv-nest-batch/*`를 사용한다. 사용자에게 노출되거나 빌드·테스트·release에 참여하는 active
tree에서는 `@nest-batch/` reference를 허용하지 않는다.

### tombstone invariant

기존의 개별 legacy package 이름 검사에 더해, active tree의 모든 `@nest-batch/` prefix를
legacy namespace로 취급한다. generated/vendor directory와 명시적으로 보존한 historical
spec/plan만 제외하고 source, test, example, workflow, root/package manifest, lockfile,
README와 운영 문서에서 한 건이라도 발견되면 `release:verify`가 실패한다.

검증기는 새 catalog 이름과 다음 구조가 exact equality인지 계속 확인한다.

- Changesets fixed group
- root TypeScript package references
- source `workspace:*` internal dependency
- packed/installed exact fixed-version dependency
- `main`, `types`, `exports`, CLI `bin`과 tarball entrypoint

### 문서와 release automation

설치 및 import 예제는 모두 `@rv-nest-batch/*`를 사용한다. release checklist의 8개 identity
audit, bootstrap integrity confirmation,
`npm whoami --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/`,
`npm profile get --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/`는 새 scoped registry
override를 명시한다. Trusted Publisher는 새 package 8개 각각에 등록하도록 설명한다.

최초 `0.1.0`은 검토된 package-release-readiness merge commit을 release candidate로 삼는
일회성 예외이며 새 Changeset이나 Version PR을 만들지 않는다. 이후 모든 release에는
Changesets Version PR, Node 20/24 CI, merge와 local release gate를 적용한다. 첫
post-bootstrap Version PR 전에는 maintainer가 GitHub의 **Allow GitHub Actions to create
and approve pull requests** 설정을 수동 활성화해야 하며, 2026-09-05 read-only audit의
`can_approve_pull_request_reviews=false` 상태를 PAT로 우회하지 않는다. signed tag, OIDC
publish, GitHub Release, bootstrap `0.1.0` provenance 예외와 이후 version provenance
요구는 기존 계약을 유지한다.

## 실패와 안전 경계

- 새 package 이름 중 하나라도 public registry에 나타나거나 승인되지 않은 identity가
  확인되면 bootstrap을 중단한다.
- `rv-nest-batch` scope ownership과 publish 권한을 확인하기 전에는 `release:publish`를
  실행하지 않는다.
- rename 뒤 old/new 이름이 섞이면 source dependency, pack metadata, consumer import 또는
  tombstone invariant에서 실패해야 한다.
- package version은 `0.1.0`을 유지하고 rename 때문에 별도 version bump를 만들지 않는다.
- 실제 npm publish, Git tag/push, GitHub Release와 repository/npm 설정 변경은 maintainer
  manual gate로 남긴다.

## 테스트와 검증

구현은 다음 순서로 검증한다.

1. 새 catalog가 정확한 8개 이름과 scope registry argument를 생성하는 unit test
2. old scope가 source, E2E, root 문서, package manifest 또는 lockfile에 다시 들어오면
   실패하는 mutation test
3. source/packed/installed package identity와 내부 dependency가 새 scope로 일치하는 test
4. 새 package 이름과 core subpath를 사용하는 clean consumer type/runtime/CLI smoke
5. release guide의 8개 audit, integrity confirmation, Trusted Publisher와 scope ownership
   gate를 검사하는 mutation test
6. Node 24 frozen install, `release:check`, `test:e2e`
7. Node 20.18.3 `release:check`
8. active tree old-scope scan, `git diff --check`, tracked credential/artifact scan

최종 package 이름이 실제 npm registry에서 비어 있는지는 구현 후 다시 read-only로 확인한다.
이 조회 결과와 무관하게 scope ownership은 maintainer가 npm에서 직접 확인해야 한다.
