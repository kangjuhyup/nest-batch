export interface WorkUnit<TPayload = unknown> {
  readonly id: string;
  readonly type?: string;
  readonly payload?: TPayload;
  readonly createdAt?: Date;
}

export interface WorkClaimOptions {
  readonly workerId: string;
  readonly now: Date;
  readonly signal?: AbortSignal;
}

export interface WorkQueue<TWork extends WorkUnit = WorkUnit> {
  enqueue(work: TWork): Promise<void>;
  claim(options: WorkClaimOptions): Promise<TWork | undefined>;
  complete(work: TWork): Promise<void>;
  fail(work: TWork, error: unknown): Promise<void>;
}
