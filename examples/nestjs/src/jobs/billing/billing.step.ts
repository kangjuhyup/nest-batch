import { defineChunkStep, skipItem } from "@nest-batch/core";
import type {
  ChunkStepDefinition,
  ChunkStepExecutionContext,
  Processor,
  Reader,
  ReaderSession,
  Writer
} from "@nest-batch/core";
import { BatchProcessor, BatchReader, BatchWriter } from "@nest-batch/nest";
import type { BillingAccount, BillingCharge } from "./billing.types.js";

export const writtenCharges: BillingCharge[] = [];

@BatchReader("charge-accounts-reader")
export class ChargeAccountsReader implements Reader<BillingAccount> {
  open({ signal }: ChunkStepExecutionContext): ReaderSession<BillingAccount> {
    return {
      async *[Symbol.asyncIterator]() {
        signal.throwIfAborted();
        yield { id: "account-1", status: "active", amount: 1200 };
        yield { id: "account-2", status: "paused", amount: 9900 };
      }
    };
  }
}

@BatchProcessor("charge-accounts-processor")
export class ChargeAccountsProcessor implements Processor<BillingAccount, BillingCharge> {
  process(account: BillingAccount) {
    if (account.status !== "active") {
      return skipItem("account is not chargeable");
    }

    return {
      accountId: account.id,
      amount: account.amount
    };
  }
}

@BatchWriter("billing-charge-writer")
export class BillingChargeWriter implements Writer<BillingCharge> {
  write(charges: readonly BillingCharge[]) {
    writtenCharges.push(...charges);
  }
}

export const createChargeAccountsStep = (
  reader: Reader<BillingAccount>,
  processor: Processor<BillingAccount, BillingCharge>,
  writer: Writer<BillingCharge>
): ChunkStepDefinition<BillingAccount, BillingCharge> =>
  defineChunkStep<BillingAccount, BillingCharge>({
    name: "charge-accounts",
    chunkSize: 50,
    reader,
    processor,
    writer
  });
