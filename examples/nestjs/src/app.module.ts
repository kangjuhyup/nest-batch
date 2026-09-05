import { Module } from "@nestjs/common";
import { InMemoryBatchStorage } from "@rvkang/batch-inmemory";
import { NestBatchModule, NestBatchPollingModule } from "@rvkang/batch-nest";
import { BillingModule } from "./jobs/billing/billing.module.js";
import { ReaderExamplesModule } from "./jobs/reader-examples/reader-examples.module.js";
import {
  IntegrationEventOutboxDispatcher,
  VoteOutboxModule
} from "./jobs/vote-outbox/vote-outbox.module.js";

@Module({
  imports: [
    NestBatchModule.forRoot({ storage: new InMemoryBatchStorage() }),
    NestBatchPollingModule.forRootAsync({
      imports: [VoteOutboxModule],
      inject: [IntegrationEventOutboxDispatcher],
      useFactory: (outboxDispatcher: IntegrationEventOutboxDispatcher) => ({
        pollingWorkers: [
          {
            workerId: process.env.VOTE_OUTBOX_WORKER_ID ?? "vote-outbox-worker-1",
            pollIntervalMs: 1_000,
            autoStart: process.env.NEST_BATCH_PROCESS_ROLE === "vote-outbox-worker",
            task: async ({ workerId, signal }) => {
              const { claimedCount } = await outboxDispatcher.dispatchBatch({
                workerId,
                signal
              });

              return claimedCount > 0;
            }
          }
        ]
      })
    }),
    BillingModule,
    ReaderExamplesModule
  ]
})
export class AppModule {}
