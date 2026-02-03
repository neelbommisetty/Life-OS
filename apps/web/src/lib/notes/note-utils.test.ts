import { describe, test, expect } from "bun:test";
import { deriveNoteTitle } from "./note-utils";

describe("deriveNoteTitle", () => {
  test("uses the first non-empty line", () => {
    const content = "\n\nFirst line\nSecond line";
    expect(deriveNoteTitle(content)).toBe("First line");
  });

  test("falls back when content is empty", () => {
    expect(deriveNoteTitle("\n\n")).toBe("Saved from chat");
  });

  test("clamps to 500 chars", () => {
    const long = "A".repeat(600);
    expect(deriveNoteTitle(long).length).toBe(500);
  });
});
