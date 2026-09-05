# `@rvkang` 공통 package scope 변경 설계

## 배경

`nest-batch`의 공개 배포 준비는 현재 `@rv-nest-batch/*` scope를 기준으로 완료되어 있다.
그러나 npm에 `rv-nest-batch` organization이 없고, 사용자는 `Rv-log`를 비롯한 다른 공개
package도 하나의 organization에서 관리하려 한다. 특정 제품 이름을 organization scope에
넣으면 새 제품마다 별도 scope가 필요하므로 공통 브랜드를 `rvkang`으로 정한다.

`@rvkang` 아래에서 `core`, `nest`, `postgres`처럼 일반적인 이름을 바로 사용하면 다른 제품군과
충돌한다. 따라서 nest-batch package는 `batch-` family prefix를 사용한다. directory와 runtime
책임은 그대로 유지하고 공개 package identity만 원자적으로 변경한다.

## 목표

- 공개 package 8개를 `@rvkang/batch-*` 이름으로 변경한다.
- `@rvkang`을 `batch`, `log` 등 여러 제품군이 공유할 수 있는 npm organization scope로 둔다.
- 기존 package directory, runtime contract, adapter 경계와 dependency 방향을 유지한다.
- source, test, example, 문서, Changesets, lockfile과 release automation이 동일한 새 identity를
  사용하게 한다.
- 이전 `@rv-nest-batch/*`와 그보다 앞선 `@nest-batch/*` reference가 active release surface에
  다시 들어오지 못하게 한다.
- version은 `0.1.0`을 유지하고 최초 bootstrap 및 후속 OIDC release 계약을 보존한다.

## 비목표

- package를 합치거나 directory를 변경하지 않는다.
- runtime API, type, 실행 의미, checkpoint/restart 또는 adapter 구현을 변경하지 않는다.
- `Rv-log` package를 이 저장소에서 설계하거나 구현하지 않는다.
- 이전 scope의 compatibility alias package를 배포하지 않는다.
- root private package 이름 `nest-batch`와 GitHub repository 이름 `nest-batch`를 변경하지 않는다.
- npm organization 생성, 실제 publish, Trusted Publisher 등록, Git tag 생성·push를 자동 실행하지
  않는다.

## package mapping

| 현재 이름 | 새 공개 이름 | directory |
| --- | --- | --- |
| `@rv-nest-batch/core` | `@rvkang/batch-core` | `packages/core` |
| `@rv-nest-batch/nest` | `@rvkang/batch-nest` | `packages/nest` |
| `@rv-nest-batch/inmemory` | `@rvkang/batch-inmemory` | `packages/inmemory` |
| `@rv-nest-batch/postgres` | `@rvkang/batch-postgres` | `packages/postgres` |
| `@rv-nest-batch/mysql` | `@rvkang/batch-mysql` | `packages/mysql` |
| `@rv-nest-batch/mariadb` | `@rvkang/batch-mariadb` | `packages/mariadb` |
| `@rv-nest-batch/bullmq` | `@rvkang/batch-bullmq` | `packages/bullmq` |
| `@rv-nest-batch/cli` | `@rvkang/batch-cli` | `packages/cli` |

`core` subpath도 package identity만 바꾼다.

- `@rvkang/batch-core/queue`
- `@rvkang/batch-core/scheduler`
- `@rvkang/batch-core/polling`
- `@rvkang/batch-core/worker`

향후 다른 저장소의 log 제품군은 `@rvkang/log`, 필요하면 `@rvkang/log-nest`처럼 독립적인
family name을 사용한다. 이 naming convention은 이번 저장소의 구현 범위에는 포함하지 않는다.

## 설계

### package 경계와 dependency

`packages/core`는 계속 NestJS와 database client에 의존하지 않는다. `nest`, database adapter,
BullMQ adapter와 CLI는 새 `@rvkang/batch-core`에 의존한다. source manifest의 내부 dependency는
exact `workspace:*`를 유지하고 packed manifest에서는 fixed version `0.1.0`으로 치환되어야 한다.

release package catalog를 새 identity의 단일 source of truth로 갱신한다. scope registry override는
다음 값을 모든 lookup과 publish에 명시한다.

- `--registry https://registry.npmjs.org/`
- `--@rvkang:registry=https://registry.npmjs.org/`

### active reference migration

다음 active surface를 모두 새 package 이름으로 변경한다.

- 8개 package manifest, root manifest, `.changeset/config.json`, `pnpm-lock.yaml`
- package source와 test, root E2E, examples
- TypeScript path mapping, Vitest alias와 build/test fixture
- root README/README-kr, package README, 운영 문서와 아직 공개되지 않은 `0.1.0` changelog
- release catalog, verify, pack, smoke, publish script와 관련 test
- 현재 유효한 공개 배포 spec과 plan

과거 날짜의 spec과 plan은 당시 결정을 설명하는 history로 보존할 수 있다. 다만 build, test,
pack, publish와 사용자 문서에 참여하는 active tree에는 이전 scope를 허용하지 않는다.

### legacy namespace 차단

release verifier는 다음 두 prefix를 active tree의 legacy namespace로 취급한다.

- `@nest-batch/`
- `@rv-nest-batch/`

명시적으로 제외한 historical spec/plan 외 source, manifest, lockfile, example, test, README,
workflow와 운영 문서에서 legacy prefix가 발견되면 release 검증을 실패시킨다. 새 catalog와
Changesets fixed group, TypeScript reference, source/packed internal dependency, tarball entrypoint는
exact equality로 검증한다.

### 문서와 release automation

설치 및 import 예제는 모두 `@rvkang/batch-*`를 사용한다. release checklist의 8개 identity
audit와 integrity confirmation, npm account 확인 명령에는 canonical public registry와
`--@rvkang:registry=https://registry.npmjs.org/`를 명시한다.

Trusted Publisher는 새 package 8개 각각에 GitHub owner `kangjuhyup`, repository `nest-batch`,
workflow `publish.yml`, environment `npm`, Allowed action `npm publish`로 등록한다. GitHub workflow의
OIDC permission과 environment gate는 변경하지 않는다.

최초 `0.1.0`은 이 변경까지 검토된 package-release-readiness merge commit을 release candidate로
사용하는 일회성 bootstrap 예외를 유지한다. 이후 version은 Changesets Version PR, Node 20/24 CI,
signed tag, OIDC publish와 provenance 요구를 그대로 적용한다.

## 실패와 안전 경계

- npm에서 `rvkang` organization 생성과 maintainer publish 권한을 확인하기 전에는 publish하지
  않는다.
- 새 package 8개 중 하나라도 승인되지 않은 owner/repository identity로 존재하면 중단한다.
- rename 뒤 old/new identity가 섞이면 release verification, pack 또는 consumer smoke가 실패해야
  한다.
- 실제 npm publish, repository 설정 변경, Trusted Publisher 등록과 tag push는 maintainer의
  manual gate로 남긴다.
- 이미 publish된 version과 local tarball integrity가 다르면 덮어쓰거나 강행하지 않고 다음
  patch version을 준비한다.

## 테스트와 검증

1. package catalog가 정확한 8개 `@rvkang/batch-*` 이름과 scope registry argument를 생성한다.
2. `@nest-batch/*`와 `@rv-nest-batch/*`가 active source, manifest, lockfile 또는 문서에 들어오면
   mutation test가 실패한다.
3. source, packed, installed package identity와 exact internal dependency를 검증한다.
4. 새 package 이름과 core subpath를 사용해 type/runtime/CLI consumer smoke를 실행한다.
5. release guide의 identity audit, integrity 확인, scope ownership과 Trusted Publisher 계약을
   mutation test로 검증한다.
6. Node 24에서 frozen install, `release:check`, E2E를 실행한다.
7. Node 20.18.3에서 `CI=1 release:check`를 실행한다.
8. `git diff --check`, active legacy-scope scan과 tracked credential/artifact scan을 실행한다.

최종 이름 가용성은 canonical npm registry에서 8개 package를 다시 조회한다. `E404`는 package가
공개 조회되지 않는다는 뜻일 뿐 scope ownership 증거가 아니므로 npm web UI의 organization
ownership 확인을 별도 manual gate로 유지한다.
