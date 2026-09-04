import { describe, expect, it } from "vitest";
import { createConsumerTsconfig } from "./smoke-packages.mjs";

describe("consumer smoke TypeScript configuration / consumer smoke TypeScript 설정", () => {
  it("enables strict NodeNext declaration checking / strict NodeNext declaration 검사를 사용한다", () => {
    const tsconfig = createConsumerTsconfig();

    expect(tsconfig.compilerOptions).toMatchObject({
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true
    });
    expect(tsconfig.compilerOptions).not.toHaveProperty("skipLibCheck");
  });
});
