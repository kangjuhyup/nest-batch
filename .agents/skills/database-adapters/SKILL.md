---
name: database-adapters
description: nest-batch 저장소에서 Postgres, MySQL, MariaDB 같은 SQL database persistence adapter, dialect, schema, migration, repository, checkpoint, lock 구현을 설계하거나 검토할 때 사용한다.
---

# Database Adapters

## Overview

`nest-batch`의 persistence adapter를 특정 database에 묶이지 않게 설계하기 위한 기준입니다. SQL adapter는 durable execution의 source of truth를 제공하지만, `@nest-batch/core`에 database client나 dialect 세부사항을 노출하지 않습니다.

## 확인할 입력

작업 전에 필요한 범위만 확인합니다.

- `packages/core/src/types.ts`와 public export
- 기존 SQL adapter package의 `src/`, `test/`, `package.json`
- 대상 database: Postgres, MySQL, MariaDB
- repository, checkpoint, lock, migration 요구사항
- transaction, isolation, retry/restart에 영향을 주는 테스트

## Package Boundary

- `packages/postgres`: Postgres 전용 repository, checkpoint, lock, migration.
- `packages/mysql`: MySQL 전용 repository, checkpoint, lock, migration.
- `packages/mariadb`: MariaDB 전용 repository, checkpoint, lock, migration.
- 공통 SQL helper는 실제 중복이 생긴 뒤 `packages/sql-*` 같은 내부 package로 분리합니다.
- `core`에는 `JobRepository`, `CheckpointStore`, `LockManager` 같은 contract만 둡니다.
- connection string, pool, schema/database, table prefix, migration option은 adapter package option에 둡니다.

MySQL과 MariaDB는 wire protocol이 비슷해도 public package는 분리해서 사용자가 지원 범위를 명확히 알 수 있게 합니다. 구현 공유는 내부 helper로 처리하고, public option은 engine별 차이를 숨기지 않습니다.

## Dialect Checklist

- Transaction boundary가 chunk 성공, checkpoint 저장, status 갱신 순서와 맞는가.
- `upsert`, JSON column, timestamp precision, timezone 저장 방식이 engine별로 명확한가.
- `SELECT ... FOR UPDATE`, `SKIP LOCKED`, advisory lock 또는 named lock 동작 차이를 확인했는가.
- isolation level이 중복 execution 방지와 stale lock 회수에 충분한가.
- schema와 database 개념을 섞지 않았는가. Postgres `schema`와 MySQL/MariaDB `database`는 별도 option으로 다룹니다.
- migration이 idempotent하고 adapter version upgrade 경로를 남기는가.

## Runtime Semantics

- repository 상태가 queue나 scheduler보다 우선하는 source of truth입니다.
- checkpoint는 성공적으로 처리된 경계 이후에만 저장합니다.
- writer 부분 성공 가능성이 있으면 idempotency key 전략을 API와 문서에 드러냅니다.
- lock에는 owner, acquiredAt, expiresAt 또는 heartbeat가 필요합니다.
- crash 이후 stale lock 회수는 명시 정책으로 둡니다.
- 긴 실행 전체를 하나의 DB transaction으로 묶지 않습니다.

## Testing

adapter 테스트는 contract test와 engine-specific test를 나눕니다.

- 공통 contract: create/update/find, checkpoint read/write/delete, lock acquire/release/expire.
- 실패 의미: duplicate execution, writer 실패 후 restart, checkpoint부터 재시작.
- 동시성: lock collision, stale lock recovery, transaction rollback.
- engine matrix: Postgres, MySQL, MariaDB의 SQL 차이를 실제 database 또는 container로 검증합니다.
- unit test만으로 lock과 isolation을 검증했다고 주장하지 않습니다.

## 출력 기대치

결과는 어떤 package에 둘지, engine별 option 차이, transaction/lock 의미, checkpoint/restart 영향, 필요한 contract test와 integration test를 함께 설명해야 합니다.
