import { Module } from "@nestjs/common";
import { NestBatchModule } from "@nest-batch/nest";
import { exampleBatchStorage } from "./infrastructure/batch/example-batch-storage.js";
import { BillingModule } from "./jobs/billing/billing.module.js";

@Module({
  imports: [NestBatchModule.forRoot({ storage: exampleBatchStorage }), BillingModule]
})
export class AppModule {}
