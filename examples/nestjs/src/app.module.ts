import { Module } from "@nestjs/common";
import { InMemoryBatchStorage } from "@nest-batch/inmemory";
import { NestBatchModule } from "@nest-batch/nest";
import { BillingModule } from "./jobs/billing/billing.module.js";

@Module({
  imports: [NestBatchModule.forRoot({ storage: new InMemoryBatchStorage() }), BillingModule]
})
export class AppModule {}
