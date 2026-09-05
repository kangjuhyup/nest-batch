# nest-batch 공개 배포

이 문서는 `@rv-nest-batch/*` package의 maintainer용 공개 배포 절차입니다. 모든 checkbox는
수동 확인 항목이므로 이 저장소의 자동 검증이나 문서 작성으로 완료 처리하지 않습니다.

로컬 명령은 Node `24`와 root의 `pnpm@10.34.5` pin을 사용합니다. 먼저 `nvm`이
maintainer shell에 설치·로드되어 있는지 확인한 뒤 다음을 실행합니다.

```bash
nvm use
corepack enable
corepack pnpm --version # 10.34.5
pnpm install --frozen-lockfile
```

## 1. Release candidate 준비

- [ ] Changesets Version PR workflow 승인과 CI 성공 확인 후 merge
  - 각 Changesets Version PR이 생성되거나 갱신될 때마다 write 권한 maintainer가 PR merge box에서 **Approve workflows to run**을 클릭합니다.
  - **Quality (Node 20.18.3)**, **Quality (Node 24)**, **E2E (Node 24)** check가 모두 성공한 뒤에만 Version PR을 merge합니다.
  - Version PR merge commit을 release candidate로 정하고 아래 local 검증을 마친 뒤에만 release tag를 생성합니다.
- [ ] worktree가 clean이고 release commit이 `develop`에 포함됨
  - `git status --short`의 출력이 없어야 하며, `git fetch origin develop` 후 `git merge-base --is-ancestor <release-commit> origin/develop`가 성공해야 합니다.
- [ ] 8개 package와 root version이 동일함
  - `pnpm release:check`가 root와 아래 공개 package의 고정 version을 함께 검사합니다: `@rv-nest-batch/core`, `@rv-nest-batch/nest`, `@rv-nest-batch/inmemory`, `@rv-nest-batch/postgres`, `@rv-nest-batch/mysql`, `@rv-nest-batch/mariadb`, `@rv-nest-batch/bullmq`, `@rv-nest-batch/cli`.
- [ ] `pnpm release:check` 성공
  - `pnpm release:check`는 catalog가 소유한 8개 package의 `dist`만 안전하게 비운 뒤 typecheck, unit test, fresh build, release metadata/tarball, consumer smoke test를 실행합니다.
- [ ] `pnpm test:e2e` 성공
  - 먼저 `docker compose up -d postgres mysql mariadb redis`를 실행하고 `pnpm test:e2e`를 실행합니다.

## 2. 최초 0.1.0 bootstrap

- [ ] npm에서 `rv-nest-batch` scope ownership과 publish 권한 확인
  - npm web UI에서 `rv-nest-batch` scope의 Members/Teams 설정을 열어 실행 maintainer의 ownership과 public package publish 권한을 직접 확인합니다.
  - scope 권한을 확인한 뒤 아래의 read-only identity audit를 8개 catalog package 모두에 실행합니다.

```bash
npm view @rv-nest-batch/core name version maintainers repository dist-tags --json --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/
npm view @rv-nest-batch/nest name version maintainers repository dist-tags --json --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/
npm view @rv-nest-batch/inmemory name version maintainers repository dist-tags --json --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/
npm view @rv-nest-batch/postgres name version maintainers repository dist-tags --json --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/
npm view @rv-nest-batch/mysql name version maintainers repository dist-tags --json --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/
npm view @rv-nest-batch/mariadb name version maintainers repository dist-tags --json --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/
npm view @rv-nest-batch/bullmq name version maintainers repository dist-tags --json --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/
npm view @rv-nest-batch/cli name version maintainers repository dist-tags --json --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/
```

  - 기존 package는 승인된 repository identity와 ownership이 일치하거나 명시적인 transfer/rename 결정이 있어야 합니다. 그렇지 않으면 **STOP**합니다.
  - 기존 또는 새 package identity가 승인된 이름, repository, ownership과 다르면 즉시 **STOP**합니다.
  - `E404`는 scope publish 권한을 확인한 뒤에만 bootstrap 후보입니다.
  - 8개 package의 `E404`는 이름의 public 조회 결과일 뿐 scope ownership이나 publish 권한의 증거가 아닙니다. 두 권한을 직접 확인한 뒤에만 bootstrap 후보로 판단합니다.
- [ ] npm 계정과 2FA 상태 확인
  - `npm whoami --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/`가 의도한 maintainer를 출력하고, `npm profile get --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/`의 2FA 값이 publish를 보호하는 설정인지 확인합니다.
- [ ] `pnpm run release:publish --tag v0.1.0`을 maintainer가 직접 실행
  - **Manual gate — 실제 npm publish:** 이 명령은 인증된 maintainer가 모든 이전 checkbox를 확인한 뒤 직접 실행합니다. 이 문서 작성·검증 작업에서는 실행하지 않습니다.
  - 실행 명령: `pnpm run release:publish --tag v0.1.0`
  - publish child process는 maintainer terminal의 표준 입출력을 상속하므로 npm의 OTP/WebAuthn prompt에 직접 응답할 수 있습니다.
  - 로컬에서 publish한 `0.1.0`은 provenance 예외입니다. 동일 artifact를 tag workflow가 건너뛰어도 기존 version에 provenance가 사후 추가되지는 않습니다.
- [ ] 8개 package의 `0.1.0`과 integrity 확인
  - 아래 각 명령의 `version`이 `0.1.0`이고 `dist.integrity`가 publish script가 확인한 tarball integrity와 일치해야 합니다.
  - workflow의 npm 12는 `dist.integrity --json`을 단일 원소 배열로 반환합니다. publish script는 npm 11의 JSON scalar와 npm 12의 정확한 단일 원소 배열만 허용하고, 빈 배열·복수 값·잘못된 integrity는 실패시킵니다.

```bash
npm view @rv-nest-batch/core@0.1.0 version dist.integrity --json --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/
npm view @rv-nest-batch/nest@0.1.0 version dist.integrity --json --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/
npm view @rv-nest-batch/inmemory@0.1.0 version dist.integrity --json --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/
npm view @rv-nest-batch/postgres@0.1.0 version dist.integrity --json --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/
npm view @rv-nest-batch/mysql@0.1.0 version dist.integrity --json --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/
npm view @rv-nest-batch/mariadb@0.1.0 version dist.integrity --json --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/
npm view @rv-nest-batch/bullmq@0.1.0 version dist.integrity --json --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/
npm view @rv-nest-batch/cli@0.1.0 version dist.integrity --json --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/
```

## 3. Trusted Publisher 등록

- [ ] owner `kangjuhyup`, repository `nest-batch`, workflow `publish.yml`, environment `npm` 등록
  - npm package web UI의 **Settings → Trusted Publisher → GitHub Actions**에서 8개 package 각각에 GitHub owner `kangjuhyup`, repository `nest-batch`, workflow filename `publish.yml`, GitHub environment `npm`을 입력합니다.
- [ ] 8개 package 모두 Allowed action `npm publish` 설정
  - `@rv-nest-batch/core`, `@rv-nest-batch/nest`, `@rv-nest-batch/inmemory`, `@rv-nest-batch/postgres`, `@rv-nest-batch/mysql`, `@rv-nest-batch/mariadb`, `@rv-nest-batch/bullmq`, `@rv-nest-batch/cli` 각각의 Trusted Publisher UI에서 **Allowed action** 값을 `npm publish`로 설정합니다.
- [ ] GitHub `npm` environment와 required reviewer 설정
  - GitHub repository **Settings → Environments → npm**에서 environment name을 `npm`으로 만들고, **Required reviewers**에 release approver를 추가합니다.
- [ ] npm token publish 제한 설정
  - 8개 package 각각의 npm package web UI에서 **Settings → Publishing access**를 열고 **Require two-factor authentication and disallow tokens**를 선택한 뒤 **Save**합니다.
  - bootstrap에 token을 사용했다면 package-level setting과 별도로 해당 token을 revoke합니다.

## 4. Tag release

- [ ] `git tag -s vX.Y.Z <release-commit>`
  - **Manual gate — 서명 tag 생성:** maintainer가 확인한 release commit에만 실행합니다. 이 문서 작성·검증 작업에서는 tag를 만들지 않습니다.
- [ ] `git push origin vX.Y.Z`
  - **Manual gate — 서명 tag push:** 위에서 서명한 tag만 push합니다. 이 문서 작성·검증 작업에서는 push하지 않습니다.
- [ ] publish workflow 성공 확인
  - GitHub **Actions → Publish packages**에서 `publish.yml`이 `vX.Y.Z` tag로 실행되었고 `publish` job과 `github-release` job이 모두 성공했는지 확인합니다.
- [ ] npm provenance와 GitHub generated release notes 확인
  - 처음으로 OIDC publish되는 후속 version부터 provenance를 필수로 확인합니다. 각 npm package version 페이지의 **Provenance**가 GitHub Actions `kangjuhyup/nest-batch`를 가리키는지 확인합니다. 로컬 bootstrap `0.1.0`에는 이 검사를 적용하지 않습니다.
  - GitHub **Releases → vX.Y.Z**에 generated release notes가 생성됐는지 확인합니다. 기존 GitHub Release가 있으면 검증 후 건너뛰고, 없을 때만 생성합니다.
  - 기존 release는 tag 이름이 정확하고 draft/prerelease가 아니어야 합니다. workflow checkout의 tag와 `HEAD`가 모두 `GITHUB_SHA`로 resolve되어야 하며, `target_commitish`가 40자리 commit SHA이면 그 값도 일치해야 합니다. branch 이름처럼 가변 target이면 검증된 tag ref를 기준으로 삼습니다.
  - `gh api graphql` 조회로 published와 draft release의 양의 `databaseId`를 찾으며, `data.repository.release`가 `null`인 경우에만 새 release를 생성합니다.
  - GraphQL object가 있으면 REST `GET repos/{owner}/{repo}/releases/{databaseId}`로 tag, target, draft, prerelease를 검증합니다.
  - GraphQL `errors`, REST 인증·권한·network 오류 또는 malformed 응답은 생성으로 전환하지 않고 workflow를 실패시킵니다.
  - create가 실패하면 같은 GraphQL ID → REST by ID 경로로 정확히 한 번 재조회합니다. 그 사이 생성된 release가 계약과 정확히 일치할 때만 성공으로 복구하고, 여전히 없거나 조회가 실패하면 원래 create 오류를 보존하며, 충돌 release면 충돌 오류로 실패합니다.

## 5. 실패 복구

- [ ] 같은 tag workflow 재실행으로 동일 integrity package를 skip
  - GitHub **Actions → Publish packages → Re-run failed jobs**에서 같은 `vX.Y.Z` tag workflow를 재실행합니다. `release:publish`는 registry의 같은 version과 integrity가 일치하는 package를 skip하고 남은 package만 처리합니다.
- [ ] integrity가 다르면 즉시 중단하고 원인 조사
  - `npm view <package>@X.Y.Z version dist.integrity --json --registry https://registry.npmjs.org/ --@rv-nest-batch:registry=https://registry.npmjs.org/`과 release artifact 결과가 다르면 재실행이나 강제 publish를 하지 말고 중단합니다. package manifest, tag commit, tarball hash를 조사합니다.
- [ ] publish된 version은 덮어쓰지 않고 필요 시 다음 patch version 준비
  - npm의 publish된 version은 덮어쓸 수 없습니다. recovery가 불가능하면 Changeset을 추가하고 Version PR로 다음 patch version을 만든 뒤 1번부터 다시 확인합니다.
