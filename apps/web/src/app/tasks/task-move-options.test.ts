import { describe, expect, test } from "bun:test";
import { getTaskMoveOptions } from "./task-move-options";

describe("getTaskMoveOptions", () => {
  test("omits the current status and exposes the remaining move targets", () => {
    expect(getTaskMoveOptions("IN_PROGRESS")).toEqual([
      { status: "TODO", label: "Move to To Do" },
      { status: "DONE", label: "Move to Done" },
    ]);
  });
});
