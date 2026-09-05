import { describe, expect, it } from "vitest";
import { ContinuousPollingLoop } from "@rvkang/batch-core/polling";

describe("core polling subpath exports / core polling subpath export를 검증한다", () => {
  it("exports the continuous polling loop / continuous polling loop를 export한다", () => {
    expect(ContinuousPollingLoop).toBeTypeOf("function");
  });
});
