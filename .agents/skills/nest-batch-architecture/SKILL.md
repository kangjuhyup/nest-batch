---
name: nest-batch-architecture
description: nest-batch 저장소에서 패키지 경계, 모듈 책임, 공개 API, NestJS 통합 구조를 설계하거나 검토할 때 우선 사용한다. core와 adapter 의존성 분리, durable batch runtime 구조, package layout, public export 방향을 판단해야 하는 작업에서 사용한다.
---

# Nest Batch Architecture

## Overview

`nest-batch`를 Spring Batch 복제물이 아니라 Node-native 배치 프레임워크로 유지하기 위한 아키텍처 판단 기준입니다.

## 확인할 입력

작업 전에 필요한 범위만 확인합니다.

- 루트 `package.json`
- workspace 설정
- 관련 package의 `src/`, `test/`, `README`
- public export 파일
- runtime contract와 adapter interface

## 패키지 경계

기본 경계는 다음처럼 둡니다.

- `packages/core`: NestJS에 의존하지 않는 job/step 정의, runner, policy, repository contract.
- `packages/nest`: Nest module, decorator, discovery, DI, lifecycle hook.
- `packages/postgres`: Postgres 기반 repository, lock, checkpoint adapter.
- `packages/cli`: 운영 CLI와 process bootstrap.
- `examples/*`: 사용자 예제와 통합 검증용 앱.
- `docs/*`: 개념, API, 운영 가이드.

이 경계가 없을 때는 새 구조를 만들기 전에 왜 필요한지 짧게 설명합니다.

## 의존성 규칙

- `core`는 NestJS, database client, queue client, CLI framework에 의존하지 않습니다.
- `nest`는 `core`를 사용하지만 `core`가 `nest`를 알게 하지 않습니다.
- storage, lock, queue, scheduler 구현은 adapter package 또는 integration package에 둡니다.
- public type은 core contract에 가깝게 두고, adapter-specific option은 adapter package에 둡니다.
- example 코드는 library package 내부로 새지 않게 합니다.

## 공개 API 기준

좋은 public API는 다음 성질을 가집니다.

- Nest 사용자에게는 decorator와 module API가 자연스럽습니다.
- Nest를 쓰지 않는 사용자는 programmatic API로 같은 runtime을 사용할 수 있습니다.
- job parameter, execution id, checkpoint key, status enum은 안정적인 타입으로 노출합니다.
- 내부 orchestration class는 필요한 경우에만 export합니다.
- public export 변경은 README, JSDoc, 예제 영향을 함께 확인합니다.

## 설계 판단 절차

1. 변경이 어느 package boundary에 속하는지 정합니다.
2. runtime contract인지 adapter 구현인지 분리합니다.
3. NestJS DX가 필요한지, core API로 충분한지 판단합니다.
4. 실패, 재시작, 취소, 중복 실행에 미치는 영향을 확인합니다.
5. public export와 문서 영향이 있는지 확인합니다.

## 설계 체크리스트

- core가 framework-independent인가
- adapter를 교체할 수 있는 contract가 있는가
- job/step execution 상태 저장 책임이 명확한가
- scheduler와 worker가 runtime을 우회하지 않는가
- 공개 API가 runtime 내부 구현을 과하게 드러내지 않는가
- 테스트가 각 boundary를 독립적으로 검증할 수 있는가

## 출력 기대치

결과는 어디에 둘지, 왜 그 경계가 맞는지, 어떤 API가 노출되어야 하는지, 어떤 검증이 필요한지를 짧게 설명해야 합니다.
