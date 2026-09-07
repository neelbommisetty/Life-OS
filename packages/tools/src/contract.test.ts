import { test } from "node:test";
import assert from "node:assert/strict";
import { taskSchema, taskAddSchema, projectSchema, filterSchema, ctxSchema, issuesOf, type Task } from "./contract.ts";

const now = "2026-09-06T12:00:00Z";
const origin = { actor: "neel", at: now, evidence: [] };
const task: Task = {
  id: "t_abcdefghij",
  title: "Schedule six-month dental cleaning",
  notes: "",
  projectId: "p_abcdefghij",
  order: 0,
  status: "accepted",
  executor: "neel",
  due: { date: "2026-10-21" },
  deadline: null,
  labels: ["health"],
  comments: [],
  occurrences: [],
  origin,
  external: [],
  completedAt: null,
  version: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};

test("a well-formed task validates and the bad ones say why", () => {
  assert.equal(taskSchema.safeParse(task).success, true);
  const cases: [Partial<Task> | Record<string, unknown>, RegExp][] = [
    [{ id: "p_abcdefghij" }, /task id/],
    [{ due: { date: "2026-10-21", time: "09:00" } }, /timezone/],
    [{ due: { date: "2026-13-01" } }, /YYYY-MM-DD/],
    [{ repeat: "FREQ=WEEKLY;BYDAY=MO", due: null }, /repeating task needs a due date/],
    [{ repeat: "FREQ=HOURLY" }, /Unsupported FREQ/],
    [{ executor: "someone" }, /Executor/],
    [{ labels: ["Health"] }, /lowercase/],
    [{ priority: 5 }, /priority/],
    [{ parentId: "p_abcdefghij" }, /task id/],
    [{ bogus: true }, /Unrecognized/],
  ];
  for (const [patch, expected] of cases) {
    const result = taskSchema.safeParse({ ...task, ...patch });
    assert.equal(result.success, false, JSON.stringify(patch));
    if (!result.success) assert.match(issuesOf(result.error).join("\n"), expected);
  }
});

test("add input accepts references and rejects closed statuses", () => {
  assert.equal(taskAddSchema.safeParse({ title: "Buy milk", project: "inbox" }).success, true);
  assert.equal(taskAddSchema.safeParse({ title: "Buy milk", project: "health/dental", section: "Booking" }).success, true);
  assert.equal(taskAddSchema.safeParse({ title: "Buy milk", status: "done" }).success, false);
  assert.equal(taskAddSchema.safeParse({ title: " " }).success, false);
});

test("projects, filters and contexts validate their own rules", () => {
  const project = {
    id: "p_abcdefghij",
    name: "Health",
    slug: "health",
    parentId: null,
    layout: "list",
    order: 0,
    labels: ["health"],
    archived: false,
    system: false,
    origin,
    external: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  assert.equal(projectSchema.safeParse(project).success, true);
  assert.equal(projectSchema.safeParse({ ...project, slug: "Health Area" }).success, false);
  const filter = { id: "f_abcdefghij", name: "Health today", query: "today & @health", order: 0, origin, version: 1, createdAt: now, updatedAt: now, deletedAt: null };
  assert.equal(filterSchema.safeParse(filter).success, true);
  const broken = filterSchema.safeParse({ ...filter, query: "next week" });
  assert.equal(broken.success, false);
  if (!broken.success) assert.match(issuesOf(broken.error).join(), /Unknown filter term/);
  assert.equal(ctxSchema.safeParse({ actor: "codex", evidence: ["vault:Areas/Health.md"] }).success, true);
  assert.equal(ctxSchema.safeParse({ actor: "somebody" }).success, false);
  assert.equal(ctxSchema.safeParse({}).success, false);
});
