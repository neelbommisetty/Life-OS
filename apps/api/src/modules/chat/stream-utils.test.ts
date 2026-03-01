import { describe, expect, test } from "bun:test";
import { buildSystemPrompt } from "./stream-utils";

describe("chat stream utils", () => {
  test("uses the aligned brand prompt contract", () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain(
      "Life-OS organizes tasks, notes, and conversations into a clear plan you can review and act on.",
    );
    expect(prompt).toContain("App text language:");
    expect(prompt).toContain("Brand persona:");
    expect(prompt).toContain("Use stable terms: Assistant, Inbox, Library, Plan.");
    expect(prompt).not.toContain("helpful AI assistant");
    expect(prompt).not.toContain("personal productivity platform");
  });
});
