import { describe, expect, test } from "bun:test";
import { getProjectCreateFeedback } from "./project-create-page-utils";

describe("getProjectCreateFeedback", () => {
  test("returns idle guidance when the form is ready", () => {
    expect(getProjectCreateFeedback(false, null)).toEqual({
      tone: "idle",
      message: "Project opens right after creation.",
    });
  });

  test("returns pending guidance while the project is being created", () => {
    expect(getProjectCreateFeedback(true, null)).toEqual({
      tone: "pending",
      message: "Creating project...",
    });
  });

  test("prefers the inline error message when creation fails", () => {
    expect(
      getProjectCreateFeedback(true, "Project creation failed"),
    ).toEqual({
      tone: "error",
      message: "Project creation failed",
    });
  });
});
