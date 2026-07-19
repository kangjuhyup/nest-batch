export const requireSignal = (signal: AbortSignal | undefined): AbortSignal => {
  if (signal) {
    return signal;
  }

  return new AbortController().signal;
};

export const delay = async (ms: number, signal: AbortSignal): Promise<void> => {
  signal.throwIfAborted();

  if (ms === 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const done = (): void => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const abort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      reject(createAbortError());
    };
    const timeout = setTimeout(done, ms);

    signal.addEventListener("abort", abort, { once: true });
  });
};

const createAbortError = (): Error => {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
};
