import { describe, expect, test } from "bun:test";
import { getTaskCardActionLabels } from "./task-card-copy";

describe("getTaskCardActionLabels", () => {
  test("builds task-specific action labels for accessible controls", () => {
    expect(getTaskCardActionLabels("Weekly planning")).toEqual({
      edit: "Edit Weekly planning",
      editCta: "Edit task",
      move: "Move Weekly planning",
      moveCta: "Move",
      delete: "Delete Weekly planning",
    });
  });
});
