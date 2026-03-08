import { describe, expect, test } from "bun:test";
import { getTaskColumnEmptyStateMessage } from "./task-column-empty-state";

describe("getTaskColumnEmptyStateMessage", () => {
  test("keeps the empty state aligned with drag and menu-based movement", () => {
    expect(getTaskColumnEmptyStateMessage()).toBe(
      "Drag a task here or use Move on a card.",
    );
  });
});
