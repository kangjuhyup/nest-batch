import { Inject } from "@nestjs/common";
import { defineChunkStep, skipItem } from "@nest-batch/core";
import type { Processor, Reader, ReaderSession, Writer } from "@nest-batch/core";
import { BatchContextAccessor, BatchProcessor, BatchReader, BatchWriter } from "@nest-batch/nest";
import type {
  BillingAccount,
  BillingCharge,
  BillingJobParameters,
  BillingStepDefinition
} from "./billing.types.js";

export const writtenCharges: BillingCharge[] = [];

type BillingReader = Reader<BillingAccount, unknown, BillingJobParameters>;
type BillingProcessor = Processor<BillingAccount, BillingCharge, unknown, BillingJobParameters>;
type BillingWriter = Writer<BillingCharge, unknown, BillingJobParameters>;

@BatchReader("charge-accounts-reader")
export class ChargeAccountsReader implements BillingReader {
  constructor(@Inject(BatchContextAccessor) private readonly batchContext: BatchContextAccessor) {}

  open(): ReaderSession<BillingAccount> {
    const parameters = this.batchContext.getRequiredParameters<BillingJobParameters>();
    const signal = this.batchContext.getRequiredSignal();
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
export class ChargeAccountsProcessor implements BillingProcessor {
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
export class BillingChargeWriter implements BillingWriter {
  write(charges: readonly BillingCharge[]) {
    writtenCharges.push(...charges);
  }
}

export const createChargeAccountsStep = (
  reader: BillingReader,
  processor: BillingProcessor,
  writer: BillingWriter
): BillingStepDefinition =>
  defineChunkStep({
    name: "charge-accounts",
    chunkSize: 50,
    reader,
    processor,
    writer
  });
