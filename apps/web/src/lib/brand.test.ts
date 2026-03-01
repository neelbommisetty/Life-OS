import { describe, expect, test } from "bun:test";
import { brand, couldnt } from "./brand";

describe("brand", () => {
  test("exposes canonical description and terminology status", () => {
    expect(brand.descriptions.app).toContain("organizes tasks, notes, and conversations");
    expect(brand.termStatus.library).toBe("under_review");
    expect(brand.terms.library).toBe("Library");
  });

  test("builds fallback error messages with optional detail", () => {
    expect(couldnt("save the note")).toBe("Couldn't save the note. Please try again.");
    expect(
      couldnt("save the note", {
        safeState: "Your edits are still saved locally",
        nextStep: "Try again in a moment",
      }),
    ).toBe(
      "Couldn't save the note. Your edits are still saved locally. Try again in a moment.",
    );
  });
});
