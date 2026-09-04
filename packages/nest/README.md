# @nest-batch/nest

NestJS module, decorator discovery, and runtime integration for `nest-batch`.

## Install

```bash
pnpm add @nest-batch/nest
pnpm add @nest-batch/inmemory @nestjs/common @nestjs/core reflect-metadata
```

`@nestjs/common`, `@nestjs/core`, and `reflect-metadata` are peer dependencies.

## Configure a module

```ts
import { Module } from "@nestjs/common";
import { InMemoryBatchStorage } from "@nest-batch/inmemory";
import { BatchJob, BatchStep, NestBatchModule } from "@nest-batch/nest";

@BatchJob("hello")
class HelloJob {
  @BatchStep("log")
  async log(): Promise<string> {
    return "done";
  }
}

@Module({
  imports: [NestBatchModule.forRoot({ storage: new InMemoryBatchStorage() })],
  providers: [HelloJob]
})
export class AppModule {}
```

`InMemoryBatchStorage` is non-durable; use a SQL storage adapter when execution
history, checkpoints, restart, or multi-process coordination must survive a
process restart. Make writer side effects idempotent for at-least-once work.

## Links

- [Repository](https://github.com/kangjuhyup/nest-batch)
- [Issues](https://github.com/kangjuhyup/nest-batch/issues)

## License

[MIT](https://github.com/kangjuhyup/nest-batch/blob/main/LICENSE)
