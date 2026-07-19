import { describe, expect, it } from "vitest";
import { defineJob, defineStep } from "../src/index.js";

describe("core definitions / core 정의", () => {
  it("defines a job with ordered steps without NestJS / NestJS 없이 순서가 있는 step으로 job을 정의한다", async () => {
    const step = defineStep({
      name: "load-users",
      async execute({ input }) {
        return String(input ?? "none");
      }
    });

    const job = defineJob({
      name: "daily-user-import",
      steps: [step]
    });

    await expect(step.execute({ input: 42, signal: new AbortController().signal })).resolves.toBe("42");
    expect(job.name).toBe("daily-user-import");
    expect(job.steps).toHaveLength(1);
    expect(job.steps[0]).toBe(step);
  });

  it("rejects jobs without steps / step이 없는 job을 거부한다", () => {
    expect(() => defineJob({ name: "empty-job", steps: [] })).toThrow(
      'Job "empty-job" must include at least one step.'
    );
  });

  it("rejects blank names / 비어 있는 이름을 거부한다", () => {
    expect(() =>
      defineStep({
        name: " ",
        async execute() {
          return undefined;
        }
      })
    ).toThrow("Step name is required.");
  });
});
