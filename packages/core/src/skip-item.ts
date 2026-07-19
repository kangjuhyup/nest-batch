export const SKIP_ITEM: unique symbol = Symbol("nest-batch.skip-item");

export interface SkipItem {
  readonly kind: "skip";
  readonly reason?: string;
  readonly cause?: unknown;
  readonly [SKIP_ITEM]: true;
}

export const skipItem = (reason?: string, cause?: unknown): SkipItem =>
  Object.freeze({
    kind: "skip",
    reason,
    cause,
    [SKIP_ITEM]: true
  });

export const isSkipItem = (value: unknown): value is SkipItem => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (value as { readonly [SKIP_ITEM]?: unknown })[SKIP_ITEM] === true;
};
