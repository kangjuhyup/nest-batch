---
name: orm-integrations
description: nest-batch 저장소에서 TypeORM, MikroORM, Prisma 같은 ORM integration, EntityManager, PrismaClient, transaction, migration, Nest DI 연동을 설계하거나 검토할 때 사용한다.
---

# ORM Integrations

## Overview

ORM integration은 사용자의 application database client를 `nest-batch` persistence 또는 job writer에 연결하는 선택적 adapter입니다. `@rv-nest-batch/core`는 ORM type을 알지 않아야 하며, ORM별 transaction과 lifecycle 차이는 integration package에서 흡수합니다.

## 확인할 입력

작업 전에 필요한 범위만 확인합니다.

- `packages/core`의 repository/checkpoint/lock contract
- `packages/nest`의 module/provider API
- 대상 ORM: TypeORM, MikroORM, Prisma
- 사용자가 원하는 연결 방식: batch metadata 저장소, job writer helper, Nest provider wiring
- transaction boundary, migration, test strategy

## Package Boundary

- `packages/typeorm`: TypeORM 기반 adapter와 provider factory.
- `packages/mikro-orm`: MikroORM 기반 adapter와 provider factory.
- `packages/prisma`: Prisma 기반 adapter와 provider factory.
- Nest 전용 wiring이 필요한 경우 ORM package가 optional Nest provider helper를 제공하거나, 의존성이 커지면 별도 Nest integration package로 분리합니다.
- ORM peer dependency와 adapter-specific option은 각 package에 둡니다.
- `core` export에는 ORM client, entity, decorator, provider token을 추가하지 않습니다.

## Integration Principles

- ORM은 connection/transaction provider로 취급합니다. batch metadata model이 user domain model을 오염시키지 않게 합니다.
- batch job은 request lifecycle 밖에서 실행됩니다. request-scoped manager나 per-request context에 의존하지 않습니다.
- repository/checkpoint transaction과 user writer transaction을 자동으로 하나로 묶지 않습니다. 묶는 option을 제공한다면 부분 실패 의미를 문서화합니다.
- migration은 ORM schema에 강제로 섞지 않는 방향을 우선합니다. ORM migration을 요구하면 generated table/entity 관리 책임을 명확히 둡니다.
- multi-tenant, replica, read/write split 환경에서는 metadata write가 항상 primary로 향해야 합니다.

## ORM별 주의점

- TypeORM: `DataSource`와 `EntityManager` 주입 경계를 구분하고, global manager를 긴 job 전체에 공유하지 않습니다.
- MikroORM: `EntityManager.fork()`와 request context 의존성을 확인하고, worker execution마다 명확한 unit of work를 둡니다.
- Prisma: `PrismaClient`와 transaction client의 수명을 구분하고, interactive transaction timeout에 긴 batch execution을 넣지 않습니다.

## Testing

- adapter contract test는 ORM별 구현이 `core` contract를 동일하게 만족하는지 검증합니다.
- Nest integration test는 provider registration, lifecycle shutdown, multiple connection/client 이름을 확인합니다.
- transaction test는 writer 실패, checkpoint rollback, retry 후 성공, cancellation을 포함합니다.
- migration test는 fresh database와 upgrade path를 모두 검증합니다.
- mock ORM client만으로 durable behavior를 검증했다고 주장하지 않습니다.

## 출력 기대치

결과는 지원할 ORM package, peer dependency, Nest DI 방식, transaction boundary, migration 책임, 실패/restart 의미, 검증할 테스트 범위를 함께 설명해야 합니다.
