import { describe, expect, test } from "bun:test";
import { buildNoteSavePayload } from "./note-create-utils";

describe("buildNoteSavePayload", () => {
  test("preserves an explicit title", () => {
    expect(
      buildNoteSavePayload("Project plan", "First line\nSecond line"),
    ).toEqual({
      title: "Project plan",
      content: "First line\nSecond line",
    });
  });

  test("derives a title from the first non-empty content line", () => {
    expect(
      buildNoteSavePayload("", "\n\nKickoff notes\nSecond line"),
    ).toEqual({
      title: "Kickoff notes",
      content: "\n\nKickoff notes\nSecond line",
    });
  });

  test("falls back to the shared note-title fallback when content is empty", () => {
    expect(buildNoteSavePayload("", "\n\n")).toEqual({
      title: "Saved from chat",
      content: "\n\n",
    });
  });
});
