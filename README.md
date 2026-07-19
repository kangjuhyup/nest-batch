# nest-batch

`nest-batch` is a Node-native batch framework project for the NestJS ecosystem.

This repository is currently in scaffold stage. The package boundaries and
public entry points are present, but durable execution, persistence, distributed
workers, and production scheduling are not implemented yet.

## Packages

- `@nest-batch/core`: framework-independent job and step contracts.
- `@nest-batch/nest`: NestJS module and decorator integration.
- `@nest-batch/postgres`: Postgres adapter boundary for repository, lock, and checkpoint storage.
- `@nest-batch/mysql`: MySQL adapter boundary for repository, lock, and checkpoint storage.
- `@nest-batch/mariadb`: MariaDB adapter boundary for repository, lock, and checkpoint storage.
- `@nest-batch/cli`: operational CLI boundary.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Core Example

```ts
import { defineJob, defineStep } from "@nest-batch/core";

const step = defineStep({
  name: "load-users",
  async execute({ signal }) {
    signal.throwIfAborted();
    return "loaded";
  }
});

export const job = defineJob({
  name: "daily-user-import",
  steps: [step]
});
```

## Chunk Step Example

`defineChunkStep`은 item을 streaming으로 읽고, optional processor를 거친 뒤,
writer에 chunk 단위로 전달합니다. `null`과 `undefined`는 유효한 output이며,
skip은 `skipItem()`으로만 명시합니다.

```ts
import { defineChunkStep, skipItem } from "@nest-batch/core";

export const importUsers = defineChunkStep({
  name: "import-users",
  chunkSize: 100,
  reader: async function* ({ signal }) {
    signal.throwIfAborted();
    yield { id: "user-1", active: true };
  },
  processor(user) {
    if (!user.active) {
      return skipItem("inactive user");
    }

    return { id: user.id };
  },
  async writer(users) {
    await saveUsers(users);
  }
});
```

See `docs/architecture.md` for package boundaries and runtime constraints.
