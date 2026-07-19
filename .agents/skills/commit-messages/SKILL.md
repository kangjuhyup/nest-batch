---
name: commit-messages
description: nest-batch 저장소에서 git commit message를 작성하거나 commit template을 사용할 때 feat/fix/refactor/chore/docs prefix, 한글 제목, 한글 작업내용 bullet 규칙을 적용해야 할 때 사용한다.
---

# Commit Messages

## Overview

`nest-batch`의 commit message는 변경 유형을 짧게 드러내고, 제목과 작업내용은 한국어로 작성합니다. 제목만으로 부족한 변경은 body에 bullet list로 실제 작업내용을 적습니다.

## Format

```text
feat|fix|refactor|chore|docs : 제목
- 작업내용1
- 작업내용2
```

## Type

| Type | 사용 기준 |
| --- | --- |
| `feat` | 새로운 기능, 공개 API, 사용자 동작 추가 |
| `fix` | 버그 수정, 잘못된 동작 교정 |
| `refactor` | 동작 변화 없는 구조 개선 |
| `chore` | 빌드, 설정, 의존성, 내부 작업 |
| `docs` | README, 문서, 예제, 주석 중심 변경 |

## Writing Rules

- 제목과 작업내용은 한국어로 작성합니다.
- 제목은 명령형보다 변경 결과 중심으로 짧게 씁니다.
- prefix 뒤에는 공백, 콜론, 공백을 둡니다. 예: `feat : 배치 실행 상태 타입 추가`
- body가 있으면 각 줄을 `- ` bullet로 시작합니다.
- body에는 변경한 파일 나열보다 사용자가 이해할 작업 단위를 적습니다.
- 여러 성격이 섞이면 사용자 영향이 가장 큰 type을 선택합니다.

## Examples

```text
feat : MySQL adapter 경계 추가
- MySQL 전용 package boundary를 정의
- checkpoint와 lock 설계 기준을 문서화
```

```text
docs : 커밋 메시지 규칙 추가
- 한글 제목과 작업내용 작성 규칙을 정리
- git commit template을 추가
```

## Checklist

- type이 `feat`, `fix`, `refactor`, `chore`, `docs` 중 하나인가
- 제목 앞뒤 형식이 `type : 제목`인가
- 제목이 한국어인가
- body를 썼다면 모든 작업내용이 `- `로 시작하는가
- body 작업내용이 한국어인가
