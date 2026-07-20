# Performance Test Results / 성능 테스트 결과

이 문서는 `nest-batch` 성능 테스트 실행 결과를 기록합니다. 숫자는 특정 장비와
실행 시점의 baseline이며, 절대 성능 보장값이 아닙니다. 같은 scenario를 같은
환경에서 반복 실행했을 때의 변화 추이를 regression 판단에 사용합니다.

## 기록 절차

성능 테스트를 실행한 뒤 아래 정보를 새 section으로 남깁니다.

- 실행 날짜와 timezone
- git revision과 uncommitted 변경 포함 여부
- 실행 command
- 주요 환경: Node.js, Vitest, OS, CPU
- test parameter: item count, chunk size, DB URL/schema/table prefix처럼 결과에 영향을 주는 값
- 결과 table
- 해석 시 주의할 점

core runtime perf test는 normal unit test에서 제외되며 다음처럼 실행합니다.

```bash
./node_modules/.bin/vitest run --config vitest.perf.config.ts packages/core/test/performance-baseline.perf.test.ts
```

## 2026-07-20 Core Runtime Baseline

- 실행 시각: `2026-07-20 20:00:23 KST`
- git revision: `2735fb1` + uncommitted Task 1 performance baseline changes
- command: `./node_modules/.bin/vitest run --config vitest.perf.config.ts packages/core/test/performance-baseline.perf.test.ts`
- test file: `packages/core/test/performance-baseline.perf.test.ts`
- storage: `InMemoryBatchStorage`
- Node.js: `v24.11.0`
- Vitest: `2.1.9`
- OS: `Darwin 24.1.0 arm64`
- CPU: `Apple M2`, 8 logical cores
- `NEST_BATCH_PERF_ITEMS`: default, `10000`
- `NEST_BATCH_PERF_CHUNK_SIZE`: default, `100`

| Scenario | Items | Chunk Size | Chunks | Duration Ms | Items Per Second | Read Count | Write Count | Skip Count | Retry Count | Checkpoint Writes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `chunk-throughput` | 10000 | 100 | 100 | 14.02 | 713324.00 | 10000 | 10000 | 0 | 0 | 0 |
| `checkpoint-overhead` | 10000 | 100 | 100 | 4.64 | 2153509.01 | 10000 | 10000 | 0 | 0 | 100 |
| `retry-skip-overhead` | 10000 | 100 | 100 | 5.53 | 1808509.25 | 10000 | 9991 | 9 | 1 | 100 |

주의:

- 단일 짧은 실행이므로 Node.js JIT, warm cache, 실행 순서 영향을 받습니다.
- 위 결과에서는 `checkpoint-overhead`가 `chunk-throughput`보다 빠르게 나왔지만,
  이는 scenario 간 절대 비교값으로 해석하지 않습니다.
- regression 판단은 같은 command와 parameter로 같은 scenario를 여러 번 실행한
  결과의 변화폭을 봅니다.
