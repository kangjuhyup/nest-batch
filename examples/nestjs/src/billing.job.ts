import { BatchJob, BatchStep } from "@nest-batch/nest";

@BatchJob("daily-billing")
export class BillingJob {
  @BatchStep("charge-accounts")
  async chargeAccounts(): Promise<void> {
    return undefined;
  }
}
