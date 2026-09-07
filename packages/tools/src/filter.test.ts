import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFilter, matches, mentionsStatus, type FilterSubject } from "./filter.ts";

const today = "2026-09-06";
const base: FilterSubject = {
  status: "accepted",
  dueDate: null,
  deadline: null,
  priority: null,
  executor: "neel",
  hasParent: false,
  recurring: false,
  labels: ["health"],
  projectPaths: ["health", "health/dental"],
  projectPath: "health/dental",
  projectIds: ["p_aaaaaaaaaa", "p_bbbbbbbbbb"],
  searchable: "schedule six-month dental cleaning",
};
const run = (query: string, subject: Partial<FilterSubject> = {}) => {
  const parsed = parseFilter(query);
  assert.ok(parsed.ok, `expected "${query}" to parse: ${parsed.ok ? "" : parsed.error}`);
  return matches(parsed.ast, { ...base, ...subject }, today);
};

test("date terms resolve relative to today", () => {
  assert.equal(run("today", { dueDate: today }), true);
  assert.equal(run("today", { dueDate: "2026-09-07" }), false);
  assert.equal(run("tomorrow", { dueDate: "2026-09-07" }), true);
  assert.equal(run("overdue", { dueDate: "2026-09-05" }), true);
  assert.equal(run("overdue", { dueDate: today }), false);
  assert.equal(run("no date"), true);
  assert.equal(run("7 days", { dueDate: "2026-09-13" }), true);
  assert.equal(run("7 days", { dueDate: "2026-09-14" }), false);
  assert.equal(run("due before: +3d", { dueDate: "2026-09-08" }), true);
  assert.equal(run("due after: 2026-09-10", { dueDate: "2026-09-08" }), false);
  assert.equal(run("deadline: today", { deadline: today }), true);
  assert.equal(run("no deadline", { deadline: today }), false);
});

test("project, label, priority, executor and status terms", () => {
  assert.equal(run("#health/dental"), true);
  assert.equal(run("#health"), false, "#project is that project only");
  assert.equal(run("##health"), true, "##project includes sub-projects");
  assert.equal(run("#p_bbbbbbbbbb"), true);
  assert.equal(run("@health"), true);
  assert.equal(run("@work"), false);
  assert.equal(run("p1", { priority: 1 }), true);
  assert.equal(run("no priority"), true);
  assert.equal(run("assigned to: agent:booker", { executor: "agent:booker" }), true);
  assert.equal(run("status: proposed", { status: "proposed" }), true);
  assert.equal(run("open", { status: "done" }), false);
  assert.equal(run("done", { status: "done" }), true);
  assert.equal(run("subtask", { hasParent: true }), true);
  assert.equal(run("recurring"), false);
  assert.equal(run("search: dental"), true);
  assert.equal(run('search: "six-month dental"'), true);
});

test("operators: precedence, negation, parentheses, quotes", () => {
  assert.equal(run("today | overdue", { dueDate: "2026-09-01" }), true);
  assert.equal(run("today & @health", { dueDate: today }), true);
  assert.equal(run("today & @work", { dueDate: today }), false);
  assert.equal(run("!@work"), true);
  assert.equal(run("(today | tomorrow) & p1", { dueDate: today, priority: 1 }), true);
  assert.equal(run("today | tomorrow & p1", { dueDate: today }), true, "& binds tighter than |");
  assert.equal(run("!(today | tomorrow)", { dueDate: "2026-09-20" }), true);
});

test("rejects what the subset does not support, with a message", () => {
  for (const bad of ["", "next week", "due: someday", "today &", "(today", "today )", "status: maybe", "#", "!"]) {
    const parsed = parseFilter(bad);
    assert.equal(parsed.ok, false, `expected "${bad}" to be rejected`);
    if (!parsed.ok) assert.ok(parsed.error.length > 0);
  }
});

test("mentionsStatus decides whether the open-only default applies", () => {
  const ok = (q: string) => {
    const parsed = parseFilter(q);
    assert.ok(parsed.ok);
    return parsed.ok ? mentionsStatus(parsed.ast) : false;
  };
  assert.equal(ok("today & @health"), false);
  assert.equal(ok("done & @health"), true);
  assert.equal(ok("!(status: cancelled)"), true);
  assert.equal(ok("all"), true);
});
