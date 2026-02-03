import { describe, expect, test } from "bun:test";
import { getMessageCopyText } from "./message-actions";

describe("getMessageCopyText", () => {
  test("returns raw markdown content unchanged", () => {
    const content = "Hello **world**\n- item";
    expect(getMessageCopyText(content)).toBe(content);
  });
});
