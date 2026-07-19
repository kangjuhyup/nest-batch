import { describe, expect, it } from "vitest";
import { BatchJob, BatchStep, NestBatchModule } from "../src/index.js";

describe("nest package exports / nest package export를 검증한다", () => {
  it("creates a dynamic module with options provider / options provider가 있는 dynamic module을 생성한다", () => {
    const dynamicModule = NestBatchModule.forRoot({ defaultTimeoutMs: 5000 });

    expect(dynamicModule.module).toBe(NestBatchModule);
    expect(dynamicModule.providers).toHaveLength(1);
    expect(dynamicModule.exports).toHaveLength(1);
  });

  it("exports decorator factories / decorator factory를 export한다", () => {
    expect(typeof BatchJob("daily-billing")).toBe("function");
    expect(typeof BatchStep("charge-account")).toBe("function");
  });
});
