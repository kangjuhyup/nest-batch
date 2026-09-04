# Changeset 작성 안내

사용자에게 보이는 API, 동작 또는 package 산출물이 바뀌는 PR에는 `pnpm changeset`을 실행해
변경 대상 package와 release type을 기록합니다. 8개 공개 package는 fixed group이므로 하나의
package에 release가 필요하면 모두 같은 version으로 올라갑니다.

문서, CI, 내부 개발 도구처럼 package 산출물과 무관한 변경에는 `pnpm changeset --empty`를
사용합니다. empty Changeset도 PR의 release 영향이 없음을 명확히 기록합니다.
