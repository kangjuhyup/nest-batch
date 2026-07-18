import { describe, expect, it } from "vitest";
import { BatchJob, BatchStep, NestBatchModule } from "../src/index.js";

describe("nest package exports", () => {
  it("creates a dynamic module with options provider", () => {
    const dynamicModule = NestBatchModule.forRoot({ defaultTimeoutMs: 5000 });

    expect(dynamicModule.module).toBe(NestBatchModule);
    expect(dynamicModule.providers).toHaveLength(1);
    expect(dynamicModule.exports).toHaveLength(1);
  });

  it("exports decorator factories", () => {
    expect(typeof BatchJob("daily-billing")).toBe("function");
    expect(typeof BatchStep("charge-account")).toBe("function");
  });
});
