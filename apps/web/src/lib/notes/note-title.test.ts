import { describe, expect, test } from "bun:test";
import { getNoteDisplayTitle } from "./note-title";

describe("getNoteDisplayTitle", () => {
  test("falls back when the note title is blank", () => {
    expect(getNoteDisplayTitle("")).toBe("Untitled note");
    expect(getNoteDisplayTitle("   ")).toBe("Untitled note");
    expect(getNoteDisplayTitle(null)).toBe("Untitled note");
  });

  test("returns the trimmed note title when present", () => {
    expect(getNoteDisplayTitle("  Weekly review  ")).toBe("Weekly review");
  });
});
