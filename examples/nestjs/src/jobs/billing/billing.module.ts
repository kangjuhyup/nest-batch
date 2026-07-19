import { Module } from "@nestjs/common";
import { BillingJob } from "./billing.job.js";
import { chargeAccountsStep } from "./billing.step.js";
import { BILLING_CHARGE_ACCOUNTS_STEP } from "./billing.tokens.js";

@Module({
  providers: [
    BillingJob,
    {
      provide: BILLING_CHARGE_ACCOUNTS_STEP,
      useValue: chargeAccountsStep
    }
  ],
  exports: [BillingJob, BILLING_CHARGE_ACCOUNTS_STEP]
})
export class BillingModule {}
