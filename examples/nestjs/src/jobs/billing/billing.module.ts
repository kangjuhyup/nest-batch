import { Module } from "@nestjs/common";
import { BillingJob } from "./billing.job.js";
import {
  BillingChargeWriter,
  ChargeAccountsProcessor,
  ChargeAccountsReader,
  createChargeAccountsStep
} from "./billing.step.js";
import { BILLING_CHARGE_ACCOUNTS_STEP } from "./billing.tokens.js";

@Module({
  providers: [
    BillingJob,
    ChargeAccountsReader,
    ChargeAccountsProcessor,
    BillingChargeWriter,
    {
      provide: BILLING_CHARGE_ACCOUNTS_STEP,
      useFactory: createChargeAccountsStep,
      inject: [ChargeAccountsReader, ChargeAccountsProcessor, BillingChargeWriter]
    }
  ],
  exports: [BillingJob, BILLING_CHARGE_ACCOUNTS_STEP]
})
export class BillingModule {}
