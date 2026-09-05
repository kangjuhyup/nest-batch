import type { ChunkStepDefinition, JobParameters } from "@rv-nest-batch/core";

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

export interface BillingCheckpoint {
  readonly nextIndex: number;
}

export type BillingJobParameters = JobParameters & {
  readonly tenant: string;
  readonly run?: string;
};

export type BillingStepDefinition = ChunkStepDefinition<
  BillingAccount,
  BillingCharge,
  BillingCheckpoint,
  BillingJobParameters
>;
