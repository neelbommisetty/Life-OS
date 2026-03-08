import { describe, expect, test } from "bun:test";
import { getInitialNoteEditorPreviewMode } from "./note-editor-mode";

describe("getInitialNoteEditorPreviewMode", () => {
  test("starts the note editor in edit mode", () => {
    expect(getInitialNoteEditorPreviewMode()).toBe(false);
  });
});
