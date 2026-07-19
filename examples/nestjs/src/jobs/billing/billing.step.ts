import { defineChunkStep, skipItem } from "@nest-batch/core";
import type { BillingAccount, BillingCharge } from "./billing.types.js";

export const writtenCharges: BillingCharge[] = [];

export const chargeAccountsStep = defineChunkStep<BillingAccount, BillingCharge>({
  name: "charge-accounts",
  chunkSize: 50,
  reader: async function* ({ signal }) {
    signal.throwIfAborted();
    yield { id: "account-1", status: "active", amount: 1200 };
    yield { id: "account-2", status: "paused", amount: 9900 };
  },
  processor(account) {
    if (account.status !== "active") {
      return skipItem("account is not chargeable");
    }

    return {
      accountId: account.id,
      amount: account.amount
    };
  },
  writer(charges) {
    writtenCharges.push(...charges);
  }
});
