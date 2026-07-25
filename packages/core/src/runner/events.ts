import type {
  BatchEvent,
  BatchEventListenerRegistration,
  BatchObserver
} from "../types/index.js";

export const emitBatchEvent = async (
  observer: BatchObserver | undefined,
  event: BatchEvent,
  listeners: readonly BatchEventListenerRegistration[] = []
): Promise<void> => {
  try {
    await observer?.onBatchEvent(event);
  } catch {
    // Observability must not change batch execution semantics.
  }

  for (const registration of listeners) {
    if (registration.type !== undefined && registration.type !== event.type) {
      continue;
    }

    try {
      await registration.listener(event);
    } catch {
      // Job-level listeners follow observer semantics and must not alter execution state.
    }
  }
};
