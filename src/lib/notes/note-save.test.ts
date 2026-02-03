import { describe, test, expect } from "bun:test";
import { buildNoteFromMessage } from "./note-save";

describe("buildNoteFromMessage", () => {
  test("builds note data with derived title and project", () => {
    const result = buildNoteFromMessage({
      userId: "user_1",
      sourceMessageId: "msg_1",
      content: "Hello\nWorld",
      projectId: "proj_1",
    });

    expect(result).toEqual({
      userId: "user_1",
      sourceMessageId: "msg_1",
      title: "Hello",
      content: "Hello\nWorld",
      projectId: "proj_1",
    });
  });

  test("sets projectId to null when absent", () => {
    const result = buildNoteFromMessage({
      userId: "user_1",
      sourceMessageId: "msg_1",
      content: "Hello",
      projectId: null,
    });

    expect(result.projectId).toBe(null);
  });
});
