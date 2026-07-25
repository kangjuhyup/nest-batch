import { Inject } from "@nestjs/common";
import type { ChunkStepDefinition } from "@nest-batch/core";
import { BatchJob, BatchStep } from "@nest-batch/nest";
import { BILLING_CHARGE_ACCOUNTS_STEP } from "./billing.tokens.js";
import type { BillingAccount, BillingCharge, BillingJobParameters } from "./billing.types.js";

@BatchJob("daily-billing")
export class BillingJob {
  constructor(
    @Inject(BILLING_CHARGE_ACCOUNTS_STEP)
    private readonly chargeAccountsStep: ChunkStepDefinition<BillingAccount, BillingCharge, unknown, BillingJobParameters>
  ) {}

  @BatchStep("charge-accounts")
  chargeAccounts(): ChunkStepDefinition<BillingAccount, BillingCharge, unknown, BillingJobParameters> {
    return this.chargeAccountsStep;
  }
}
