import type { ChunkStepDefinition, JobParameters } from "@nest-batch/core";

export interface BillingAccount {
  readonly id: string;
  readonly tenant: string;
  readonly status: "active" | "paused";
  readonly amount: number;
}

export interface BillingCharge {
  readonly tenant: string;
  readonly accountId: string;
  readonly amount: number;
}

export type BillingJobParameters = JobParameters & {
  readonly tenant: string;
  readonly run?: string;
};

export type BillingStepDefinition = ChunkStepDefinition<
  BillingAccount,
  BillingCharge,
  unknown,
  BillingJobParameters
>;
