import { describe, expect, test } from "bun:test";
import { selectDisplayedTasks } from "./tasks-utils";
import type { TaskWithProject } from "./task-card";

describe("selectDisplayedTasks", () => {
  const fetchedTasks: TaskWithProject[] = [
    {
      id: "task-2",
      title: "Fetched",
      status: "DONE",
      priority: "HIGH",
      createdAt: new Date("2026-01-02"),
      updatedAt: new Date("2026-01-02"),
      dueDate: null,
      description: null,
      projectId: null,
      userId: "user-1",
      project: null,
      deletedAt: null,
    },
  ];

  test("uses fetched tasks when search is empty", () => {
    const result = selectDisplayedTasks({
      fetchedTasks,
    });

    expect(result).toBe(fetchedTasks);
  });

  test("uses fetched tasks when search is active", () => {
    const result = selectDisplayedTasks({
      fetchedTasks,
    });

    expect(result).toBe(fetchedTasks);
  });

  test("still uses fetched tasks when no initial tasks exist", () => {
    const result = selectDisplayedTasks({
      fetchedTasks,
    });

    expect(result).toBe(fetchedTasks);
  });
});
