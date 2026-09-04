# 패키지 공개 배포 준비 설계

## 배경

`nest-batch`는 현재 `packages/*` 아래에 14개의 workspace package를 가진 pnpm
workspace다. 다수의 `*-core` package는 외부 dependency가 없고 source file도 적어,
그대로 공개하면 사용자가 기능 하나를 위해 여러 package와 import 경로를 조합해야
한다. 공개 전 npm 배포 단위를 8개로 줄이되 내부 source module 경계는 유지한다.
모든 공개 package는 ESM JavaScript와 TypeScript declaration을 `dist/`에 빌드하며,
package 간 의존성은 `workspace:*`로 관리한다.

현재 typecheck, build, unit test, E2E test는 통과하고 `pnpm pack`으로 만든
tarball을 별도 임시 프로젝트에 설치해 runtime import와 CLI 실행도 확인했다.
다만 공개 npm package에 필요한 LICENSE/README, package metadata, tarball 품질
검사, version/changelog 관리, CI와 publish workflow는 아직 없다.

## 목표

- 아래 8개 package를 npm의 public scoped package로 배포할 수 있게 한다.
- framework-independent queue, scheduler, polling, worker 기능은 `core`의 명시적인
  subpath module로 통합한다.
- 모든 package를 하나의 고정 버전으로 함께 올린다.
- 최초 공개 버전은 `0.1.0`으로 준비한다.
- 일반 변경은 Changeset으로 기록하고 package별 `CHANGELOG.md`를 자동 생성한다.
- `vX.Y.Z` tag가 push될 때만 npm publish를 수행한다.
- npm Trusted Publishing(OIDC)과 자동 provenance를 사용한다.
- publish가 성공한 뒤 하나의 통합 GitHub Release와 릴리즈 노트를 생성한다.
- 로컬과 CI에서 같은 release readiness 검사를 실행할 수 있게 한다.

공개 대상 package는 다음과 같다.

- `@nest-batch/core`
- `@nest-batch/nest`
- `@nest-batch/inmemory`
- `@nest-batch/postgres`
- `@nest-batch/mysql`
- `@nest-batch/mariadb`
- `@nest-batch/bullmq`
- `@nest-batch/cli`

## 비목표

- 이 작업에서 실제 npm publish나 Git tag push를 수행하지 않는다.
- runtime 동작을 변경하지 않는다. 아직 공개되지 않은 package import 경로는 승인한
  8개 배포 경계에 맞게 통합한다.
- 아직 npm에 공개하지 않은 기존 package 이름을 compatibility package로 남기지
  않는다.
- CommonJS build를 추가하지 않는다. 현재 ESM-only package 정책을 유지한다.
- ORM integration package를 새로 만들지 않는다.
- performance test를 release의 필수 차단 조건으로 만들지 않는다.

## 선택한 릴리스 방식

### npm package 경계 통합

공개 npm package와 source module을 같은 단위로 강제하지 않는다. 외부 dependency가
없고 framework-independent인 기능은 `@nest-batch/core` 안에서 다음 subpath로
노출한다.

| 기존 package | 공개 import 경로 |
| --- | --- |
| `@nest-batch/queue-core` | `@nest-batch/core/queue` |
| `@nest-batch/scheduler-core`, `@nest-batch/scheduler-calendar` | `@nest-batch/core/scheduler` |
| `@nest-batch/polling-core` | `@nest-batch/core/polling` |
| `@nest-batch/worker-local`, `@nest-batch/worker-threads` | `@nest-batch/core/worker` |

각 subpath는 `packages/core/src/` 아래의 독립 directory와 barrel을 가지며 root
entrypoint가 모든 symbol을 다시 export하지 않는다. 사용자는 package 하나만
설치하지만 필요한 기능의 경계를 import path에서 확인할 수 있다.

외부 framework, database driver, queue client 또는 process entrypoint가 있는 경계는
별도 package로 유지한다.

- `@nest-batch/nest`: NestJS peer dependency와 DI/lifecycle 통합
- `@nest-batch/inmemory`: 비영속 adapter임을 명확히 분리
- `@nest-batch/postgres`, `@nest-batch/mysql`, `@nest-batch/mariadb`: 서로 다른 SQL
  driver와 dialect
- `@nest-batch/bullmq`: BullMQ peer dependency와 queue adapter
- `@nest-batch/cli`: executable entrypoint와 운영 command

기존 `@nest-batch/queue-bullmq`는 공개 전에 `@nest-batch/bullmq`로 이름을 단순화한다.
기존 6개 core 성격 package는 source와 test를 `core`로 이동한 뒤 workspace package를
제거한다. `nest`, storage adapter, `inmemory`, `bullmq`, `cli`의 내부 dependency는
가능한 한 `@nest-batch/core` 하나로 수렴한다. README, example, test, TypeScript path와
project reference도 새 import 경로를 사용한다.

### Changesets 고정 버전

Changesets의 `fixed` group에 8개 package를 모두 넣는다. 한 package에 release가
필요한 변경이 생기면 전체 package가 같은 버전으로 올라간다. 내부 dependency도
동일한 version으로 맞춰 사용자가 호환 가능한 조합을 쉽게 선택할 수 있게 한다.

각 기능 PR은 사용자에게 보이는 변경이 있을 때 Changeset을 추가한다. Changesets
workflow는 `develop` branch의 pending Changeset을 모아 Version PR을 만들고 다음을
갱신한다.

- 8개 package의 version
- package 간 dependency version
- package별 `CHANGELOG.md`

root package는 private이므로 Changesets의 release 대상이 아니다. Version PR에서
실행하는 repository script가 Changesets 계산 후 root version을 공개 package의 고정
version과 동기화한다. tag/version 검사는 이 root version도 확인한다.

문서나 CI처럼 package 산출물에 영향을 주지 않는 변경은 empty Changeset을 허용한다.

### tag-gated publish

Version PR이 병합되어 package version이 확정된 뒤 maintainer가 같은 version의
`vX.Y.Z` tag를 push한다. `publish.yml`은 tag가 가리키는 commit을 checkout하고
다음 순서로 실행한다.

1. tag version과 root 및 8개 package version이 같은지 검사한다.
2. frozen install, typecheck, unit test, build를 실행한다.
3. release metadata와 tarball 내용을 검사한다.
4. 별도 임시 프로젝트에 tarball을 설치해 runtime import, type declaration, CLI를
   smoke test한다.
5. npm registry에 같은 package version이 없을 때만 publish한다.
6. 8개 package가 모두 npm registry에서 조회되는지 확인한다.
7. publish job이 성공한 경우에만 GitHub Release를 생성한다.

publish job과 GitHub Release job을 분리한다. publish job만 `id-token: write`를
가지고, GitHub Release job만 `contents: write`를 가진다. GitHub-hosted runner와
Node 24를 사용하고 npm CLI가 Trusted Publishing 최소 버전을 충족하는지 검사한다.
GitHub Release job은 tag commit을 checkout하고 `HEAD`와 tag ref가 모두 workflow
`GITHUB_SHA`로 resolve되는지 확인한다. explicit repository의 release-by-tag API가
HTTP 404를 반환한 경우에만 generated release를 생성한다. 기존 release는 정확한 tag,
non-draft, non-prerelease여야 한다. `target_commitish`가 immutable 40자리 SHA이면 workflow
SHA와도 일치해야 하며, branch 이름이면 검증된 tag ref를 authoritative source로 삼는다.
인증, 권한, network 또는 기타 조회 오류에서는 release를 만들지 않고 실패한다.

### 최초 `0.1.0` bootstrap

npm Trusted Publisher는 registry에 이미 존재하는 package에만 설정할 수 있다.
따라서 최초 `0.1.0`은 maintainer가 로컬의 인증된 npm 계정과 2FA를 사용해 release
검증 및 idempotent publish script로 한 번 배포한다. 이후 npm에서 8개 package
각각에 다음 publisher를 등록한다.

- GitHub owner: `kangjuhyup`
- Repository: `nest-batch`
- Workflow: `publish.yml`
- GitHub environment: `npm`
- Allowed action: `npm publish`

Trusted Publisher 등록을 마친 뒤 `v0.1.0` tag를 push한다. workflow의 publish
script는 이미 존재하는 정확한 version을 검증 후 건너뛰므로 중복 publish 없이
GitHub Release만 생성할 수 있다. 이후 version부터는 tag workflow가 OIDC로 직접
배포한다. 로컬에서 bootstrap한 `0.1.0`은 provenance 예외이며 기존 version에는
provenance가 사후 첨부되지 않는다. 따라서 provenance는 처음으로 OIDC publish되는
후속 version부터 필수로 확인한다.

## package 산출물 설계

### 공통 metadata

8개 package manifest에 다음을 명시한다.

- `version: 0.1.0`
- package별 `description`과 `keywords`
- `license: MIT`
- `author: kangjuhyup`
- `repository.type`, `repository.url`, `repository.directory`
- `homepage`, `bugs.url`
- `engines.node: >=20.18.0`
- `publishConfig.access: public`
- `publishConfig.registry: https://registry.npmjs.org/`

root package는 private workspace 상태를 유지하며 repository와 engines 같은 공통
프로젝트 metadata를 가진다. publish workflow는 package runtime 지원 범위와 별개로
Trusted Publishing 요구사항을 만족하는 Node 24를 사용한다.

### README와 LICENSE

root에 MIT `LICENSE`를 추가한다. 각 package에는 npm package page와 tarball에서
직접 보이는 `README.md`와 `LICENSE`를 둔다. README는 최소한 다음 내용을 포함한다.

- package 역할과 package boundary
- 설치 명령
- 가장 작은 실제 import/사용 예제
- durable/retry/idempotency처럼 해당 package에 필요한 운영 주의점
- root 문서와 issue tracker 링크

LICENSE 복제본은 root LICENSE와 동일해야 하며 release 검사에서 내용 일치를
검증한다.

### build 산출물

TypeScript incremental build metadata인 `.tsbuildinfo`는 `dist/` 밖으로 이동하고
git에서 제외한다. runtime source map과 declaration map이 가리키는 원본을 사용할
수 있도록 package tarball에는 `dist/`, `src/`, `README.md`, `LICENSE`,
`package.json`만 포함한다. test와 local cache는 포함하지 않는다.

`exports`, `main`, `types`, CLI `bin`은 실제 tarball 안의 파일과 일치해야 한다.
package 간 `workspace:*`는 pack 결과에서 현재 고정 version으로 치환되어야 한다.

## 자동 검증

### 정적 release 검사

repository script는 다음 조건을 검사하고 하나라도 어기면 실패한다.

- 공개 package 목록이 Changesets fixed group 및 TypeScript references와 일치한다.
- 제거하기로 한 workspace package와 이전 import 경로가 source, test, example,
  문서에 남아 있지 않다.
- root와 모든 공개 package version이 동일하다.
- 필수 metadata가 존재하고 repository URL이 실제 GitHub repository와 일치한다.
- source manifest의 내부 dependency는 `workspace:*`이고 pack된 manifest에서는 현재
  고정 version으로 치환된다.
- README/LICENSE가 존재하고 LICENSE 내용이 root와 같다.
- public entrypoint, types entrypoint, CLI bin이 build 결과에 존재한다.
- `core/queue`, `core/scheduler`, `core/polling`, `core/worker` subpath의 JavaScript와
  declaration entrypoint가 build 및 pack 결과에 존재한다.
- tarball에 허용된 파일만 들어 있고 `.tsbuildinfo`, test, local secret이 없다.
- package tarball의 README/LICENSE와 내부 dependency 치환이 올바르다.
- catalog가 소유한 `dist`를 build 전에 안전하게 비워 stale 파일이 tarball에 섞이지
  않는다.

### 소비자 smoke test

검사는 임시 directory에 8개 tarball을 만들고 새 consumer project에 모두
설치한다. 다음을 확인한다.

- 8개 ESM package와 `core` subpath의 runtime import
- 대표 public API의 TypeScript compile
- `nest-batch --help` 실행
- package metadata 조회

임시 directory는 성공과 실패 모두에서 정리한다. repository source나 사용자의
전역 npm 설정은 변경하지 않는다.

### CI

`ci.yml`은 pull request와 `develop` push에서 다음을 실행한다.

- frozen install
- typecheck
- unit test
- build
- release 정적 검사와 consumer smoke test
- Postgres, MySQL, MariaDB, Redis service를 사용한 E2E test

package runtime 호환성은 Node 20.18과 Node 24에서 검사한다.
publish workflow는 재현성을 위해 cache를 사용하지 않고 tag commit에서 전체 검증을
다시 실행한다.

## 릴리즈 노트

두 종류의 기록을 유지한다.

- Changesets가 각 package의 `CHANGELOG.md`에 package API 관점의 변경을 기록한다.
- GitHub의 generated release notes가 하나의 `vX.Y.Z` release에 merged PR,
  contributor, 전체 변경 링크를 정리한다.

`.github/release.yml`에서 feature, fix, documentation, dependency, maintenance
category를 label로 분류한다. Version PR은 `release` label을 붙여 generated notes에서
제외한다. GitHub Release는 npm의 8개 package 확인이 끝난 뒤에만 생성한다. 같은 tag의
release가 이미 있으면 위 state와 tag checkout을 검증 후 건너뛰고, release-by-tag API의
HTTP 404가 확인됐을 때만 생성한다. 다른 조회 실패는 존재하지 않음으로 간주하지 않는다.

## 실패와 재실행

- tag와 package version이 다르면 publish 전에 실패한다.
- build/test/pack/smoke test가 실패하면 npm registry를 변경하지 않는다.
- publish 도중 일부 package만 성공한 경우 같은 workflow를 재실행할 수 있다.
  publish script는 registry의 정확한 version과 local tarball metadata를 비교해 이미
  올라간 package는 건너뛰고 나머지만 배포한다.
- registry에 같은 version이 있지만 repository metadata나 integrity 검증이 맞지 않으면
  덮어쓰지 않고 실패한다.
- npm publish가 모두 끝나기 전에는 GitHub Release를 만들지 않는다.
- publish된 npm version은 수정할 수 없으므로 실패 복구는 재실행 또는 다음 patch
  version으로 처리한다.

## 사용자 문서

root README와 `README-kr.md`에 다음을 반영한다.

- 통합된 core subpath와 8개 공개 package 목록
- 지원 Node version과 ESM-only 정책
- npm 설치 quickstart
- package 안정성 수준과 `0.x` 호환성 주의
- contributor용 Changeset 작성 흐름
- maintainer용 release 문서 링크

`docs/releasing.md`에는 공개 배포 checklist를 준비, 검증, 최초 bootstrap, Trusted
Publisher 등록, tag push, 사후 검증, 실패 복구 순서로 작성한다. 실제 publish와 npm
설정은 maintainer가 명시적으로 실행해야 하는 manual gate로 표시한다.

## 보안과 권한

- repository에 `NPM_TOKEN`을 상시 저장하지 않는다.
- publish workflow는 `id-token: write`와 최소한의 contents 권한만 사용한다.
- GitHub `npm` environment에 required reviewer를 설정할 수 있게 문서화한다.
- 최초 bootstrap 후 각 npm package에서 token publish를 제한하고 Trusted Publisher를
  우선하도록 안내한다.
- third-party GitHub Action은 major tag가 아니라 검토된 commit SHA pin을 원칙으로
  한다. 공식 GitHub/pnpm action도 최소 권한을 명시한다.

## 완료 기준

- root release checklist의 자동화 가능한 항목이 모두 통과한다.
- typecheck, unit test, build, E2E test가 성공한다.
- 8개 package tarball 검사와 별도 consumer smoke test가 성공한다.
- 기존 6개 core 성격 workspace package가 제거되고 관련 test가 `core` 경계에서
  동일한 동작을 검증한다.
- Changesets가 8개 package를 같은 version으로 계산한다.
- `publish.yml`은 tag/version 불일치와 중복 version을 안전하게 처리한다.
- repository에 실제 credential이 저장되지 않는다.
- `v0.1.0`을 실제 publish하지 않은 상태에서도 maintainer가 수행할 manual step이
  `docs/releasing.md`에 빠짐없이 기록된다.
