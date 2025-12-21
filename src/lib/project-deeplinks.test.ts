import { describe, expect, test } from "bun:test";
import { resolveTasksViewParam } from "@/lib/project-deeplinks";

describe("project deeplinks > resolveTasksViewParam", () => {
  test("defaults to kanban for missing or invalid values", () => {
    expect(resolveTasksViewParam(null)).toBe("kanban");
    expect(resolveTasksViewParam("invalid")).toBe("kanban");
  });

  test("normalizes valid views", () => {
    expect(resolveTasksViewParam("Backlog")).toBe("backlog");
    expect(resolveTasksViewParam(" archived ")).toBe("archived");
  });
});
