export const isAbortError = (error: unknown): boolean => {
  return error instanceof Error && error.name === "AbortError";
};

export const errorToFailureReason = (error: unknown): string => {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  return "Unknown batch execution failure.";
};
