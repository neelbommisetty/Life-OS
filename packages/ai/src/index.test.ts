import { describe, expect, test } from "bun:test";
import { applyMiddleware } from "./core/middleware";

describe("packages/ai", () => {
  test("exports core helpers", () => {
    expect(typeof applyMiddleware).toBe("function");
  });
});
