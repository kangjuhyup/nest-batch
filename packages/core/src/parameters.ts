import { createHash } from "node:crypto";
import type { JobInstanceId, JobParameters, JobParametersHash } from "./types/index.js";

export const hashJobParameters = (parameters: JobParameters): JobParametersHash => {
  return `sha256:${sha256(stableStringify(parameters))}`;
};

export const createJobInstanceId = (
  jobName: string,
  parametersHash: JobParametersHash
): JobInstanceId => {
  return `sha256:${sha256(stableStringify({ jobName, parametersHash }))}`;
};

const sha256 = (value: string): string => {
  return createHash("sha256").update(value).digest("hex");
};

const stableStringify = (value: unknown): string => {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Job parameters only support finite numbers.");
    }

    return JSON.stringify(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)
    );

    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",")}}`;
  }

  throw new TypeError("Job parameters only support JSON-serializable values.");
};
