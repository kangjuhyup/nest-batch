export interface BillingAccount {
  readonly id: string;
  readonly status: "active" | "paused";
  readonly amount: number;
}

export interface BillingCharge {
  readonly accountId: string;
  readonly amount: number;
}
