import { describe, expect, test } from "bun:test";
import { applyMiddleware } from "./core/middleware";
import {
  appDescription,
  buildCoreBrandPrompt,
  defaultBrandTerms,
  defaultBrandTermStatus,
} from "./copy";

describe("packages/ai", () => {
  test("exports core helpers", () => {
    expect(typeof applyMiddleware).toBe("function");
  });

  test("exports copy helpers for prompt alignment", () => {
    expect(defaultBrandTerms.library).toBe("Library");
    expect(defaultBrandTermStatus.library).toBe("under_review");
    expect(appDescription).toContain("organizes tasks, notes, and conversations");
    expect(buildCoreBrandPrompt()).toContain(appDescription);
    expect(buildCoreBrandPrompt()).toContain("App text language:");
    expect(buildCoreBrandPrompt()).not.toContain("helpful AI assistant");
  });
});
