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

See `docs/architecture.md` for package boundaries and runtime constraints.
