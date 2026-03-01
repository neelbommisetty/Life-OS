import { describe, expect, test } from "bun:test";
import {
  getMessageCopyText,
  getSaveAsNoteLabel,
  getSavedAsNoteLabel,
} from "./message-actions";

describe("getMessageCopyText", () => {
  test("returns raw markdown content unchanged", () => {
    const content = "Hello **world**\n- item";
    expect(getMessageCopyText(content)).toBe(content);
  });
});

describe("save label helpers", () => {
  test("uses note-specific save labels", () => {
    expect(getSaveAsNoteLabel()).toBe("Save as note");
    expect(getSavedAsNoteLabel()).toBe("Saved as note");
  });
});
