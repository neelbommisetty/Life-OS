import { describe, expect, test } from "bun:test";
import { getNoteSelectorActionLabels } from "./note-selector-actions";

describe("getNoteSelectorActionLabels", () => {
  test("builds the delete label from the visible note title", () => {
    expect(getNoteSelectorActionLabels("Meeting notes")).toEqual({
      delete: "Delete Meeting notes",
    });
  });

  test("falls back when the note title is blank", () => {
    expect(getNoteSelectorActionLabels("   ")).toEqual({
      delete: "Delete Untitled note",
    });
  });
});
