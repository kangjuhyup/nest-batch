# AGENTS

이 문서는 `nest-batch` 저장소에서 작업하는 모든 AI 에이전트를 위한 공통 가이드입니다.

적용 대상:
- Codex
- Claude
- Cursor

공통 문서 위치:
- 역할 문서: `.agents/`
- 작업 스킬: `.agents/skills/`
- Codex 역할 매핑: `.codex/agents.toml`

우선순위:
1. 사용자 요청
2. 이 저장소의 명시적 설정 파일
3. 역할 문서와 스킬 문서

## Project Overview

`nest-batch`는 NestJS 생태계를 위한 Node-native 배치 프레임워크입니다.

목표는 Spring Batch를 TypeScript로 그대로 복제하는 것이 아니라, Node.js 런타임에 자연스러운 방식으로 durable job execution, streaming chunk processing, checkpoint/restart, retry/skip, distributed worker, observability를 제공하는 것입니다.

## Core Principles

- Node-native 설계를 우선합니다. `AsyncIterable`, stream/backpressure, `AbortSignal`, graceful shutdown, worker process, queue adapter를 1급 개념으로 둡니다.
- `@nest-batch/core`는 NestJS에 의존하지 않습니다.
- NestJS 통합은 별도 패키지에서 처리합니다.
- Job 실행은 durable해야 하며, 실패와 재시작을 정상 시나리오로 다룹니다.
- 분산 실행은 at-least-once를 기본 전제로 두고 idempotency를 명시적으로 지원합니다.
- 스케줄러는 job을 직접 오래 실행하는 책임보다 execution 생성과 enqueue 책임에 집중합니다.
- 공개 API는 작고 안정적으로 유지합니다.

## Expected Package Boundaries

초기 구조는 다음 방향을 기준으로 설계합니다.

```text
packages/
  core/       # Nest에 의존하지 않는 job/step runtime, contracts, policies
  nest/       # Nest module, decorators, discovery, lifecycle integration
  postgres/   # JobRepository, lock, checkpoint Postgres adapter
  cli/        # run/status/retry/list 같은 운영 CLI
examples/
  basic/
  nestjs/
docs/
```

아직 실제 패키지가 없을 때도 이 경계를 기준으로 설계 판단을 합니다.

## Skill Routing

작업을 시작할 때 `nest-batch` 저장소의 repo-local skill을 먼저 고려하고, 관련 스킬을 명시적으로 읽고 적용합니다. 사용자 또는 상위 지침이 별도 skill을 요구하더라도, `nest-batch` 코드/문서/설계 판단에는 아래 repo-local skill을 우선적인 프로젝트 기준으로 사용합니다.

| 상황 | 스킬 |
| --- | --- |
| 패키지 경계, 공개 API, Nest 통합 구조 설계 | `$nest-batch-architecture` / `.agents/skills/nest-batch-architecture/SKILL.md` |
| job/step runtime, retry, skip, checkpoint, lock, worker 구현 | `$batch-runtime` / `.agents/skills/batch-runtime/SKILL.md` |
| 테스트 설계, 실패 재현, 검증 명령 정리 | `$testing` / `.agents/skills/testing/SKILL.md` |
| README, JSDoc, 사용 예제, 공개 API 문서 | `$public-api-docs` / `.agents/skills/public-api-docs/SKILL.md` |

명시 호출이 필요할 때는 사용자 프롬프트나 에이전트 handoff에 `$nest-batch-architecture`, `$batch-runtime`, `$testing`, `$public-api-docs`를 포함합니다.

## Agent Roles

역할 문서는 `.agents/`를 원본으로 둡니다.

| 역할 | 용도 |
| --- | --- |
| `project-architect` | 패키지 경계, 모듈 책임, 공개 API 방향 |
| `runtime-engineer` | durable runtime, checkpoint, retry, locking, worker |
| `code-writer` | 설계에 따른 실제 구현과 테스트 |
| `reviewer` | 버그, 회귀, 테스트 누락, API 위험 리뷰 |
| `docs-writer` | 공개 문서, 예제, JSDoc 정리 |

## Engineering Rules

- 구현 전에 변경이 어느 패키지 경계에 속하는지 먼저 판단합니다.
- core에서 NestJS decorator, provider token, lifecycle hook에 의존하지 않습니다.
- adapter 구현이 core type을 오염시키지 않게 합니다.
- runtime 코드는 cancellation과 graceful shutdown을 고려합니다.
- checkpoint 저장 위치와 idempotency 기대치를 코드와 문서에 드러냅니다.
- public export를 추가하거나 바꾸면 README/JSDoc 영향도 확인합니다.
- 테스트는 정상 경로보다 실패, 재시작, 중복 실행, 취소, 부분 성공을 더 중요하게 봅니다.

## Output Rules

- 기본 설명은 한국어로 작성합니다.
- 코드, public API 이름, npm package 이름은 영어를 사용합니다.
- 파일을 수정했다면 수정한 파일과 검증 결과를 짧게 요약합니다.
- 테스트를 실행하지 못했다면 이유를 명확히 남깁니다.
