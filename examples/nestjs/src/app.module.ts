import { Module } from "@nestjs/common";
import { NestBatchModule } from "@nest-batch/nest";
import { BillingModule } from "./jobs/billing/billing.module.js";

@Module({
  imports: [NestBatchModule.forRoot(), BillingModule]
})
export class AppModule {}
