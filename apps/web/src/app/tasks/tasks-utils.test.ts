import { describe, expect, test } from "bun:test";
import { selectDisplayedTasks } from "./tasks-utils";
import type { TaskWithProject } from "./task-card";

describe("selectDisplayedTasks", () => {
  const initialTasks: TaskWithProject[] = [
    {
      id: "task-1",
      title: "Initial",
      status: "TODO",
      priority: "MEDIUM",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      dueDate: null,
      description: null,
      projectId: null,
      userId: "user-1",
      project: null,
      deletedAt: null,
    },
  ];

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

  test("uses initial tasks when search is empty", () => {
    const result = selectDisplayedTasks({
      search: "",
      initialTasks,
      fetchedTasks,
    });

    expect(result).toBe(initialTasks);
  });

  test("uses fetched tasks when search is active", () => {
    const result = selectDisplayedTasks({
      search: "test",
      initialTasks,
      fetchedTasks,
    });

    expect(result).toBe(fetchedTasks);
  });

  test("falls back to fetched tasks when there are no initial tasks", () => {
    const result = selectDisplayedTasks({
      search: "",
      initialTasks: [],
      fetchedTasks,
    });

    expect(result).toBe(fetchedTasks);
  });
});
