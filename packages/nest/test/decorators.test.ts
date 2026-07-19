import "reflect-metadata";
import { describe, expect, it } from "vitest";
import {
  BATCH_JOB_METADATA,
  BATCH_PROCESSOR_METADATA,
  BATCH_READER_METADATA,
  BATCH_STEP_METADATA,
  BATCH_WRITER_METADATA,
  BatchJob,
  BatchProcessor,
  BatchReader,
  BatchStep,
  BatchWriter
} from "../src/index.js";

describe("decorators / decorator", () => {
  it("sets job metadata from string and options / string과 option으로 job metadata를 설정한다", () => {
    class DailyBillingJob {}
    class MonthlyBillingJob {}
    class AnonymousJob {}

    BatchJob("daily-billing")(DailyBillingJob);
    BatchJob({ name: "monthly-billing" })(MonthlyBillingJob);
    BatchJob()(AnonymousJob);

    expect(Reflect.getMetadata(BATCH_JOB_METADATA, DailyBillingJob)).toEqual({ name: "daily-billing" });
    expect(Reflect.getMetadata(BATCH_JOB_METADATA, MonthlyBillingJob)).toEqual({
      name: "monthly-billing"
    });
    expect(Reflect.getMetadata(BATCH_JOB_METADATA, AnonymousJob)).toEqual({});
  });

  it("sets step metadata from string and options / string과 option으로 step metadata를 설정한다", () => {
    class BillingJob {
      chargeAccounts() {}
      settleInvoices() {}
      copyInvoices() {}
    }

    const chargeDescriptor = Object.getOwnPropertyDescriptor(BillingJob.prototype, "chargeAccounts");
    const settleDescriptor = Object.getOwnPropertyDescriptor(BillingJob.prototype, "settleInvoices");
    const copyDescriptor = Object.getOwnPropertyDescriptor(BillingJob.prototype, "copyInvoices");

    if (!chargeDescriptor || !settleDescriptor || !copyDescriptor) {
      throw new Error("Step method descriptor was not found.");
    }

    BatchStep("charge-accounts")(BillingJob.prototype, "chargeAccounts", chargeDescriptor);
    BatchStep({ name: "settle-invoices" })(BillingJob.prototype, "settleInvoices", settleDescriptor);
    BatchStep()(BillingJob.prototype, "copyInvoices", copyDescriptor);

    expect(Reflect.getMetadata(BATCH_STEP_METADATA, chargeDescriptor.value)).toEqual({
      name: "charge-accounts"
    });
    expect(Reflect.getMetadata(BATCH_STEP_METADATA, settleDescriptor.value)).toEqual({
      name: "settle-invoices"
    });
    expect(Reflect.getMetadata(BATCH_STEP_METADATA, copyDescriptor.value)).toEqual({});
  });

  it("sets chunk component metadata from string and options / string과 option으로 chunk component metadata를 설정한다", () => {
    class UserReader {}
    class AccountProcessor {}
    class ChargeWriter {}
    class AnonymousReader {}
    class AnonymousProcessor {}
    class AnonymousWriter {}

    BatchReader("user-reader")(UserReader);
    BatchProcessor({ name: "account-processor" })(AccountProcessor);
    BatchWriter("charge-writer")(ChargeWriter);
    BatchReader()(AnonymousReader);
    BatchProcessor()(AnonymousProcessor);
    BatchWriter()(AnonymousWriter);

    expect(Reflect.getMetadata(BATCH_READER_METADATA, UserReader)).toEqual({ name: "user-reader" });
    expect(Reflect.getMetadata(BATCH_PROCESSOR_METADATA, AccountProcessor)).toEqual({
      name: "account-processor"
    });
    expect(Reflect.getMetadata(BATCH_WRITER_METADATA, ChargeWriter)).toEqual({ name: "charge-writer" });
    expect(Reflect.getMetadata(BATCH_READER_METADATA, AnonymousReader)).toEqual({});
    expect(Reflect.getMetadata(BATCH_PROCESSOR_METADATA, AnonymousProcessor)).toEqual({});
    expect(Reflect.getMetadata(BATCH_WRITER_METADATA, AnonymousWriter)).toEqual({});
    expect(Reflect.getMetadata(BATCH_READER_METADATA, ChargeWriter)).toBeUndefined();
  });
});
