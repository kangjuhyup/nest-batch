# Reader Helper Hardening Plan

**Goal:** 현재 추가된 `SqlReaderDefinition`, `HttpReaderDefinition`, `FileReaderDefinition` 위에 실사용 helper를 단계적으로 얹는다. core는 Nest, ORM, database driver에 의존하지 않고, source별 restart/checkpoint 의미를 테스트로 고정한다.

**현재 기준:** reader definition 자동 변환, SQL/HTTP/File 기본 reader, close lifecycle 보장, read phase failureReason, SQL/HTTP/File restart e2e는 구현되어 있다.

## Global Constraints

- `@nest-batch/core`는 ORM과 database driver type을 직접 노출하지 않는다.
- File helper는 Node.js 표준 library 사용까지 허용하되, Nest provider나 request lifecycle에 의존하지 않는다.
- SQL dialect별 query builder는 `packages/postgres`, `packages/mysql`, `packages/mariadb` helper로 분리한다.
- checkpoint는 writer 성공 후 chunk boundary에서만 저장한다.
- helper 예제는 `examples/basic`과 `examples/nestjs` 중 최소 하나에서 e2e로 검증한다.
- 테스트 설명은 `English / 한국어` 형식을 유지한다.

## 단계

### 1. File Line Reader

목표:
- file path 또는 `AsyncIterable<string>` source에서 line 단위로 item을 읽는 helper를 추가한다.
- checkpoint는 line offset으로 저장한다.
- restart 시 이미 성공한 line을 건너뛴다.

API 후보:

```ts
const reader = createLineFileReader({
  path: "/var/log/app.log",
  encoding: "utf8",
  map(line, context) {
    return { line };
  }
});
```

검증:
- line offset restart
- `close()`가 stream/readline을 정리하는지
- reader failure가 read phase로 기록되는지

### 2. JSONL Reader

목표:
- line reader 위에 JSON parse helper를 얹는다.
- parse 실패는 read phase failure로 기록한다.
- 필요하면 `onInvalidLine` 정책은 이후 skip 정책과 연결한다.

API 후보:

```ts
const reader = createJsonlFileReader<UserEvent>({
  path: "./events.jsonl"
});
```

검증:
- JSONL restart
- invalid JSON failureReason
- large file을 배열로 올리지 않는 AsyncIterable 처리

### 3. HTTP JSON Page Reader

목표:
- `fetch`와 JSON response parsing boilerplate를 줄인다.
- `selectItems`, `selectNextPage`로 API shape 차이를 흡수한다.
- status code 실패는 read phase failure로 기록한다.

API 후보:

```ts
const reader = createJsonHttpReader({
  initialPage: "/users?limit=100",
  pageSize: 100,
  request(page, { signal }) {
    return fetch(page, { signal });
  },
  selectItems(body) {
    return body.data;
  },
  selectNextPage(body) {
    return body.next;
  }
});
```

검증:
- next page token restart
- non-2xx response failureReason
- `AbortSignal` 전달

### 4. SQL Cursor Reader

목표:
- offset 기반 SQL reader보다 안정적인 cursor 기반 SQL helper를 제공한다.
- core helper는 query 함수를 받는 generic cursor reader로 두고, dialect별 SQL 문자열 생성은 adapter package로 미룬다.

core API 후보:

```ts
const reader = createSqlCursorReader({
  pageSize: 100,
  query({ cursor, pageSize, signal }) {
    return pool.query("select * from users where id > $1 order by id limit $2", [
      cursor ?? "",
      pageSize
    ], { signal });
  },
  getCursor(row) {
    return row.id;
  }
});
```

adapter API 후보:

```ts
const reader = createPostgresCursorReader({
  pool,
  table: "users",
  cursorColumn: "id",
  pageSize: 100
});
```

검증:
- cursor checkpoint restart
- mutable table에서 offset reader보다 안전하다는 문서화
- Postgres/MySQL/MariaDB adapter별 integration test

## 권장 구현 순서

1. `createLineFileReader`
2. `createJsonlFileReader`
3. `createJsonHttpReader`
4. core `createSqlCursorReader`
5. adapter별 SQL cursor helper
