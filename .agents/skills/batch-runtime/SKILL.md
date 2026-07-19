---
name: batch-runtime
description: nest-batch 저장소에서 job/step 실행 엔진, AsyncIterable chunk 처리, checkpoint/restart, retry/skip, lock, scheduler, worker, graceful shutdown을 설계하거나 구현할 때 우선 사용한다. 실패와 재시작 의미가 중요한 runtime 변경에서 사용한다.
---

# Batch Runtime

## Overview

`nest-batch` runtime을 Node.js에 자연스러운 durable execution engine으로 만들기 위한 작업 지침입니다.

## 핵심 모델

runtime 논의에서는 다음 개념을 구분합니다.

- `JobDefinition`: 실행 가능한 job 정의.
- `StepDefinition`: tasklet 또는 chunk step 정의.
- `JobInstance`: job name과 parameters로 식별되는 논리적 실행 대상.
- `JobExecution`: 실제 실행 시도와 상태.
- `StepExecution`: step 단위 실행 상태와 counters.
- `ExecutionContext`: checkpoint, cursor, step 간 공유 metadata.
- `JobRepository`: execution 상태를 durable하게 저장하는 contract.
- `LockManager`: 분산 실행 중복을 막는 contract.

## Node-native 실행 원칙

- reader는 가능한 한 `AsyncIterable`로 모델링합니다.
- chunk pipeline은 backpressure를 존중하고 전체 데이터를 메모리에 올리지 않습니다.
- 긴 실행은 `AbortSignal`을 받아 취소 가능해야 합니다.
- shutdown 시 새 chunk를 시작하지 않고 진행 중인 안전 지점까지 정리합니다.
- CPU-heavy 작업은 worker thread 또는 별도 process로 분리할 수 있게 설계합니다.
- at-least-once 실행을 기본 의미로 두고, writer idempotency를 문서화합니다.

## Chunk Step 절차

1. execution과 step 상태를 repository에 시작 상태로 저장합니다.
2. checkpoint에서 reader cursor를 복원합니다.
3. reader에서 item을 읽고 processor를 적용합니다.
4. chunk size 또는 flush 조건에 맞춰 writer를 호출합니다.
5. writer 성공 후 counters와 checkpoint를 저장합니다.
6. 실패하면 retry/skip policy를 적용하고 상태를 갱신합니다.
7. 완료, 실패, 취소 상태를 명확히 기록합니다.

## Retry / Skip

- retry는 예외 타입, 최대 횟수, backoff, timeout을 명시합니다.
- skip은 데이터 손실 가능성이 있으므로 limit과 기록이 필요합니다.
- retry exhausted와 skip limit exceeded는 서로 다른 exit reason으로 남깁니다.
- processor 실패와 writer 실패는 의미가 다르므로 같은 정책으로 뭉개지 않습니다.
- 무한 재시도는 허용하지 않습니다.

## Checkpoint / Restart

- checkpoint는 성공적으로 처리된 경계 이후에만 저장합니다.
- reader cursor와 execution context를 분리할지 먼저 판단합니다.
- restart는 같은 job parameters와 실패한 execution 이력을 기준으로 동작해야 합니다.
- 처음부터 다시 실행하는 rerun과 checkpoint부터 이어가는 restart를 구분합니다.
- writer가 외부 시스템에 부분 성공할 수 있으면 idempotency key 전략을 함께 설계합니다.

## Lock / Worker

- 같은 job execution은 동시에 두 worker에서 실행되지 않아야 합니다.
- lock에는 owner, acquiredAt, expiresAt 또는 heartbeat 개념이 필요합니다.
- worker crash 이후 stale lock 회수 정책을 둡니다.
- scheduler는 execution 생성과 enqueue에 집중하고, 실제 실행은 worker가 담당합니다.
- queue adapter를 사용하더라도 repository 상태가 source of truth여야 합니다.

## 테스트 포인트

- 정상 완료
- reader 실패
- processor retry 후 성공
- processor skip
- writer 실패 후 재시작
- shutdown 중 취소
- lock 충돌
- stale lock 회수
- checkpoint부터 재시작
- 같은 parameters의 중복 실행 방지

## 출력 기대치

runtime 변경 결과는 실행 상태 변화, 실패 의미, 재시작 의미, idempotency 기대치, 검증한 테스트를 함께 설명해야 합니다.
