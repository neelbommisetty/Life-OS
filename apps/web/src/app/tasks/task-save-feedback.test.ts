import { describe, expect, test } from "bun:test";
import { getTaskSaveSuccessMessage } from "./task-save-feedback";

describe("getTaskSaveSuccessMessage", () => {
  test("returns the create confirmation", () => {
    expect(getTaskSaveSuccessMessage(false)).toBe("Task created.");
  });

  test("returns the update confirmation", () => {
    expect(getTaskSaveSuccessMessage(true)).toBe("Task updated.");
  });
});
