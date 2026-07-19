---
name: public-api-docs
description: nest-batch 저장소에서 README, quickstart, cookbook, JSDoc, public API 설명, 예제 코드를 작성하거나 갱신할 때 우선 사용한다. decorator API, programmatic API, CLI, retry/restart/checkpoint 의미를 사용자 문서에 반영해야 하는 작업에서 사용한다.
---

# Public API Docs

## Overview

`nest-batch`의 문서는 무엇을 할 수 있는지보다 어떻게 안전하게 실행하고 실패를 다루는지를 먼저 보여줘야 합니다.

## 문서 원칙

- quickstart는 설치부터 첫 job 실행까지 이어져야 합니다.
- public API 이름과 import 경로는 실제 export와 일치해야 합니다.
- retry, skip, restart, checkpoint, idempotency 의미를 과장 없이 설명합니다.
- Spring Batch와 비교할 때는 익숙한 용어만 빌리고 Node-native 차이를 명확히 둡니다.
- 운영에서 위험한 동작은 예제 아래에 짧게 주의점을 남깁니다.

## 우선 문서화할 내용

- `BatchModule.forRoot()` 또는 `forRootAsync()`
- decorator 기반 job/step 정의
- programmatic job 정의와 runner 사용
- CLI로 job 실행, 상태 확인, 재시도
- checkpoint/restart 사용 흐름
- retry/skip policy 예제
- Postgres adapter 설정
- graceful shutdown과 worker 실행 방식

## 예제 기준

- 예제는 복사해서 실행 가능한 형태를 우선합니다.
- Nest 예제는 module, provider, job class가 한 흐름으로 보여야 합니다.
- core 예제는 Nest 없이도 실행 가능한 programmatic API를 보여줍니다.
- retry/restart 예제는 성공 경로만 보여주지 말고 실패 의미를 함께 적습니다.
- 문서 snippet이 실제 코드와 달라질 가능성이 있으면 테스트 또는 example project로 고정합니다.

## 문서 작성 절차

1. 변경된 public API와 사용자를 확인합니다.
2. README, docs, JSDoc, examples 중 어디에 반영해야 하는지 정합니다.
3. 최소 실행 예제를 먼저 작성합니다.
4. 실패, 재시작, idempotency 의미를 필요한 만큼 덧붙입니다.
5. import path와 옵션 이름이 실제 코드와 맞는지 확인합니다.

## 문체

- 기본 설명은 짧고 직접적으로 씁니다.
- 기능 목록보다 사용 흐름을 우선합니다.
- 아직 구현되지 않은 기능을 약속처럼 쓰지 않습니다.
- 코드 주석은 API 의미를 보강할 때만 사용합니다.

## 출력 기대치

결과는 어떤 문서가 어떤 public behavior를 설명하는지, 예제가 실제 코드와 맞는지, 아직 문서화되지 않은 동작이 남았는지 알려야 합니다.
