---
name: commit-messages
description: nest-batch 저장소에서 git commit message를 작성하거나 commit template을 사용할 때 <type>/<제목> -내용 형식, 한글 제목과 내용 규칙을 적용해야 할 때 사용한다.
---

# Commit Messages

## Overview

`nest-batch`의 commit message는 변경 유형, 변경 대상, 핵심 결과를 첫 줄에 짧게 드러냅니다. 제목과 내용은 한국어로 작성하고, 상세 설명이 필요하면 첫 줄 아래에 적습니다.

## Format

```text
<type>/<제목> -내용
```

## Type

| Type | 사용 기준 |
| --- | --- |
| `feat` | 새로운 기능, 공개 API, 사용자 동작 추가 |
| `fix` | 버그 수정, 잘못된 동작 교정 |
| `refactor` | 동작 변화 없는 구조 개선 |
| `test` | 테스트 추가 또는 수정 |
| `docs` | README, 문서, 예제, 주석 중심 변경 |
| `chore` | 빌드, 설정, 의존성, 내부 작업 |

## Writing Rules

- 첫 줄은 반드시 `<type>/<제목> -내용` 형식을 사용합니다.
- 제목은 변경 대상을 짧게 적습니다.
- 내용은 변경 이유나 핵심 결과를 한 문장으로 적습니다.
- author 정보는 메시지에 작성하지 않습니다.
- 여러 변경이 섞이면 가능한 한 커밋을 나눕니다.
- 상세 설명이 필요하면 첫 줄 아래에 적습니다.

## Examples

```text
feat/알림 채널 추가 -슬랙과 디스코드 알림 채널을 추가
```

```text
fix/요청 로그 마스킹 -쿼리 토큰이 로그에 남지 않도록 수정
```

```text
test/알림 실패 검증 -채널별 실패 상태 테스트 추가
```

## Checklist

- type이 `feat`, `fix`, `refactor`, `test`, `docs`, `chore` 중 하나인가
- 첫 줄 형식이 `<type>/<제목> -내용`인가
- 제목이 변경 대상을 짧게 설명하는가
- 내용이 변경 이유나 핵심 결과를 한 문장으로 설명하는가
- author 정보가 메시지에 포함되지 않았는가
