import { describe, expect, test } from "bun:test";
import { getChatInputShortcutHint } from "./chat-input-copy";

describe("getChatInputShortcutHint", () => {
  test("describes the mac keyboard behavior", () => {
    expect(getChatInputShortcutHint(true)).toBe(
      "Enter to send. Shift + Enter for a new line. Cmd + Enter also works.",
    );
  });

  test("describes the non-mac keyboard behavior", () => {
    expect(getChatInputShortcutHint(false)).toBe(
      "Enter to send. Shift + Enter for a new line. Ctrl + Enter also works.",
    );
  });
});
