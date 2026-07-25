import { defineChunkStep, skipItem } from "@nest-batch/core";
import type {
  ChunkItemContext,
  ChunkStepDefinition,
  ChunkStepExecutionContext,
  Processor,
  Reader,
  ReaderSession,
  Writer
} from "@nest-batch/core";
import { BatchProcessor, BatchReader, BatchWriter } from "@nest-batch/nest";
import type { BillingAccount, BillingCharge, BillingJobParameters } from "./billing.types.js";

export const writtenCharges: BillingCharge[] = [];

@BatchReader("charge-accounts-reader")
export class ChargeAccountsReader implements Reader<BillingAccount, unknown, BillingJobParameters> {
  open({ parameters, signal }: ChunkStepExecutionContext<unknown, BillingJobParameters>): ReaderSession<BillingAccount> {
    const { tenant } = parameters;

    return {
      async *[Symbol.asyncIterator]() {
        signal.throwIfAborted();
        yield { id: `${tenant}-account-1`, tenant, status: "active", amount: 1200 };
        yield { id: `${tenant}-account-2`, tenant, status: "paused", amount: 9900 };
      }
    };
  }
}

@BatchProcessor("charge-accounts-processor")
export class ChargeAccountsProcessor implements Processor<BillingAccount, BillingCharge, unknown, BillingJobParameters> {
  process(account: BillingAccount, { parameters }: ChunkItemContext<BillingAccount, unknown, BillingJobParameters>) {
    if (account.status !== "active") {
      return skipItem("account is not chargeable");
    }

    return {
      tenant: parameters.tenant,
      accountId: account.id,
      amount: account.amount
    };
  }
}

@BatchWriter("billing-charge-writer")
export class BillingChargeWriter implements Writer<BillingCharge, unknown, BillingJobParameters> {
  write(charges: readonly BillingCharge[]) {
    writtenCharges.push(...charges);
  }
}

export const createChargeAccountsStep = (
  reader: Reader<BillingAccount, unknown, BillingJobParameters>,
  processor: Processor<BillingAccount, BillingCharge, unknown, BillingJobParameters>,
  writer: Writer<BillingCharge, unknown, BillingJobParameters>
): ChunkStepDefinition<BillingAccount, BillingCharge, unknown, BillingJobParameters> =>
  defineChunkStep<BillingAccount, BillingCharge, unknown, BillingJobParameters>({
    name: "charge-accounts",
    chunkSize: 50,
    reader,
    processor,
    writer
  });
