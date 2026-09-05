import { Inject } from "@nestjs/common";
import { defineChunkStep, skipItem } from "@rvkang/batch-core";
import type { Processor, Reader, ReaderSession, Writer } from "@rvkang/batch-core";
import { BatchContextAccessor, BatchProcessor, BatchReader, BatchWriter } from "@rvkang/batch-nest";
import type {
  BillingAccount,
  BillingCharge,
  BillingCheckpoint,
  BillingJobParameters,
  BillingStepDefinition
} from "./billing.types.js";

export const writtenCharges: BillingCharge[] = [];

@BatchReader("charge-accounts-reader")
export class ChargeAccountsReader implements Reader<BillingAccount, BillingCheckpoint, BillingJobParameters> {
  constructor(@Inject(BatchContextAccessor) private readonly batchContext: BatchContextAccessor) {}

  open(): ReaderSession<BillingAccount, BillingCheckpoint> {
    const parameters = this.batchContext.getRequiredParameters<BillingJobParameters>();
    const checkpoint = this.batchContext.getCheckpoint<BillingCheckpoint>();
    const signal = this.batchContext.getRequiredSignal();
    const { tenant } = parameters;
    const accounts: readonly BillingAccount[] = [
      { id: `${tenant}-account-1`, tenant, status: "active", amount: 1200 },
      { id: `${tenant}-account-2`, tenant, status: "paused", amount: 9900 }
    ];
    let nextIndex = checkpoint?.nextIndex ?? 0;

    return {
      async *[Symbol.asyncIterator]() {
        for (let index = nextIndex; index < accounts.length; index += 1) {
          signal.throwIfAborted();
          nextIndex = index + 1;
          yield accounts[index]!;
        }
      },
      checkpoint() {
        return { nextIndex };
      }
    };
  }
}

@BatchProcessor("charge-accounts-processor")
export class ChargeAccountsProcessor
  implements Processor<BillingAccount, BillingCharge, BillingCheckpoint, BillingJobParameters> {
  constructor(@Inject(BatchContextAccessor) private readonly batchContext: BatchContextAccessor) {}

  process(account: BillingAccount) {
    const parameters = this.batchContext.getRequiredParameters<BillingJobParameters>();

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
export class BillingChargeWriter implements Writer<BillingCharge, BillingCheckpoint, BillingJobParameters> {
  write(charges: readonly BillingCharge[]) {
    writtenCharges.push(...charges);
  }
}

export const createChargeAccountsStep = (
  reader: ChargeAccountsReader,
  processor: ChargeAccountsProcessor,
  writer: BillingChargeWriter
): BillingStepDefinition =>
  defineChunkStep<BillingAccount, BillingCharge, BillingCheckpoint, BillingJobParameters>({
    name: "charge-accounts",
    chunkSize: 50,
    reader,
    processor,
    writer
  });
