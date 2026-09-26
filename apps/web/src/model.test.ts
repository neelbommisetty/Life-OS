import { test } from "node:test";
import assert from "node:assert/strict";
import { baseTasks, sortTasks, addDays, dateLabel } from "./model.ts";
import type { Task } from "../../../packages/tools/src/contract.ts";
const task = (overrides: Partial<Task>): Task =>
  ({
    id: "tsk_a",
    title: "Task",
    status: "accepted",
    projectId: "prj_inbox",
    due: null,
    deletedAt: null,
    order: 0,
    createdAt: "2026-09-25T12:00:00Z",
    ...overrides,
  }) as Task;
test("today and upcoming include commitments, not proposals; completed and trash are distinct", () => {
  const tasks = [
    task({ id: "today", due: { date: "2026-09-25" } }),
    task({ id: "overdue", due: { date: "2026-09-24" } }),
    task({ id: "future", due: { date: "2026-10-01" } }),
    task({ id: "proposed", status: "proposed", due: { date: "2026-09-25" } }),
    task({ id: "done", status: "done" }),
    task({ id: "trash", deletedAt: "2026-09-25T12:00:00Z" }),
    task({ id: "undated" }),
  ];
  assert.deepEqual(
    baseTasks(tasks, "today", "2026-09-25").map((t) => t.id),
    ["today", "overdue"],
  );
  assert.deepEqual(
    baseTasks(tasks, "upcoming", "2026-09-25").map((t) => t.id),
    ["today", "overdue", "future"],
  );
  assert.deepEqual(
    baseTasks(tasks, "completed", "2026-09-25").map((t) => t.id),
    ["done"],
  );
  assert.deepEqual(
    baseTasks(tasks, "trash", "2026-09-25").map((t) => t.id),
    ["trash"],
  );
});
test("dates cross month and year boundaries, priorities sort high first without mutating the source", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(dateLabel("2027-01-01", "2026-12-31"), "Tomorrow");
  const tasks = [
    task({ id: "low", priority: 4 }),
    task({ id: "high", priority: 1 }),
  ];
  assert.equal(sortTasks(tasks, "priority")[0].id, "high");
  assert.equal(tasks[0].id, "low");
});
test("daily progress counts recurring occurrences without double-counting a terminal occurrence", async () => {
  const { completedOn, localDate } = await import("./model.ts");
  const at = "2026-09-25T20:00:00Z";
  const done = task({ completedAt: at, occurrences: [], status: "done" });
  const repeating = task({
    repeat: "FREQ=DAILY",
    occurrences: [{ date: "2026-09-25", at, actor: "neel" }],
    completedAt: null,
  });
  const lastOccurrence = {
    ...repeating,
    completedAt: at,
    status: "done" as const,
  };
  assert.equal(
    completedOn([done, repeating, lastOccurrence], localDate(new Date(at))),
    3,
  );
});
