import { defineChunkStep, skipItem } from "@nest-batch/core";
import type { ChunkProcessor, ChunkReader, ChunkWriter } from "@nest-batch/core";
import type { BillingAccount, BillingCharge } from "./billing.types.js";

export const writtenCharges: BillingCharge[] = [];

const chargeAccountsReader: ChunkReader<BillingAccount> = async function* ({ signal }) {
  signal.throwIfAborted();
  yield { id: "account-1", status: "active", amount: 1200 };
  yield { id: "account-2", status: "paused", amount: 9900 };
};

const chargeAccountsProcessor: ChunkProcessor<BillingAccount, BillingCharge> = (account) => {
  if (account.status !== "active") {
    return skipItem("account is not chargeable");
  }

  return {
    accountId: account.id,
    amount: account.amount
  };
};

const chargeAccountsWriter: ChunkWriter<BillingCharge> = (charges) => {
  writtenCharges.push(...charges);
};

export const chargeAccountsStep = defineChunkStep<BillingAccount, BillingCharge>({
  name: "charge-accounts",
  chunkSize: 50,
  reader: chargeAccountsReader,
  processor: chargeAccountsProcessor,
  writer: chargeAccountsWriter
});
