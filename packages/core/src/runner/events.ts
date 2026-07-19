import type { BatchEvent, BatchObserver } from "../types/index.js";

export const emitBatchEvent = async (
  observer: BatchObserver | undefined,
  event: BatchEvent
): Promise<void> => {
  try {
    await observer?.onBatchEvent(event);
  } catch {
    // Observability must not change batch execution semantics.
  }
};
