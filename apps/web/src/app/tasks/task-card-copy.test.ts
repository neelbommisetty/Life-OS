import { describe, expect, test } from "bun:test";
import { getTaskCardActionLabels } from "./task-card-copy";

describe("getTaskCardActionLabels", () => {
  test("builds task-specific action labels for accessible controls", () => {
    expect(getTaskCardActionLabels("Weekly planning")).toEqual({
      edit: "Edit Weekly planning",
      move: "Move Weekly planning",
      delete: "Delete Weekly planning",
    });
  });
});
