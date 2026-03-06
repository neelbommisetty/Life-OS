import { describe, expect, test } from "bun:test";
import { getTaskEditorSummary } from "./task-editor-utils";

describe("getTaskEditorSummary", () => {
  test("builds status, priority, and deadline summary text for the task editor", () => {
    const dated = getTaskEditorSummary({
      status: "IN_PROGRESS",
      priority: "HIGH",
      dueDate: "2026-04-12",
    });

    expect(dated.selectedStatus).toEqual({
      label: "In progress",
      hint: "Active now",
    });
    expect(dated.selectedPriority).toEqual({
      label: "High",
      hint: "Needs attention",
    });
    expect(dated.dueDateLabel).toBe("Apr 12, 2026");
    expect(dated.summaryText).toBe(
      "Active now. Needs attention. Due Apr 12, 2026.",
    );

    const undated = getTaskEditorSummary({
      status: "TODO",
      priority: "LOW",
      dueDate: "",
    });

    expect(undated.dueDateLabel).toBe("No deadline");
    expect(undated.summaryText).toBe(
      "Queued up. Can wait. Add a deadline if timing matters.",
    );
  });
});
