---
name: testing
description: nest-batch 저장소에서 테스트 설계, 테스트 설명, 실패 재현, 회귀 검증, 커버리지 보강, 런타임 edge case 검증이 필요할 때 우선 사용한다. job/step 실행, checkpoint/restart, retry/skip, lock, Nest integration, public API 예제를 검증할 때 사용한다.
---

# Testing

## Overview

`nest-batch`는 실패와 재시작을 다루는 프레임워크이므로, 테스트는 성공 경로보다 실패 경계와 상태 전이를 더 중요하게 봅니다.

## 기본 원칙

- 기존 test runner가 있으면 그 표준을 따릅니다.
- 아직 표준이 없으면 core package는 빠른 단위 테스트를 우선하고, Nest integration은 Nest testing utility 사용 여부를 명시합니다.
- runtime test는 시간, lock, repository, reader/writer를 제어 가능한 fake로 둡니다.
- 외부 DB adapter는 contract test와 integration test를 분리합니다.
- 테스트는 내부 구현보다 public behavior와 상태 전이를 고정합니다.
- `describe`, `it`, `test` 설명은 `English / 한국어` 형식으로 작성합니다.
- 영어 설명을 먼저 쓰고, 같은 의미를 읽기 쉬운 한국어로 뒤에 씁니다.
- 한국어 설명은 직역보다 테스트 의도가 드러나는 문장을 우선합니다.

## 테스트 분류

- Unit test: policy, state transition, chunk orchestration, retry/skip 판단.
- Contract test: `JobRepository`, `LockManager`, checkpoint store adapter가 같은 의미를 지키는지 검증.
- Integration test: Nest module discovery, DI, lifecycle, real Postgres adapter.
- Example test: 문서에 적힌 quickstart가 실제로 동작하는지 검증.

## 필수 runtime 시나리오

- job 성공 완료
- step 실패와 job 실패 전파
- processor retry 후 성공
- retry exhausted
- skip limit 내 처리 지속
- skip limit 초과 실패
- writer 실패 후 checkpoint부터 restart
- 같은 job parameters 중복 실행 방지
- lock 충돌 시 한 worker만 실행
- `AbortSignal` 취소와 graceful shutdown
- stale lock 회수

## 테스트 작성 절차

1. 바뀐 public behavior 또는 상태 전이를 한 문장으로 정리합니다.
2. 실패하는 테스트를 먼저 만들 수 있으면 먼저 만듭니다.
3. fake repository, lock, clock으로 runtime edge case를 작게 재현합니다.
4. adapter가 관련되면 contract test로 의미를 고정합니다.
5. public API가 바뀌면 예제 또는 README snippet도 검증합니다.

## 검증 명령

프로젝트에 스크립트가 생기면 repository 표준 명령을 우선 사용합니다. 아직 표준이 없으면 임의로 도구를 섞지 말고, 선택한 test runner와 이유를 먼저 기록합니다.

## 출력 기대치

결과는 어떤 동작을 검증했는지, 어떤 실패 경로가 남았는지, 어떤 명령을 실행했는지 명확히 설명해야 합니다.
