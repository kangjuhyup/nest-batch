import { Inject } from "@nestjs/common";
import { BatchJob, BatchStep } from "@rv-nest-batch/nest";
import { BILLING_CHARGE_ACCOUNTS_STEP } from "./billing.tokens.js";
import type { BillingStepDefinition } from "./billing.types.js";

@BatchJob("daily-billing")
export class BillingJob {
  constructor(
    @Inject(BILLING_CHARGE_ACCOUNTS_STEP)
    private readonly chargeAccountsStep: BillingStepDefinition
  ) {}

  @BatchStep("charge-accounts")
  chargeAccounts(): BillingStepDefinition {
    return this.chargeAccountsStep;
  }
}
