// An independent specification suite for tasks.ts, written from the brief
// (README.md, the TaskOps table) and HANDS.md alone, without reading the
// implementation. One throwaway schema per file; tests run in declaration
// order and may build on earlier records, each isolated in its own project
// where the assertions depend on it. Titles are unique across the file so the
// duplicate check never fires by accident.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Ctx, LogEntry, Project, Receipt, Section, Task, TaskAdd } from "./contract.ts";
import { createTestDb, fixedClock, type TestDb } from "./db/testing.ts";
import { createOrganize } from "./organize.ts";
import { createTasks } from "./tasks.ts";

type TaskOps = ReturnType<typeof createTasks>;
type BatchItem = Parameters<TaskOps["batch"]>[0][number];
type ImportResult = Awaited<ReturnType<TaskOps["import"]>>;

// 12:00Z on Sept 6 is 05:00 in Los Angeles, so "today" in the clock's timezone is 2026-09-06.
const clock = fixedClock("2026-09-06T12:00:00Z");
const now = "2026-09-06T12:00:00Z";
const later = fixedClock("2026-09-06T13:00:00Z");
const laterIso = "2026-09-06T13:00:00Z";
const today = "2026-09-06";
const LA = "America/Los_Angeles";
const neel: Ctx = { actor: "neel" };
const codex: Ctx = { actor: "codex", reason: "Neel asked in chat", evidence: ["msg:42"] };

let db: TestDb;
let org: ReturnType<typeof createOrganize>;
let tasks: TaskOps;
/** The same operations one hour later, for createdAt/updatedAt assertions. */
let tasksLater: TaskOps;
let inbox: Project;
let health: Project;
let dental: Project;
let work: Project;
let dentalNow: Section;
let dentalLater: Section;
let workBacklog: Section;

// ------------------------------------------------------------------ helpers

/** Narrow an ok receipt to its record, failing loudly otherwise. */
function ok<T>(receipt: Receipt<T>, why = ""): T {
  assert.ok(receipt.ok, `expected ok${why ? ` (${why})` : ""}, got ${JSON.stringify(receipt)}`);
  return receipt.record;
}

/** Narrow an ok receipt whose outcome is `unchanged`. */
function unchangedOf<T>(receipt: Receipt<T>, why = ""): T {
  assert.ok(receipt.ok, `expected unchanged${why ? ` (${why})` : ""}, got ${JSON.stringify(receipt)}`);
  assert.equal(receipt.outcome, "unchanged", why);
  return receipt.record;
}

/** Narrow a rejected receipt, failing loudly otherwise. */
function rejectedOf<T>(receipt: Receipt<T>, why = ""): Extract<Receipt<T>, { outcome: "rejected" }> {
  assert.equal(receipt.ok, false, `expected a rejection${why ? ` (${why})` : ""}, got ${JSON.stringify(receipt)}`);
  assert.equal(receipt.outcome, "rejected", why);
  assert.ok(receipt.issues.length > 0, `a rejection carries at least one issue${why ? ` (${why})` : ""}`);
  return receipt as Extract<Receipt<T>, { outcome: "rejected" }>;
}

/** Narrow a duplicate receipt, failing loudly otherwise. */
function duplicateOf<T>(receipt: Receipt<T>, why = ""): Extract<Receipt<T>, { outcome: "duplicate" }> {
  assert.equal(receipt.ok, false, `expected duplicate candidates${why ? ` (${why})` : ""}, got ${JSON.stringify(receipt)}`);
  assert.equal(receipt.outcome, "duplicate", why);
  return receipt as Extract<Receipt<T>, { outcome: "duplicate" }>;
}

const issuesText = <T>(receipt: Receipt<T>): string => receipt.issues.join("\n");
const ids = (list: Task[]): string[] => list.map((t) => t.id);
/** JSON round trip: drops explicit-undefined keys so a receipt's record compares equal to the stored row. */
const strip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const logCount = (): Promise<number> => db.store.read(async (tx) => (await tx.allLog()).length);
const raw = (id: string): Promise<Task | null> => db.store.read((tx) => tx.get("task", id));
const patchKeys = (entry: LogEntry): string[] => Object.keys(entry.patch).sort();

async function add(input: TaskAdd, ctx: Ctx = neel): Promise<Task> {
  return ok(await tasks.add(input, ctx), `add "${input.title}"`);
}

async function lastLog(id: string): Promise<LogEntry> {
  const entries = await tasks.history(id);
  assert.ok(entries.length > 0, `task ${id} has no log entries`);
  return entries[entries.length - 1]!;
}

/** The newest log entry for a task must name the op and carry the ctx's actor, reason, evidence, and key. */
async function assertLogged(id: string, op: string, ctx: Ctx, at = now): Promise<LogEntry> {
  const entry = await lastLog(id);
  assert.equal(entry.op, op, `last log op for ${id}`);
  assert.equal(entry.actor, ctx.actor, `last log actor for ${id}`);
  assert.equal(entry.recordKind, "task");
  assert.equal(entry.recordId, id);
  assert.equal(entry.reason, ctx.reason ?? null);
  assert.deepEqual(entry.evidence, ctx.evidence ?? []);
  assert.equal(entry.key, ctx.key ?? null);
  assert.equal(entry.at, at, "log timestamps come from the injected clock");
  assert.equal(typeof entry.patch, "object");
  assert.ok(Object.keys(entry.patch).length > 0, "a logged mutation has a non-empty patch");
  return entry;
}

/** A record changed as a consequence of another task's mutation: logged under a task op by the same actor. */
async function assertCascadeLogged(id: string, ctx: Ctx): Promise<LogEntry> {
  const entry = await lastLog(id);
  assert.match(entry.op, /^task\./, `cascade op for ${id}`);
  assert.equal(entry.actor, ctx.actor, `cascade actor for ${id}`);
  assert.equal(entry.recordId, id);
  assert.ok(Object.keys(entry.patch).length > 0);
  return entry;
}

async function project(name: string, extra: { parent?: string; labels?: string[] } = {}): Promise<Project> {
  return ok(await org.project.add({ name, ...extra }, neel), `project ${name}`);
}

async function section(projectRef: string, name: string): Promise<Section> {
  return ok(await org.section.add({ project: projectRef, name }, neel), `section ${name}`);
}

before(async () => {
  db = await createTestDb();
  org = createOrganize(db.store, clock);
  tasks = createTasks(db.store, clock, org);
  tasksLater = createTasks(db.store, later, org);
  const found = await org.project.get("inbox");
  assert.ok(found, "the Inbox exists on first use");
  inbox = found;
  health = await project("Health", { labels: ["health"] });
  dental = await project("Dental", { parent: "health" });
  dentalNow = await section("health/dental", "Now");
  dentalLater = await section("health/dental", "Later");
  work = await project("Work");
  workBacklog = await section("work", "Backlog");
});
after(() => db.drop());

// ------------------------------------------------------------------ add

test("add: lands in the Inbox as accepted for neel, executor neel, order 0, and logs a self-contained create entry", async () => {
  const receipt = await tasks.add({ title: "  Book the dentist  " }, neel);
  assert.equal(receipt.ok && receipt.outcome, "created");
  const t = ok(receipt);
  assert.match(t.id, /^t_[a-z0-9]{10}$/);
  assert.equal(t.title, "Book the dentist", "text is trimmed");
  assert.equal(t.notes, "");
  assert.equal(t.projectId, inbox.id);
  assert.equal(t.sectionId, undefined);
  assert.equal(t.parentId, undefined);
  assert.equal(t.order, 0);
  assert.equal(t.status, "accepted");
  assert.equal(t.executor, "neel");
  assert.equal(t.bucket, undefined);
  assert.equal(t.due, null);
  assert.equal(t.repeat, undefined);
  assert.equal(t.deadline, null);
  assert.equal(t.duration, undefined);
  assert.equal(t.priority, undefined);
  assert.deepEqual(t.labels, []);
  assert.deepEqual(t.comments, []);
  assert.deepEqual(t.occurrences, []);
  assert.deepEqual(t.external, []);
  assert.equal(t.completedAt, null);
  assert.equal(t.version, 1);
  assert.equal(t.createdAt, now);
  assert.equal(t.updatedAt, now);
  assert.equal(t.deletedAt, null);
  assert.equal(t.origin.actor, "neel");
  assert.equal(t.origin.at, now);
  assert.deepEqual(t.origin.evidence, []);
  assert.equal(t.origin.reason, undefined);
  assert.equal(receipt.id, t.id);
  assert.equal(receipt.ok && receipt.version, 1);
  assert.deepEqual(receipt.issues, []);
  assert.deepEqual(strip(await tasks.get(t.id)), strip(t), "get returns what the receipt carried");
  assert.deepEqual(strip(await raw(t.id)), strip(t), "and it is what the store holds");

  const entry = await assertLogged(t.id, "task.add", neel);
  assert.deepEqual(entry.patch.title, { from: null, to: "Book the dentist" });
  assert.deepEqual(entry.patch.status, { from: null, to: "accepted" });
  assert.deepEqual(entry.patch.projectId, { from: null, to: inbox.id });
  assert.equal(entry.patch.version, undefined, "version is never in a patch");
  assert.equal(entry.patch.updatedAt, undefined, "updatedAt is never in a patch");

  const second = await add({ title: "Renew the passport" });
  assert.equal(second.order, 1, "order is the max order in scope plus one");
  const third = await add({ title: "Sort the mail", project: "inbox" });
  assert.equal(third.projectId, inbox.id);
  assert.equal(third.order, 2);
});

test("add: rejects bad input, bad refs, and a bad ctx without writing anything", async () => {
  const before = await logCount();
  const cases: [unknown, RegExp][] = [
    [{ title: "" }, /title/],
    [{ title: "   " }, /title/],
    [{ title: "Repeat without a date", repeat: "FREQ=DAILY" }, /due/i],
    [{ title: "Timed without a zone", due: { date: today, time: "09:00" } }, /timezone/i],
    [{ title: "Bad date", due: { date: "2026-13-40" } }, /date/i],
    [{ title: "Bad rule", due: { date: today }, repeat: "FREQ=HOURLY" }, /FREQ|repeat/],
    [{ title: "Unknown field", bogus: true }, /bogus|unrecognized/i],
    [{ title: "Bad priority", priority: 9 }, /priority/],
    [{ title: "Bad executor", executor: "codex" }, /executor/i],
    [{ title: "Bad status", status: "done" }, /status/],
    [{ title: "Unknown project", project: "nowhere/at-all" }, /project/i],
    [{ title: "Unknown section", project: "work", section: "No such section" }, /section/i],
    [{ title: "Section of another project", project: "work", section: dentalNow.id }, /section/i],
    [{ title: "Unknown parent", parent: "t_0000000000" }, /parent/i],
    [{ title: "Malformed parent", parent: "nope" }, /parent/i],
  ];
  for (const [input, pattern] of cases) {
    const receipt = rejectedOf(await tasks.add(input as TaskAdd, neel), JSON.stringify(input));
    assert.match(issuesText(receipt), pattern, JSON.stringify(input));
    assert.equal(receipt.id, undefined, "nothing was created, so there is no id");
  }
  const badContexts: unknown[] = [{ actor: "nobody" }, { actor: "neel", ifVersion: 0 }, { actor: "neel", extra: true }, {}, null];
  for (const ctx of badContexts) {
    rejectedOf(await tasks.add({ title: "Bad ctx" }, ctx as Ctx), JSON.stringify(ctx));
  }
  assert.equal(await logCount(), before, "refusals log nothing");
  assert.deepEqual(await tasks.list({ text: "Bad", includeClosed: true, includeDeleted: true }), []);
});

test("add: resolves the project by id, slug path, or inbox, the section by name or id, and a parent hands down project and section", async () => {
  const byPath = await add({ title: "Order a new retainer", project: "health/dental", section: "Now" });
  assert.equal(byPath.projectId, dental.id);
  assert.equal(byPath.sectionId, dentalNow.id);
  const byId = await add({ title: "Ask about whitening", project: dental.id, section: dentalLater.id });
  assert.equal(byId.projectId, dental.id);
  assert.equal(byId.sectionId, dentalLater.id);
  const noSection = await add({ title: "Compare toothpaste brands", project: "health/dental" });
  assert.equal(noSection.sectionId, undefined);

  const child = await add({ title: "Pick up the retainer", project: "health/dental", parent: byPath.id });
  assert.equal(child.parentId, byPath.id);
  assert.equal(child.projectId, dental.id);
  assert.equal(child.sectionId, dentalNow.id, "a sub-task inherits its parent's section");
  assert.equal(child.order, 0, "a parent opens its own order scope");
  const sibling = await add({ title: "Rinse the retainer", parent: byPath.id });
  assert.equal(sibling.projectId, dental.id, "with no project given, the parent's project is used");
  assert.equal(sibling.sectionId, dentalNow.id);
  assert.equal(sibling.order, 1);
  const grandchild = await add({ title: "Find the retainer case", parent: child.id });
  assert.equal(grandchild.parentId, child.id);
  assert.equal(grandchild.projectId, dental.id);

  const crossed = rejectedOf(await tasks.add({ title: "Wrong project for the parent", project: "work", parent: byPath.id }, neel));
  assert.match(issuesText(crossed), /parent/i);
  rejectedOf(await tasks.add({ title: "Wrong section for the project", project: "health/dental", section: workBacklog.id }, neel));

  const gone = await add({ title: "A parent about to be deleted", project: "work" });
  ok(await tasks.delete(gone.id, neel));
  const orphan = rejectedOf(await tasks.add({ title: "Child of a deleted parent", parent: gone.id }, neel));
  assert.match(issuesText(orphan), /parent/i);
  assert.equal((await tasks.list({ parent: gone.id, includeDeleted: true, includeClosed: true })).length, 0);
});

test("add: status defaults by actor, may be set explicitly, and every optional field is kept", async () => {
  assert.equal((await add({ title: "Something Neel asked for" }, neel)).status, "accepted");
  assert.equal((await add({ title: "Something Codex inferred" }, codex)).status, "proposed");
  assert.equal((await add({ title: "Something an agent suggested" }, { actor: "agent:planner" })).status, "proposed");
  assert.equal((await add({ title: "Something Codex relayed verbatim", status: "accepted" }, codex)).status, "accepted");
  assert.equal((await add({ title: "Something Neel is still weighing", status: "proposed" }, neel)).status, "proposed");
  assert.equal((await add({ title: "Something imported" }, { actor: "import:todoist" })).status, "proposed");

  const full = await add(
    {
      title: "Book the flights to Lisbon",
      notes: "Window seat, morning departure",
      project: "work",
      section: "Backlog",
      executor: "agent:booker",
      bucket: "review",
      priority: 2,
      due: { date: "2026-09-20", time: "08:00", timezone: LA },
      repeat: "FREQ=MONTHLY",
      deadline: "2026-09-25",
      duration: 45,
      labels: ["travel"],
      external: [{ provider: "todoist", id: "123" }],
    },
    codex,
  );
  assert.equal(full.notes, "Window seat, morning departure");
  assert.equal(full.projectId, work.id);
  assert.equal(full.sectionId, workBacklog.id);
  assert.equal(full.executor, "agent:booker");
  assert.equal(full.bucket, "review");
  assert.equal(full.priority, 2);
  assert.deepEqual(full.due, { date: "2026-09-20", time: "08:00", timezone: LA });
  assert.equal(full.repeat, "FREQ=MONTHLY");
  assert.equal(full.deadline, "2026-09-25");
  assert.equal(full.duration, 45);
  assert.deepEqual(full.labels, ["travel"]);
  assert.deepEqual(full.external, [{ provider: "todoist", id: "123" }]);
  assert.equal(full.status, "proposed");
  assert.equal(full.origin.actor, "codex");
  assert.equal(full.origin.at, now);
  assert.equal(full.origin.reason, codex.reason);
  assert.deepEqual(full.origin.evidence, ["msg:42"]);
  const entry = await assertLogged(full.id, "task.add", codex);
  assert.deepEqual(entry.patch.due, { from: null, to: { date: "2026-09-20", time: "08:00", timezone: LA } });
});

test("add: labels named but not registered are created with the same ctx, once", async () => {
  assert.equal(await org.label.get("physio"), null);
  assert.equal(await org.label.get("admin"), null);
  const t = await add({ title: "Book a physio session", labels: ["physio", "admin"] }, codex);
  assert.deepEqual(t.labels, ["physio", "admin"]);
  for (const name of ["physio", "admin"]) {
    const label = await org.label.get(name);
    assert.ok(label, `label ${name} was registered`);
    assert.equal(label.name, name);
    assert.equal(label.deletedAt, null);
    assert.equal(label.origin.actor, "codex");
    const history = await db.store.read((tx) => tx.history("label", label.id));
    assert.equal(history.length, 1);
    assert.equal(history[0]!.actor, "codex");
    assert.equal(history[0]!.op, "label.add");
    assert.equal(history[0]!.reason, codex.reason);
    assert.deepEqual(history[0]!.evidence, codex.evidence);
  }
  const again = await add({ title: "Book a massage", labels: ["physio"] }, neel);
  assert.deepEqual(again.labels, ["physio"]);
  assert.equal((await org.label.list()).filter((l) => l.name === "physio").length, 1, "an existing label is reused, not duplicated");
  const physio = (await org.label.get("physio"))!;
  assert.equal((await db.store.read((tx) => tx.history("label", physio.id))).length, 1);
});

test("add: the duplicate check among open tasks, and allowDuplicate", async () => {
  const original = await add({ title: "Schedule six-month dental cleaning", project: "health/dental" });
  const before = await logCount();

  const same = duplicateOf(await tasks.add({ title: "  schedule SIX-month dental cleaning " }, codex), "same normalized title");
  assert.deepEqual(same.candidates.map((c) => c.id), [original.id]);
  assert.equal(same.candidates[0]!.title, original.title, "candidates are the existing records");
  assert.ok(same.issues.length > 0, "a duplicate receipt explains itself");
  assert.equal(same.id, undefined);

  const near = duplicateOf(await tasks.add({ title: "Schedule six-month dental cleaning appointment" }, neel), "word-set Jaccard >= 0.75");
  assert.ok(near.candidates.some((c) => c.id === original.id));

  const acrossProjects = duplicateOf(await tasks.add({ title: "Schedule six-month dental cleaning", project: "work" }, neel), "the check is not scoped to a project");
  assert.ok(acrossProjects.candidates.some((c) => c.id === original.id));

  assert.equal(await logCount(), before, "a duplicate outcome writes nothing");
  assert.equal((await tasks.list({ text: "dental cleaning", includeClosed: true, includeDeleted: true })).length, 1);

  const far = await add({ title: "Schedule the annual dental x-rays" });
  assert.notEqual(far.id, original.id);
  const twoWords = await add({ title: "Schedule cleaning" });
  assert.notEqual(twoWords.id, original.id);

  const forced = ok(await tasks.add({ title: "Schedule six-month dental cleaning", allowDuplicate: true }, neel), "allowDuplicate");
  assert.notEqual(forced.id, original.id);
  assert.equal(forced.title, original.title);
  const both = duplicateOf(await tasks.add({ title: "Schedule six-month dental cleaning" }, neel));
  assert.deepEqual(both.candidates.map((c) => c.id).sort(), [original.id, forced.id].sort(), "every open match is a candidate");

  // Closed and deleted tasks are not candidates.
  ok(await tasks.complete(forced.id, neel));
  ok(await tasks.delete(original.id, neel));
  const fresh = ok(await tasks.add({ title: "Schedule six-month dental cleaning" }, neel), "no open match remains");
  assert.notEqual(fresh.id, original.id);
  assert.notEqual(fresh.id, forced.id);
  const cancelled = await add({ title: "Prune the apple tree in the garden" });
  ok(await tasks.cancel(cancelled.id, { actor: "neel", reason: "The tree is gone" }));
  ok(await tasks.add({ title: "Prune the apple tree in the garden" }, neel), "a cancelled task is not a candidate");
  // Proposed tasks are open, so they are.
  const proposed = await add({ title: "Replace the kitchen smoke detector battery" }, codex);
  assert.equal(proposed.status, "proposed");
  duplicateOf(await tasks.add({ title: "Replace the kitchen smoke detector battery" }, neel));
});

test("add: an idempotency key returns the stored receipt and applies nothing twice; rejections and duplicates are not stored", async () => {
  const ctx: Ctx = { actor: "codex", key: "add-groceries-1" };
  const first = await tasks.add({ title: "Buy groceries for the week" }, ctx);
  const t = ok(first);
  const again = await tasks.add({ title: "Buy groceries for the week" }, ctx);
  assert.deepEqual(strip(again), strip(first), "the same key returns the same receipt");
  assert.equal((await tasks.list({ text: "groceries", includeClosed: true })).length, 1, "applied once");
  assert.equal((await tasks.history(t.id)).length, 1);
  assert.equal((await lastLog(t.id)).key, "add-groceries-1");

  rejectedOf(await tasks.add({ title: "" }, { actor: "neel", key: "add-retry-1" }));
  ok(await tasks.add({ title: "Return the library books" }, { actor: "neel", key: "add-retry-1" }), "a rejected receipt was not stored under the key");
  duplicateOf(await tasks.add({ title: "Return the library books" }, { actor: "neel", key: "add-retry-2" }));
  ok(await tasks.add({ title: "Return the library books", allowDuplicate: true }, { actor: "neel", key: "add-retry-2" }), "a duplicate receipt was not stored under the key");
});

// ------------------------------------------------------------------ get

test("get: returns the task, deleted included, and null for anything else", async () => {
  const t = await add({ title: "Water the balcony plants" });
  assert.deepEqual(strip(await tasks.get(t.id)), strip(t));
  ok(await tasks.delete(t.id, neel));
  const deleted = await tasks.get(t.id);
  assert.ok(deleted);
  assert.equal(deleted.deletedAt, now, "deleted tasks are returned; callers check deletedAt");
  assert.equal(deleted.status, "accepted", "delete leaves status alone");
  assert.equal(await tasks.get("t_0000000000"), null);
  assert.equal(await tasks.get("not-an-id"), null);
  assert.equal(await tasks.get(inbox.id), null, "a project id is not a task");
});

// ------------------------------------------------------------------ list

test("list: open statuses only by default; status, includeClosed, or a filter that mentions status widen it; deleted only with includeDeleted", async () => {
  const lab = await project("Status lab");
  const pr = await add({ title: "Status lab proposed", project: "status-lab" }, codex);
  const ac = await add({ title: "Status lab accepted", project: "status-lab" });
  const ip = await add({ title: "Status lab in progress", project: "status-lab" });
  ok(await tasks.start(ip.id, neel));
  const dn = await add({ title: "Status lab done", project: "status-lab" });
  ok(await tasks.complete(dn.id, neel));
  const cn = await add({ title: "Status lab cancelled", project: "status-lab" });
  ok(await tasks.cancel(cn.id, { actor: "neel", reason: "not needed" }));
  const dl = await add({ title: "Status lab deleted", project: "status-lab" });
  ok(await tasks.delete(dl.id, neel));
  const open = [pr.id, ac.id, ip.id].sort();

  assert.deepEqual(ids(await tasks.list({ project: lab.id })).sort(), open, "default: open only");
  assert.deepEqual(ids(await tasks.list({ project: "status-lab" })).sort(), open, "by slug too");
  assert.deepEqual(ids(await tasks.list({ project: "status-lab", status: ["done"] })), [dn.id]);
  assert.deepEqual(ids(await tasks.list({ project: "status-lab", status: ["done", "cancelled"] })).sort(), [dn.id, cn.id].sort());
  assert.deepEqual(ids(await tasks.list({ project: "status-lab", status: ["proposed"] })), [pr.id]);
  assert.deepEqual(ids(await tasks.list({ project: "status-lab", includeClosed: true })).sort(), [...open, dn.id, cn.id].sort());
  assert.deepEqual(ids(await tasks.list({ project: "status-lab", filter: "done" })), [dn.id], "a filter that mentions status lifts the default");
  assert.deepEqual(ids(await tasks.list({ project: "status-lab", filter: "status: cancelled" })), [cn.id]);
  assert.deepEqual(ids(await tasks.list({ project: "status-lab", filter: "all" })).sort(), [...open, dn.id, cn.id].sort());
  assert.deepEqual(ids(await tasks.list({ project: "status-lab", filter: "!done" })).sort(), [...open, cn.id].sort());
  assert.deepEqual(ids(await tasks.list({ project: "status-lab", filter: "no date" })).sort(), open, "a filter that does not mention status keeps the default");
  assert.deepEqual(ids(await tasks.list({ project: "status-lab", includeDeleted: true })).sort(), [...open, dl.id].sort());
  assert.deepEqual(ids(await tasks.list({ project: "status-lab", includeDeleted: true, includeClosed: true })).sort(), [...open, dn.id, cn.id, dl.id].sort());
  assert.deepEqual(await tasks.list({ project: "status-lab", status: ["in_progress"], undated: false, dueOn: today }), [], "an empty result is an empty array");
});

test("list: sorts by due date, due time, priority, order, createdAt, undated last; every criterion narrows before the filter runs", async () => {
  const lab = await project("Sort lab");
  const sub = await project("Sort sub", { parent: "sort-lab" });
  const s1 = await section("sort-lab", "S1");
  const s2 = await section("sort-lab", "S2");
  const p = "sort-lab";
  // Created in a scrambled order so creation order never explains the result.
  const a = await add({ title: "Sort alpha", project: p, due: { date: "2026-09-09" } });
  const f = await add({ title: "Sort foxtrot", project: p });
  const e = await add({ title: "Sort echo", project: p, due: { date: "2026-09-08" }, priority: 3, labels: ["sorting"] });
  const b = await add({ title: "Sort bravo", project: p, due: { date: "2026-09-07", time: "10:00", timezone: LA } });
  const g = await add({ title: "Sort golf", project: p, priority: 1 });
  const h = await add({ title: "Sort hotel", project: p, due: { date: "2026-09-08" }, priority: 3 });
  const c = await add({ title: "Sort charlie", project: p, due: { date: "2026-09-07", time: "09:00", timezone: LA } });
  const d = await add({ title: "Sort delta", project: p, due: { date: "2026-09-08" }, priority: 1, executor: "agent:sorter" });
  const x = await add({ title: "Sort x-ray", project: p, section: "S1" });
  const y = ok(await tasksLater.add({ title: "Sort yankee", project: p, section: s2.id }, neel));
  const z = ok(await tasksLater.add({ title: "Sort zulu", project: p, section: s1.id }, neel));
  const child = await add({ title: "Sort alpha child", project: p, parent: a.id, due: { date: "2026-12-01" } });
  const inSub = await add({ title: "Sort sub task", project: "sort-lab/sort-sub", due: { date: "2026-12-02" } });
  assert.ok(e.order < h.order, "e was created before h in the same scope");
  assert.equal(x.order, y.order, "x and y are first in their own sections");
  assert.equal(y.createdAt, laterIso);
  assert.equal(z.updatedAt, laterIso);
  assert.equal(inSub.projectId, sub.id);

  const expected = [c, b, d, e, h, a, child, g, x, y, f, z].map((t) => t.id);
  assert.deepEqual(ids(await tasks.list({ project: p })), expected, "the full sort");
  assert.deepEqual(ids(await tasks.list({ project: lab.id, withSubprojects: true })), [c, b, d, e, h, a, child, inSub, g, x, y, f, z].map((t) => t.id));
  assert.deepEqual(ids(await tasks.list({ project: p, limit: 3 })), [c.id, b.id, d.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, section: "S1" })), [x.id, z.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, section: s2.id })), [y.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, parent: a.id })), [child.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, parent: null })), expected.filter((id) => id !== child.id), "parent: null means top level only");
  assert.deepEqual(ids(await tasks.list({ project: p, label: "sorting" })), [e.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, executor: "agent:sorter" })), [d.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, dueOn: "2026-09-08" })), [d.id, e.id, h.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, dueBefore: "2026-09-08" })), [c.id, b.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, dueAfter: "2026-09-08" })), [a.id, child.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, dueAfter: "2026-09-07", dueBefore: "2026-09-09" })), [d.id, e.id, h.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, undated: true })), [g.id, x.id, y.id, f.id, z.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, text: "ALPHA" })), [a.id, child.id], "text matches case-insensitively");
  assert.deepEqual(ids(await tasks.list({ project: p, filter: "p1" })), [d.id, g.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, filter: "tomorrow" })), [c.id, b.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, filter: "overdue" })), []);
  assert.deepEqual(ids(await tasks.list({ project: p, filter: "3 days" })), [c.id, b.id, d.id, e.id, h.id, a.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, filter: "due before: 2026-09-08 | no date" })), [c.id, b.id, g.id, x.id, y.id, f.id, z.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, filter: "subtask" })), [child.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, filter: "@sorting" })), [e.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, filter: "assigned to: agent:sorter" })), [d.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, filter: "search: yankee" })), [y.id]);
  assert.deepEqual(ids(await tasks.list({ project: p, section: "S1", filter: "no date" })), [x.id, z.id], "criteria first, then the filter");
  assert.deepEqual(ids(await tasks.list({ project: p, dueOn: "2026-09-08", filter: "p3" })), [e.id, h.id]);
  assert.deepEqual(ids(await tasks.list({ project: "sort-lab/sort-sub" })), [inSub.id]);
  assert.deepEqual(ids(await tasks.list({ filter: "#sort-lab/sort-sub" })), [inSub.id]);
  assert.deepEqual(ids(await tasks.list({ filter: "##sort-lab & 3 days" })), [c.id, b.id, d.id, e.id, h.id, a.id]);
  assert.deepEqual(ids(await tasks.list({ filter: "#sort-lab & due after: 2026-11-01" })), [child.id], "#project excludes sub-projects");
  assert.deepEqual(ids(await tasks.list({ filter: "##sort-lab & due after: 2026-11-01" })), [child.id, inSub.id], "##project includes them");
  assert.deepEqual(ids(await tasks.list({ filter: `#${lab.id} & due after: 2026-11-01` })), [child.id], "#id works too");
});

test("list: refuses instead of guessing", async () => {
  await assert.rejects(tasks.list({ filter: "frobnicate" }), /frobnicate|filter/i);
  await assert.rejects(tasks.list({ filter: "today &" }));
  await assert.rejects(tasks.list({ project: "nowhere/at-all" }), /project/i);
  await assert.rejects(tasks.list({ status: [] }));
  await assert.rejects(tasks.list({ dueOn: "next week" }));
  await assert.rejects(tasks.list({ bogus: 1 } as never));
});

test("list: effective labels come through the project and its ancestors", async () => {
  const inHealth = await add({ title: "Stretch every morning", project: "health" });
  const inDental = await add({ title: "Floss every night", project: "health/dental" });
  const labeled = await add({ title: "Read about sleep hygiene", labels: ["health"] });
  const unrelated = await add({ title: "File the quarterly taxes", project: "work" });
  assert.deepEqual(inHealth.labels, [], "the task itself carries no label");
  assert.deepEqual(inDental.labels, []);
  assert.equal(inHealth.projectId, health.id);

  const health_ = ids(await tasks.list({ filter: "@health" }));
  assert.ok(health_.includes(inHealth.id), "through its own project");
  assert.ok(health_.includes(inDental.id), "through an ancestor project");
  assert.ok(health_.includes(labeled.id), "directly");
  assert.ok(!health_.includes(unrelated.id));
  assert.ok(ids(await tasks.list({ filter: "@health & #inbox" })).includes(labeled.id));
  assert.deepEqual(ids(await tasks.list({ project: "work", filter: "@health" })), []);
  assert.deepEqual(ids(await tasks.list({ filter: "@health & #work" })), []);
  assert.deepEqual(ids(await tasks.list({ project: "health", withSubprojects: true, filter: "@health & !subtask & search: every" })).sort(), [inHealth.id, inDental.id].sort());
  assert.ok(ids(await tasks.list({ filter: "@health & !##health" })).includes(labeled.id));
});

// ------------------------------------------------------------------ update

test("update: content and scheduling fields, null clears, labels are registered, unchanged logs nothing", async () => {
  const t = await add({ title: "Draft the report", project: "work" });
  const receipt = await tasks.update(
    t.id,
    {
      title: "Draft the quarterly report",
      notes: "Use last year's template",
      priority: 2,
      due: { date: "2026-09-10", time: "09:30", timezone: LA },
      deadline: "2026-09-12",
      duration: 90,
      labels: ["writing", "work"],
    },
    codex,
  );
  assert.equal(receipt.ok && receipt.outcome, "updated");
  const u = ok(receipt);
  assert.equal(u.id, t.id);
  assert.equal(u.version, 2);
  assert.equal(receipt.ok && receipt.version, 2);
  assert.equal(u.title, "Draft the quarterly report");
  assert.equal(u.notes, "Use last year's template");
  assert.equal(u.priority, 2);
  assert.deepEqual(u.due, { date: "2026-09-10", time: "09:30", timezone: LA });
  assert.equal(u.deadline, "2026-09-12");
  assert.equal(u.duration, 90);
  assert.deepEqual(u.labels, ["writing", "work"]);
  assert.equal(u.status, "accepted", "update never touches status");
  assert.equal(u.projectId, work.id);
  assert.equal(u.createdAt, now);
  assert.deepEqual(strip(u.origin), strip(t.origin), "origin is fixed at creation");
  assert.ok(await org.label.get("writing"), "labels named on update are registered");
  assert.equal((await org.label.get("writing"))!.origin.actor, "codex");
  const entry = await assertLogged(t.id, "task.update", codex);
  assert.deepEqual(patchKeys(entry), ["deadline", "due", "duration", "labels", "notes", "priority", "title"]);
  assert.deepEqual(entry.patch.title, { from: "Draft the report", to: "Draft the quarterly report" });
  assert.deepEqual(entry.patch.priority, { from: null, to: 2 });

  const cleared = ok(await tasks.update(t.id, { priority: null, due: null, deadline: null, duration: null }, neel));
  assert.equal(cleared.version, 3);
  assert.equal(cleared.priority, undefined);
  assert.equal(cleared.due, null);
  assert.equal(cleared.deadline, null);
  assert.equal(cleared.duration, undefined);
  assert.deepEqual(cleared.labels, ["writing", "work"], "untouched fields stay");
  const clearedEntry = await assertLogged(t.id, "task.update", neel);
  assert.deepEqual(patchKeys(clearedEntry), ["deadline", "due", "duration", "priority"]);
  assert.deepEqual(clearedEntry.patch.duration, { from: 90, to: null });
  assert.deepEqual(strip(await raw(t.id)), strip(cleared));

  const nothing = unchangedOf(await tasks.update(t.id, { title: "Draft the quarterly report", labels: ["writing", "work"] }, neel));
  assert.equal(nothing.version, 3);
  assert.equal((await tasks.history(t.id)).length, 3, "unchanged writes do not log");
  const empty = await tasks.update(t.id, {}, neel);
  assert.ok(!empty.ok || empty.outcome === "unchanged", "an empty update changes nothing");
  assert.equal((await tasks.history(t.id)).length, 3);
  assert.equal((await raw(t.id))!.version, 3);

  const emptied = ok(await tasks.update(t.id, { labels: [] }, neel));
  assert.deepEqual(emptied.labels, []);
  assert.equal(emptied.version, 4);
});

test("update: a repeating task must keep a due date; bad input, unknown, deleted, and stale versions are rejected", async () => {
  const t = await add({ title: "Water the office plants", project: "work" });
  const noDate = rejectedOf(await tasks.update(t.id, { repeat: "FREQ=WEEKLY;BYDAY=FR" }, neel), "repeat on an undated task");
  assert.match(issuesText(noDate), /due/i);
  const repeating = ok(await tasks.update(t.id, { due: { date: "2026-09-11" }, repeat: "FREQ=WEEKLY;BYDAY=FR" }, neel));
  assert.equal(repeating.repeat, "FREQ=WEEKLY;BYDAY=FR");
  const undated = rejectedOf(await tasks.update(t.id, { due: null }, neel), "undating a repeating task");
  assert.match(issuesText(undated), /due|repeat/i);
  assert.equal((await raw(t.id))!.version, repeating.version, "nothing changed");
  const stopped = ok(await tasks.update(t.id, { repeat: null }, neel));
  assert.equal(stopped.repeat, undefined);
  assert.deepEqual(stopped.due, { date: "2026-09-11" });
  ok(await tasks.update(t.id, { due: null }, neel), "without a rule the date can go");

  rejectedOf(await tasks.update(t.id, { bogus: 1 } as never, neel), "unknown field");
  rejectedOf(await tasks.update(t.id, { priority: 0 }, neel), "priority out of range");
  rejectedOf(await tasks.update(t.id, { title: "" }, neel), "empty title");
  rejectedOf(await tasks.update(t.id, { due: { date: today, time: "25:00", timezone: LA } }, neel), "bad time");
  rejectedOf(await tasks.update(t.id, { due: { date: today, time: "09:00", timezone: "Mars/Olympus" } }, neel), "bad timezone");
  rejectedOf(await tasks.update(t.id, { repeat: "FREQ=WEEKLY;BYDAY=XX" }, neel), "bad rule");
  rejectedOf(await tasks.update("t_0000000000", { title: "Nobody home" }, neel), "unknown id");
  rejectedOf(await tasks.update("nope", { title: "Nobody home" }, neel), "malformed id");

  const current = (await raw(t.id))!;
  const stale = rejectedOf(await tasks.update(t.id, { title: "Water the office plants weekly" }, { actor: "neel", ifVersion: current.version + 1 }), "stale ifVersion");
  assert.match(issuesText(stale), /version/i);
  assert.equal(stale.id, t.id);
  assert.deepEqual(strip(stale.record), strip(current), "a version mismatch returns the current record");
  const matching = ok(await tasks.update(t.id, { title: "Water the office plants weekly" }, { actor: "neel", ifVersion: current.version }));
  assert.equal(matching.version, current.version + 1);

  ok(await tasks.delete(t.id, neel));
  rejectedOf(await tasks.update(t.id, { title: "Water the office plants daily" }, neel), "deleted task");
  assert.equal((await raw(t.id))!.title, "Water the office plants weekly");
});

// ------------------------------------------------------------------ move

test("move: changes project, section, and parent; the subtree follows; sections and parents are checked", async () => {
  const t = await add({ title: "Move the marketing site", project: "work", section: "Backlog" });
  const c1 = await add({ title: "Point the DNS at the new host", parent: t.id });
  const g = await add({ title: "Check the DNS propagation", parent: c1.id });
  assert.equal(c1.sectionId, workBacklog.id);
  const dentalTop = await tasks.list({ project: "health/dental", parent: null, includeClosed: true, includeDeleted: true });
  const maxOrder = Math.max(...dentalTop.filter((x) => x.sectionId === undefined).map((x) => x.order));

  const moved = ok(await tasks.move(t.id, { project: "health/dental" }, codex));
  assert.equal(moved.version, 2);
  assert.equal(moved.projectId, dental.id);
  assert.equal(moved.sectionId, undefined, "a section from the old project cannot come along");
  assert.equal(moved.parentId, undefined);
  assert.equal(moved.order, maxOrder + 1, "order is last in the new scope");
  assert.equal(moved.status, "accepted");
  const entry = await assertLogged(t.id, "task.move", codex);
  assert.deepEqual(entry.patch.projectId, { from: work.id, to: dental.id });
  assert.deepEqual(entry.patch.sectionId, { from: workBacklog.id, to: null });
  for (const sub of [c1, g]) {
    const after = (await raw(sub.id))!;
    assert.equal(after.projectId, dental.id, `${sub.title} moved with its parent`);
    assert.equal(after.sectionId, undefined);
    assert.equal(after.parentId, sub.parentId, "the subtree keeps its shape");
    assert.equal(after.version, 2);
    await assertCascadeLogged(sub.id, codex);
  }

  const sectioned = ok(await tasks.move(t.id, { section: "Now" }, neel));
  assert.equal(sectioned.sectionId, dentalNow.id);
  assert.equal(sectioned.projectId, dental.id);
  const byId = ok(await tasks.move(t.id, { section: dentalLater.id }, neel));
  assert.equal(byId.sectionId, dentalLater.id);
  const unsectioned = ok(await tasks.move(t.id, { section: null }, neel));
  assert.equal(unsectioned.sectionId, undefined);
  unchangedOf(await tasks.move(t.id, { project: "health/dental", section: null }, neel), "moving to where it already is");
  unchangedOf(await tasks.move(t.id, { parent: null }, neel));

  const wrongSection = rejectedOf(await tasks.move(t.id, { section: workBacklog.id }, neel), "section of another project");
  assert.match(issuesText(wrongSection), /section/i);
  rejectedOf(await tasks.move(t.id, { project: "work", section: "Now" }, neel), "section must belong to the target project");
  rejectedOf(await tasks.move(t.id, { section: "No such section" }, neel));
  rejectedOf(await tasks.move(t.id, { parent: t.id }, neel), "own parent");
  const cycle = rejectedOf(await tasks.move(t.id, { parent: g.id }, neel), "under its own descendant");
  assert.match(issuesText(cycle), /parent/i);
  rejectedOf(await tasks.move(c1.id, { parent: g.id }, neel), "under its own child");
  const other = await add({ title: "Move lab bystander", project: "work" });
  rejectedOf(await tasks.move(t.id, { parent: other.id }, neel), "parent in another project");
  rejectedOf(await tasks.move(t.id, { parent: "t_0000000000" }, neel), "unknown parent");
  rejectedOf(await tasks.move(t.id, { project: "nowhere/at-all" }, neel), "unknown project");
  rejectedOf(await tasks.move(t.id, {}, neel), "nothing to move");
  rejectedOf(await tasks.move("t_0000000000", { project: "work" }, neel), "unknown task");
  assert.equal((await raw(t.id))!.version, unsectioned.version, "refusals change nothing");

  const reparented = ok(await tasks.move(c1.id, { parent: null }, neel));
  assert.equal(reparented.parentId, undefined);
  assert.equal(reparented.projectId, dental.id);
  assert.equal((await raw(g.id))!.parentId, c1.id, "the grandchild stays under its parent");
  const adopted = ok(await tasks.move(g.id, { parent: t.id }, neel));
  assert.equal(adopted.parentId, t.id);
  assert.equal(adopted.projectId, dental.id);
  const acrossWithParent = ok(await tasks.move(c1.id, { project: "work", parent: other.id }, neel));
  assert.equal(acrossWithParent.projectId, work.id);
  assert.equal(acrossWithParent.parentId, other.id);

  ok(await tasks.delete(other.id, neel, { subtasks: "leave" }));
  rejectedOf(await tasks.move(t.id, { parent: other.id }, neel), "deleted parent");
  const deletedProject = await project("Doomed");
  ok(await org.project.delete(deletedProject.id, neel));
  rejectedOf(await tasks.move(t.id, { project: deletedProject.id }, neel), "deleted project");
});

// ------------------------------------------------------------------ reorder

test("reorder: assigns 0..n-1 in the given sequence within one scope, one receipt per id", async () => {
  const lab = await project("Reorder lab");
  const s = await section("reorder-lab", "Queue");
  const r1 = await add({ title: "Reorder one", project: lab.id, section: s.id });
  const r2 = await add({ title: "Reorder two", project: lab.id, section: s.id });
  const r3 = await add({ title: "Reorder three", project: lab.id, section: s.id });
  const elsewhere = await add({ title: "Reorder elsewhere", project: lab.id });
  assert.deepEqual([r1.order, r2.order, r3.order], [0, 1, 2]);

  const receipts = await tasks.reorder([r3.id, r1.id, r2.id], codex);
  assert.equal(receipts.length, 3);
  assert.deepEqual(receipts.map((r) => r.id), [r3.id, r1.id, r2.id], "receipts follow the given sequence");
  assert.deepEqual(receipts.map((r) => ok(r).order), [0, 1, 2]);
  assert.ok(receipts.every((r) => r.ok && r.outcome === "updated"));
  assert.equal((await raw(r3.id))!.order, 0);
  assert.equal((await raw(r1.id))!.order, 1);
  assert.equal((await raw(r2.id))!.order, 2);
  assert.deepEqual(ids(await tasks.list({ project: lab.id, section: s.id })), [r3.id, r1.id, r2.id]);
  for (const t of [r1, r2, r3]) {
    const entry = await assertLogged(t.id, "task.reorder", codex);
    assert.deepEqual(patchKeys(entry), ["order"]);
  }

  const again = await tasks.reorder([r3.id, r1.id, r2.id], neel);
  assert.ok(again.every((r) => r.ok && r.outcome === "unchanged"), "already in that order");
  assert.equal((await tasks.history(r1.id)).length, 2);
  const partial = await tasks.reorder([r2.id, r3.id], neel);
  assert.deepEqual(partial.map((r) => ok(r).order), [0, 1], "a subset is renumbered from zero");
  assert.equal((await raw(r1.id))!.order, 1, "an id left out is not touched");

  const mixed = await tasks.reorder([r1.id, elsewhere.id], neel);
  assert.equal(mixed.length, 2);
  for (const r of mixed) assert.match(issuesText(rejectedOf(r, "mixed scopes")), /section|scope|same/i);
  const unknown = await tasks.reorder([r1.id, "t_0000000000"], neel);
  for (const r of unknown) rejectedOf(r, "unknown id");
  ok(await tasks.delete(r2.id, neel));
  const deleted = await tasks.reorder([r1.id, r2.id], neel);
  for (const r of deleted) rejectedOf(r, "deleted id");
  assert.equal((await raw(r1.id))!.order, 1, "a rejected reorder changes nothing");
  assert.deepEqual(await tasks.reorder([], neel), []);
});

// ------------------------------------------------------------------ duplicate

test("duplicate: copies the fields and the subtree, not comments, occurrences, or external; status follows the add rule", async () => {
  const src = await add(
    {
      title: "Prepare the weekly status update",
      notes: "Numbers first",
      project: "health/dental",
      section: "Now",
      labels: ["health", "reporting"],
      priority: 1,
      due: { date: "2026-09-07", time: "16:00", timezone: LA },
      deadline: "2026-09-08",
      duration: 30,
      repeat: "FREQ=WEEKLY;BYDAY=MO",
      executor: "agent:reporter",
      bucket: "safe",
      external: [{ provider: "todoist", id: "9" }],
    },
    neel,
  );
  const kid = await add({ title: "Collect the numbers for the status update", parent: src.id });
  const grandkid = await add({ title: "Ask finance for the numbers", parent: kid.id });
  ok(await tasks.note(src.id, "Template is in the shared drive", neel));
  const completed = ok(await tasks.complete(src.id, neel, { subtasks: "leave" }));
  assert.equal(completed.occurrences.length, 1, "a repeating task records the occurrence and stays open");
  assert.equal(completed.status, "accepted");
  assert.equal(completed.due?.date, "2026-09-14");
  const source = (await raw(src.id))!;

  const receipt = await tasks.duplicate(src.id, codex);
  assert.equal(receipt.ok && receipt.outcome, "created");
  const dup = ok(receipt);
  assert.notEqual(dup.id, src.id);
  assert.match(dup.id, /^t_[a-z0-9]{10}$/);
  assert.equal(dup.version, 1);
  assert.equal(dup.title, source.title);
  assert.equal(dup.notes, source.notes);
  assert.equal(dup.projectId, source.projectId);
  assert.equal(dup.sectionId, source.sectionId);
  assert.equal(dup.parentId, undefined);
  assert.ok(dup.order > source.order, "ordered after the original");
  assert.deepEqual(dup.labels, source.labels);
  assert.equal(dup.priority, source.priority);
  assert.deepEqual(dup.due, source.due);
  assert.equal(dup.deadline, source.deadline);
  assert.equal(dup.duration, source.duration);
  assert.equal(dup.repeat, source.repeat);
  assert.equal(dup.executor, source.executor);
  assert.equal(dup.bucket, source.bucket);
  assert.deepEqual(dup.comments, []);
  assert.deepEqual(dup.occurrences, []);
  assert.deepEqual(dup.external, []);
  assert.equal(dup.completedAt, null);
  assert.equal(dup.status, "proposed", "codex duplicates land proposed");
  assert.equal(dup.origin.actor, "codex");
  assert.equal(dup.createdAt, now);
  const entry = await assertLogged(dup.id, "task.duplicate", codex);
  assert.deepEqual(entry.patch.title, { from: null, to: source.title });
  assert.equal((await raw(src.id))!.version, source.version, "the original is untouched");

  const dupKids = await tasks.list({ parent: dup.id });
  assert.equal(dupKids.length, 1);
  assert.equal(dupKids[0]!.title, kid.title);
  assert.equal(dupKids[0]!.projectId, dup.projectId);
  assert.equal(dupKids[0]!.status, "proposed");
  assert.notEqual(dupKids[0]!.id, kid.id);
  const dupGrandkids = await tasks.list({ parent: dupKids[0]!.id });
  assert.equal(dupGrandkids.length, 1);
  assert.equal(dupGrandkids[0]!.title, grandkid.title);
  await assertCascadeLogged(dupKids[0]!.id, codex);
  assert.equal((await tasks.list({ parent: src.id })).length, 1, "the original subtree is intact");

  const flat = ok(await tasks.duplicate(src.id, neel, { subtasks: false }));
  assert.equal(flat.status, "accepted", "neel duplicates land accepted");
  assert.deepEqual(await tasks.list({ parent: flat.id }), []);
  assert.equal(flat.title, source.title);

  const child = ok(await tasks.duplicate(kid.id, neel));
  assert.equal(child.parentId, kid.parentId, "duplicating a sub-task keeps it under the same parent");
  assert.equal(child.sectionId, kid.sectionId);
  assert.equal((await tasks.list({ parent: src.id })).length, 2);

  rejectedOf(await tasks.duplicate("t_0000000000", neel), "unknown");
  ok(await tasks.delete(flat.id, neel));
  rejectedOf(await tasks.duplicate(flat.id, neel), "deleted");
});

// ------------------------------------------------------------------ accept, start

test("accept and start: proposed to accepted to in_progress, nothing else", async () => {
  const t = await add({ title: "Review the vendor contract" }, codex);
  assert.equal(t.status, "proposed");
  const early = rejectedOf(await tasks.start(t.id, neel), "start needs accepted");
  assert.match(issuesText(early), /status|proposed|accept/i);
  assert.equal(early.id, t.id);
  assert.equal((await raw(t.id))!.version, 1);

  const accepted = ok(await tasks.accept(t.id, neel));
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.version, 2);
  const acceptEntry = await assertLogged(t.id, "task.accept", neel);
  assert.deepEqual(acceptEntry.patch, { status: { from: "proposed", to: "accepted" } });

  const started = ok(await tasks.start(t.id, codex));
  assert.equal(started.status, "in_progress");
  assert.equal(started.version, 3);
  const startEntry = await assertLogged(t.id, "task.start", codex);
  assert.deepEqual(startEntry.patch, { status: { from: "accepted", to: "in_progress" } });

  rejectedOf(await tasks.accept(t.id, neel), "accept on in_progress");
  ok(await tasks.complete(t.id, neel));
  rejectedOf(await tasks.accept(t.id, neel), "accept on done");
  rejectedOf(await tasks.start(t.id, neel), "start on done");
  const cancelled = await add({ title: "Renegotiate the vendor contract" }, codex);
  ok(await tasks.cancel(cancelled.id, { actor: "neel", reason: "declined" }));
  rejectedOf(await tasks.accept(cancelled.id, neel), "accept on cancelled");
  rejectedOf(await tasks.start(cancelled.id, neel), "start on cancelled");
  rejectedOf(await tasks.accept("t_0000000000", neel), "unknown");
  rejectedOf(await tasks.start("t_0000000000", neel), "unknown");
  assert.equal((await tasks.history(t.id)).length, 4, "refusals log nothing");
});

// ------------------------------------------------------------------ complete, uncomplete

test("complete: accepted or in_progress becomes done with completedAt and an occurrence; uncomplete reopens", async () => {
  const t = await add({ title: "Submit the expense report", due: { date: "2026-09-08" } });
  const done = ok(await tasks.complete(t.id, codex));
  assert.equal(done.status, "done");
  assert.equal(done.completedAt, now);
  assert.deepEqual(done.occurrences, [{ date: "2026-09-08", at: now, actor: "codex" }], "the occurrence date is the due date");
  assert.deepEqual(done.due, { date: "2026-09-08" }, "a non-repeating task keeps its due date");
  assert.equal(done.version, 2);
  const entry = await assertLogged(t.id, "task.complete", codex);
  assert.deepEqual(entry.patch.status, { from: "accepted", to: "done" });
  assert.deepEqual(entry.patch.completedAt, { from: null, to: now });
  assert.ok("occurrences" in entry.patch);
  assert.ok(!(await tasks.list({ text: "expense report" })).some((x) => x.id === t.id), "done tasks leave the open list");

  rejectedOf(await tasks.complete(t.id, neel), "complete on done");
  const reopened = ok(await tasks.uncomplete(t.id, neel));
  assert.equal(reopened.status, "accepted");
  assert.equal(reopened.completedAt, null);
  assert.equal(reopened.version, 3);
  const reopenEntry = await assertLogged(t.id, "task.uncomplete", neel);
  assert.deepEqual(reopenEntry.patch.status, { from: "done", to: "accepted" });
  rejectedOf(await tasks.uncomplete(t.id, neel), "uncomplete on an open task with nothing to rewind");

  const started = await add({ title: "Ship the release notes" });
  ok(await tasks.start(started.id, neel));
  const fromProgress = ok(await tasks.complete(started.id, neel, { date: "2026-09-05" }));
  assert.equal(fromProgress.status, "done");
  assert.deepEqual(fromProgress.occurrences, [{ date: "2026-09-05", at: now, actor: "neel" }], "opts.date is the occurrence date");

  const undated = await add({ title: "Tidy the desk drawers" });
  const undatedDone = ok(await tasks.complete(undated.id, neel));
  assert.equal(undatedDone.occurrences.length, 1);
  assert.equal(undatedDone.occurrences[0]!.date, today, "an undated task completes today in the clock's timezone");

  const proposed = await add({ title: "Audit the newsletter list" }, codex);
  const early = rejectedOf(await tasks.complete(proposed.id, neel), "complete on proposed");
  assert.match(issuesText(early), /status|proposed|accept/i);
  assert.equal((await raw(proposed.id))!.status, "proposed");
  rejectedOf(await tasks.uncomplete(proposed.id, neel), "uncomplete on proposed");

  const cancelled = await add({ title: "Print the old newsletter" });
  ok(await tasks.cancel(cancelled.id, { actor: "neel", reason: "digital only" }));
  rejectedOf(await tasks.complete(cancelled.id, neel), "complete on cancelled");
  const uncancelled = ok(await tasks.uncomplete(cancelled.id, neel));
  assert.equal(uncancelled.status, "accepted", "cancelled tasks are reopened with uncomplete");
  assert.equal(uncancelled.completedAt, null);

  rejectedOf(await tasks.complete(t.id, neel, { date: "yesterday" }), "opts.date must be a date");
  rejectedOf(await tasks.complete(t.id, neel, { subtasks: "delete" } as never), "opts.subtasks must be complete or leave");
  rejectedOf(await tasks.complete("t_0000000000", neel), "unknown");
  const stale = rejectedOf(await tasks.complete(t.id, { actor: "neel", ifVersion: 1 }), "stale version");
  assert.equal(stale.record?.version, 3);
  assert.equal((await raw(t.id))!.status, "accepted");

  ok(await tasks.delete(t.id, neel));
  rejectedOf(await tasks.complete(t.id, neel), "complete on deleted");
});

test("complete on a weekly repeating task records each occurrence and advances due; uncomplete rewinds one at a time", async () => {
  const t = await add({ title: "Weekly planning review", due: { date: "2026-09-07", time: "17:00", timezone: LA }, repeat: "FREQ=WEEKLY;BYDAY=MO" });

  const first = ok(await tasks.complete(t.id, neel));
  assert.equal(first.status, "accepted", "a repeating task stays open");
  assert.equal(first.completedAt, null);
  assert.deepEqual(first.due, { date: "2026-09-14", time: "17:00", timezone: LA }, "due advances a week; time and zone stay");
  assert.deepEqual(first.occurrences, [{ date: "2026-09-07", at: now, actor: "neel" }]);
  assert.equal(first.version, 2);
  const firstEntry = await assertLogged(t.id, "task.complete", neel);
  assert.deepEqual(firstEntry.patch.due, { from: { date: "2026-09-07", time: "17:00", timezone: LA }, to: { date: "2026-09-14", time: "17:00", timezone: LA } });
  assert.ok("occurrences" in firstEntry.patch);
  assert.equal(firstEntry.patch.status, undefined, "status did not change");

  const second = ok(await tasks.complete(t.id, codex, { date: "2026-09-14" }));
  assert.equal(second.due?.date, "2026-09-21");
  assert.equal(second.occurrences.length, 2);
  assert.deepEqual(second.occurrences[1], { date: "2026-09-14", at: now, actor: "codex" });
  assert.equal(second.status, "accepted");
  assert.equal(second.version, 3);
  await assertLogged(t.id, "task.complete", codex);

  const rewound = ok(await tasks.uncomplete(t.id, neel));
  assert.equal(rewound.due?.date, "2026-09-14", "the last occurrence's date comes back");
  assert.deepEqual(rewound.due, { date: "2026-09-14", time: "17:00", timezone: LA });
  assert.deepEqual(rewound.occurrences, [{ date: "2026-09-07", at: now, actor: "neel" }]);
  assert.equal(rewound.status, "accepted");
  assert.equal(rewound.completedAt, null);
  assert.equal(rewound.version, 4);
  const rewoundEntry = await assertLogged(t.id, "task.uncomplete", neel);
  assert.deepEqual(rewoundEntry.patch.due, { from: { date: "2026-09-21", time: "17:00", timezone: LA }, to: { date: "2026-09-14", time: "17:00", timezone: LA } });

  const rewoundAgain = ok(await tasks.uncomplete(t.id, neel));
  assert.equal(rewoundAgain.due?.date, "2026-09-07");
  assert.deepEqual(rewoundAgain.occurrences, []);
  assert.equal(rewoundAgain.version, 5);
  rejectedOf(await tasks.uncomplete(t.id, neel), "nothing left to rewind");
  assert.equal((await raw(t.id))!.version, 5);

  assert.deepEqual(
    (await tasks.history(t.id)).map((e) => e.op),
    ["task.add", "task.complete", "task.complete", "task.uncomplete", "task.uncomplete"],
    "history is the task's entries in order",
  );

  const daily = await add({ title: "Take the evening medication", due: { date: today }, repeat: "FREQ=DAILY;INTERVAL=3" });
  assert.equal(ok(await tasks.complete(daily.id, neel)).due?.date, "2026-09-09");
  const monthly = await add({ title: "Pay the mortgage installment", due: { date: "2026-09-30" }, repeat: "FREQ=MONTHLY" });
  assert.equal(ok(await tasks.complete(monthly.id, neel)).due?.date, "2026-10-30");
  assert.equal(ok(await tasks.complete(monthly.id, neel)).due?.date, "2026-11-30");
});

test("complete on a parent with open sub-tasks is a question: needs subtasks, nothing changes until answered", async () => {
  const parent = await add({ title: "Plan the offsite", project: "work" });
  const openChild = await add({ title: "Book the offsite venue", parent: parent.id });
  const doneChild = await add({ title: "Pick the offsite dates", parent: parent.id });
  ok(await tasks.complete(doneChild.id, neel));
  const grandchild = await add({ title: "Ask the venue about catering", parent: openChild.id });
  const before = await logCount();

  const asked = rejectedOf(await tasks.complete(parent.id, codex), "open sub-tasks and no choice");
  assert.equal(asked.id, parent.id);
  assert.ok(asked.needs, "the rejection carries a question");
  assert.equal(asked.needs.field, "subtasks");
  assert.deepEqual(asked.needs.options, ["complete", "leave"]);
  assert.equal(typeof asked.needs.message, "string");
  assert.ok(asked.needs.message.length > 0);
  assert.equal(await logCount(), before, "nothing changed");
  assert.equal((await raw(parent.id))!.status, "accepted");
  assert.equal((await raw(parent.id))!.version, 1);
  assert.equal((await raw(openChild.id))!.status, "accepted");

  const left = ok(await tasks.complete(parent.id, codex, { subtasks: "leave" }));
  assert.equal(left.status, "done");
  assert.equal((await raw(openChild.id))!.status, "accepted", "leave keeps the sub-tasks open");
  assert.equal((await raw(grandchild.id))!.status, "accepted");
  assert.equal(await logCount(), before + 1, "only the parent was written");

  const other = await add({ title: "Plan the holiday party", project: "work" });
  const kid = await add({ title: "Book the party venue", parent: other.id });
  const grandkid = await add({ title: "Confirm the party menu", parent: kid.id });
  const started = await add({ title: "Send the party invitations", parent: other.id });
  ok(await tasks.start(started.id, neel));
  const cascaded = ok(await tasks.complete(other.id, codex, { subtasks: "complete" }));
  assert.equal(cascaded.status, "done");
  for (const t of [kid, grandkid, started]) {
    const after = (await raw(t.id))!;
    assert.equal(after.status, "done", `${t.title} completed with its parent`);
    assert.equal(after.completedAt, now);
    assert.equal(after.occurrences.length, 1);
    assert.equal(after.occurrences[0]!.actor, "codex");
    const entry = await assertCascadeLogged(t.id, codex);
    assert.deepEqual(entry.patch.status?.to, "done");
  }
  await assertLogged(other.id, "task.complete", codex);

  const closedOnly = await add({ title: "Plan the summer picnic", project: "work" });
  const done = await add({ title: "Reserve the picnic shelter", parent: closedOnly.id });
  ok(await tasks.complete(done.id, neel));
  const removed = await add({ title: "Order the picnic supplies", parent: closedOnly.id });
  ok(await tasks.delete(removed.id, neel));
  const cancelled = await add({ title: "Hire a band for the picnic", parent: closedOnly.id });
  ok(await tasks.cancel(cancelled.id, { actor: "neel", reason: "budget" }));
  ok(await tasks.complete(closedOnly.id, neel), "done, deleted, and cancelled sub-tasks are not open");
});

// ------------------------------------------------------------------ cancel

test("cancel: any open status becomes cancelled, a reason is required, closed tasks are rejected", async () => {
  const t = await add({ title: "Learn the accordion" }, codex);
  const noReason = rejectedOf(await tasks.cancel(t.id, neel), "reason required");
  assert.match(issuesText(noReason), /reason/i);
  assert.equal((await raw(t.id))!.status, "proposed");
  rejectedOf(await tasks.cancel(t.id, { actor: "neel", reason: "   " }), "a blank reason is no reason");

  const ctx: Ctx = { actor: "neel", reason: "Decided against it", evidence: ["chat:77"] };
  const cancelled = ok(await tasks.cancel(t.id, ctx));
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.completedAt, null);
  assert.equal(cancelled.version, 2);
  const entry = await assertLogged(t.id, "task.cancel", ctx);
  assert.deepEqual(entry.patch.status, { from: "proposed", to: "cancelled" });
  assert.equal(entry.reason, "Decided against it");
  rejectedOf(await tasks.cancel(t.id, ctx), "cancel on cancelled");
  assert.ok(ids(await tasks.list({ includeClosed: true })).includes(t.id), "visible in closed lists");
  assert.ok(!ids(await tasks.list()).includes(t.id));

  const accepted = await add({ title: "Learn the bagpipes" });
  assert.equal(ok(await tasks.cancel(accepted.id, ctx)).status, "cancelled");
  const inProgress = await add({ title: "Learn the theremin" });
  ok(await tasks.start(inProgress.id, neel));
  assert.equal(ok(await tasks.cancel(inProgress.id, ctx)).status, "cancelled");
  const done = await add({ title: "Learn the kazoo" });
  ok(await tasks.complete(done.id, neel));
  rejectedOf(await tasks.cancel(done.id, ctx), "cancel on done");
  rejectedOf(await tasks.cancel("t_0000000000", ctx), "unknown");
});

// ------------------------------------------------------------------ delete

test("delete: soft, leaves status alone, hides from lists; open sub-tasks are a question with delete or leave", async () => {
  const solo = await add({ title: "Descale the kettle", project: "work" });
  ok(await tasks.start(solo.id, neel));
  const deleted = ok(await tasks.delete(solo.id, codex));
  assert.equal(deleted.deletedAt, now);
  assert.equal(deleted.status, "in_progress", "status is left alone");
  assert.equal(deleted.version, 3);
  const entry = await assertLogged(solo.id, "task.delete", codex);
  assert.deepEqual(entry.patch, { deletedAt: { from: null, to: now } });
  assert.ok(!ids(await tasks.list({ project: "work", includeClosed: true })).includes(solo.id));
  assert.ok(ids(await tasks.list({ project: "work", includeDeleted: true })).includes(solo.id));
  assert.equal((await tasks.get(solo.id))?.deletedAt, now);

  const parent = await add({ title: "Repaint the hallway", project: "work" });
  const child = await add({ title: "Buy the hallway paint", parent: parent.id });
  const grandchild = await add({ title: "Pick the hallway paint colour", parent: child.id });
  const before = await logCount();
  const asked = rejectedOf(await tasks.delete(parent.id, neel), "open sub-tasks and no choice");
  assert.equal(asked.id, parent.id);
  assert.ok(asked.needs);
  assert.equal(asked.needs.field, "subtasks");
  assert.deepEqual(asked.needs.options, ["delete", "leave"]);
  assert.ok(asked.needs.message.length > 0);
  assert.equal(await logCount(), before, "nothing changed");
  assert.equal((await raw(parent.id))!.deletedAt, null);
  assert.equal((await raw(child.id))!.deletedAt, null);
  rejectedOf(await tasks.delete(parent.id, neel, { subtasks: "complete" } as never), "opts.subtasks must be delete or leave");

  const left = ok(await tasks.delete(parent.id, neel, { subtasks: "leave" }));
  assert.equal(left.deletedAt, now);
  const orphan = (await raw(child.id))!;
  assert.equal(orphan.deletedAt, null, "leave keeps the sub-task");
  assert.equal(orphan.parentId, undefined, "re-parented to the task's parent, here top level");
  assert.equal(orphan.projectId, work.id);
  assert.equal((await raw(grandchild.id))!.parentId, child.id, "the grandchild stays under its parent");
  const orphanEntry = await assertCascadeLogged(child.id, neel);
  assert.deepEqual(orphanEntry.patch.parentId, { from: parent.id, to: null });

  const top = await add({ title: "Renovate the bathroom", project: "work" });
  const mid = await add({ title: "Tile the bathroom floor", parent: top.id });
  const leaf = await add({ title: "Choose the bathroom tiles", parent: mid.id });
  ok(await tasks.delete(mid.id, neel, { subtasks: "leave" }));
  assert.equal((await raw(leaf.id))!.parentId, top.id, "re-parented to the deleted task's parent");
  assert.equal((await raw(leaf.id))!.deletedAt, null);

  const whole = await add({ title: "Build the garden shed", project: "work" });
  const plank = await add({ title: "Buy the shed timber", parent: whole.id });
  const nail = await add({ title: "Buy the shed nails", parent: plank.id });
  const alreadyDone = await add({ title: "Draw the shed plans", parent: whole.id });
  ok(await tasks.complete(alreadyDone.id, neel));
  const cascaded = ok(await tasks.delete(whole.id, codex, { subtasks: "delete" }));
  assert.equal(cascaded.deletedAt, now);
  for (const t of [plank, nail, alreadyDone]) {
    const after = (await raw(t.id))!;
    assert.equal(after.deletedAt, now, `${t.title} deleted with its parent`);
    assert.equal(after.parentId, t.parentId, "the subtree keeps its shape");
    assert.equal(after.status, t.id === alreadyDone.id ? "done" : "accepted");
    await assertCascadeLogged(t.id, codex);
  }
  assert.deepEqual(await tasks.list({ parent: whole.id }), []);
  assert.equal((await tasks.list({ parent: whole.id, includeDeleted: true, includeClosed: true })).length, 2);

  rejectedOf(await tasks.delete("t_0000000000", neel), "unknown");

  // Like complete, delete asks only about open sub-tasks (HANDS D54: "a parent with open sub-tasks asks").
  // A done child needs no choice: it goes to the trash with its parent, restorable on its own.
  const closedOnly = await add({ title: "Clear the gutters", project: "work" });
  const doneKid = await add({ title: "Borrow the tall ladder", parent: closedOnly.id });
  ok(await tasks.complete(doneKid.id, neel));
  const quietly = ok(await tasks.delete(closedOnly.id, neel), "a done sub-task needs no choice");
  assert.equal(quietly.deletedAt, now);
  assert.equal((await raw(doneKid.id))!.deletedAt, now, "deleted with its parent");
  assert.equal((await raw(doneKid.id))!.parentId, closedOnly.id, "the subtree keeps its shape");
  assert.equal((await raw(doneKid.id))!.status, "done", "status is left alone");
  await assertCascadeLogged(doneKid.id, neel);
  // An explicit "leave" still keeps a done child, re-parented like any other.
  const keptParent = await add({ title: "Sweep the chimney", project: "work" });
  const keptKid = await add({ title: "Hire the chimney brush", parent: keptParent.id });
  ok(await tasks.complete(keptKid.id, neel));
  ok(await tasks.delete(keptParent.id, neel, { subtasks: "leave" }));
  assert.equal((await raw(keptKid.id))!.deletedAt, null, "leave keeps the done child");
  assert.equal((await raw(keptKid.id))!.parentId, undefined, "re-parented like any other");
  assert.equal((await raw(keptKid.id))!.status, "done");
  // A sub-task that is already deleted is not a question.
  const emptied = await add({ title: "Wash the windows", project: "work" });
  const removedKid = await add({ title: "Buy a window squeegee", parent: emptied.id });
  ok(await tasks.delete(removedKid.id, neel));
  ok(await tasks.delete(emptied.id, neel), "a deleted sub-task does not count");
  assert.equal((await raw(removedKid.id))!.parentId, emptied.id, "and is left where it was");
});

// ------------------------------------------------------------------ restore

test("restore: clears deletedAt; a deleted parent, project, or section is not resurrected", async () => {
  const parent = await add({ title: "Organise the photo archive", project: "work", section: "Backlog" });
  const child = await add({ title: "Scan the old photo albums", parent: parent.id });
  const sibling = await add({ title: "Label the photo boxes", parent: parent.id });
  ok(await tasks.delete(parent.id, neel, { subtasks: "delete" }));
  assert.equal((await raw(child.id))!.deletedAt, now);

  const restoredChild = ok(await tasks.restore(child.id, codex));
  assert.equal(restoredChild.deletedAt, null);
  assert.equal(restoredChild.parentId, undefined, "the parent is deleted, so the task becomes top level");
  assert.equal(restoredChild.projectId, work.id, "in its own project");
  assert.equal(restoredChild.sectionId, workBacklog.id, "in its own section");
  assert.equal(restoredChild.status, "accepted");
  const entry = await assertLogged(child.id, "task.restore", codex);
  assert.deepEqual(entry.patch.deletedAt, { from: now, to: null });
  assert.deepEqual(entry.patch.parentId, { from: parent.id, to: null });
  assert.equal((await raw(parent.id))!.deletedAt, now, "restoring a child does not restore the parent");
  assert.equal((await raw(sibling.id))!.deletedAt, now, "sub-tasks deleted with the parent stay deleted");

  const restoredParent = ok(await tasks.restore(parent.id, neel));
  assert.equal(restoredParent.deletedAt, null);
  assert.equal(restoredParent.sectionId, workBacklog.id);
  assert.equal((await raw(sibling.id))!.deletedAt, now, "until restored individually");
  const restoredSibling = ok(await tasks.restore(sibling.id, neel));
  assert.equal(restoredSibling.parentId, parent.id, "the parent is back, so the link survives");
  assert.equal((await raw(child.id))!.parentId, undefined, "an earlier restore is not re-parented later");

  unchangedOf(await tasks.restore(parent.id, neel), "restore of a non-deleted task");
  assert.equal((await tasks.history(parent.id)).length, 3, "add, delete, restore; unchanged logs nothing");
  rejectedOf(await tasks.restore("t_0000000000", neel), "unknown");
  rejectedOf(await tasks.restore("nope", neel), "malformed");

  // A deleted project sends the task to the Inbox with no section.
  const doomed = await project("Doomed archive");
  const doomedSection = await section("doomed-archive", "Shelf");
  const shelved = await add({ title: "Catalogue the doomed archive", project: doomed.id, section: "Shelf" });
  const sub = await add({ title: "Number the doomed archive boxes", parent: shelved.id });
  ok(await org.project.delete(doomed.id, neel, { contents: "delete" }));
  assert.equal((await raw(shelved.id))!.deletedAt, now);
  assert.equal((await org.section.get(doomedSection.id))!.deletedAt, now);
  const inboxed = ok(await tasks.restore(shelved.id, neel));
  assert.equal(inboxed.projectId, inbox.id);
  assert.equal(inboxed.sectionId, undefined);
  assert.equal(inboxed.deletedAt, null);
  const inboxEntry = await assertLogged(shelved.id, "task.restore", neel);
  assert.deepEqual(inboxEntry.patch.projectId, { from: doomed.id, to: inbox.id });
  const subRestored = ok(await tasks.restore(sub.id, neel));
  assert.equal(subRestored.projectId, inbox.id);
  assert.equal(subRestored.parentId, shelved.id, "the parent is live again, in the Inbox");
  assert.equal(subRestored.sectionId, undefined);

  // A deleted section keeps the project and drops the section.
  const shelf = await section("work", "Shelf");
  const onShelf = await add({ title: "Dust the work shelf", project: "work", section: shelf.id });
  ok(await org.section.delete(shelf.id, neel, { tasks: "delete" }));
  assert.equal((await raw(onShelf.id))!.deletedAt, now);
  const unshelved = ok(await tasks.restore(onShelf.id, neel));
  assert.equal(unshelved.projectId, work.id);
  assert.equal(unshelved.sectionId, undefined);
  assert.equal(unshelved.deletedAt, null);

  // A deleted-then-restored task is back exactly as it was: status and history intact.
  const done = await add({ title: "Archive the old invoices", project: "work" });
  ok(await tasks.complete(done.id, neel));
  ok(await tasks.delete(done.id, neel));
  const back = ok(await tasks.restore(done.id, neel));
  assert.equal(back.status, "done");
  assert.equal(back.completedAt, now);
  assert.equal(back.occurrences.length, 1);
  assert.deepEqual((await tasks.history(done.id)).map((e) => e.op), ["task.add", "task.complete", "task.delete", "task.restore"]);
});

// ------------------------------------------------------------------ assign, reschedule, note

test("assign: executor and bucket, null clears the bucket, bad values are rejected", async () => {
  const t = await add({ title: "Chase the missing parcel" });
  const assigned = ok(await tasks.assign(t.id, { executor: "agent:concierge", bucket: "review" }, codex));
  assert.equal(assigned.executor, "agent:concierge");
  assert.equal(assigned.bucket, "review");
  assert.equal(assigned.version, 2);
  const entry = await assertLogged(t.id, "task.assign", codex);
  assert.deepEqual(entry.patch, { executor: { from: "neel", to: "agent:concierge" }, bucket: { from: null, to: "review" } });

  const rebucketed = ok(await tasks.assign(t.id, { bucket: "unsafe" }, neel));
  assert.equal(rebucketed.bucket, "unsafe");
  assert.equal(rebucketed.executor, "agent:concierge", "untouched fields stay");
  const cleared = ok(await tasks.assign(t.id, { bucket: null }, neel));
  assert.equal(cleared.bucket, undefined);
  assert.deepEqual((await lastLog(t.id)).patch, { bucket: { from: "unsafe", to: null } });
  const back = ok(await tasks.assign(t.id, { executor: "neel" }, neel));
  assert.equal(back.executor, "neel");
  unchangedOf(await tasks.assign(t.id, { executor: "neel", bucket: null }, neel), "same values");
  assert.equal((await tasks.history(t.id)).length, 5);

  rejectedOf(await tasks.assign(t.id, { executor: "codex" }, neel), "codex is not an executor");
  rejectedOf(await tasks.assign(t.id, { executor: "import:todoist" }, neel), "importers are not executors");
  rejectedOf(await tasks.assign(t.id, { bucket: "maybe" as never }, neel), "unknown bucket");
  rejectedOf(await tasks.assign(t.id, { executor: null as never }, neel), "executor cannot be cleared");
  rejectedOf(await tasks.assign(t.id, { bogus: 1 } as never, neel), "unknown field");
  rejectedOf(await tasks.assign("t_0000000000", { executor: "neel" }, neel), "unknown");
  assert.equal((await raw(t.id))!.version, back.version);
  ok(await tasks.complete(t.id, neel));
  ok(await tasks.assign(t.id, { bucket: "safe" }, neel), "assign works on any status");
});

test("reschedule: sets or clears due on open tasks; repeating tasks cannot go undated", async () => {
  const t = await add({ title: "Call the insurance broker" });
  const dated = ok(await tasks.reschedule(t.id, { date: "2026-09-10" }, codex));
  assert.deepEqual(dated.due, { date: "2026-09-10" });
  assert.equal(dated.version, 2);
  const entry = await assertLogged(t.id, "task.reschedule", codex);
  assert.deepEqual(entry.patch, { due: { from: null, to: { date: "2026-09-10" } } });
  const timed = ok(await tasks.reschedule(t.id, { date: "2026-09-11", time: "14:00", timezone: "Europe/Lisbon" }, neel));
  assert.deepEqual(timed.due, { date: "2026-09-11", time: "14:00", timezone: "Europe/Lisbon" });
  unchangedOf(await tasks.reschedule(t.id, { date: "2026-09-11", time: "14:00", timezone: "Europe/Lisbon" }, neel), "same due");
  const cleared = ok(await tasks.reschedule(t.id, null, neel));
  assert.equal(cleared.due, null);
  assert.deepEqual((await lastLog(t.id)).patch, { due: { from: { date: "2026-09-11", time: "14:00", timezone: "Europe/Lisbon" }, to: null } });
  assert.equal(cleared.deadline, null, "deadline is independent of due");

  rejectedOf(await tasks.reschedule(t.id, { date: "2026-09-11", time: "14:00" } as never, neel), "time without a timezone");
  rejectedOf(await tasks.reschedule(t.id, { date: "tomorrow" }, neel), "relative dates are the CLI's job");
  rejectedOf(await tasks.reschedule(t.id, { date: "2026-02-30" }, neel), "impossible date");
  rejectedOf(await tasks.reschedule(t.id, "2026-09-11" as never, neel), "a due is an object");
  rejectedOf(await tasks.reschedule("t_0000000000", { date: "2026-09-10" }, neel), "unknown");

  const repeating = await add({ title: "Water the ferns", due: { date: "2026-09-08" }, repeat: "FREQ=WEEKLY" });
  const undate = rejectedOf(await tasks.reschedule(repeating.id, null, neel), "repeating tasks cannot go undated");
  assert.match(issuesText(undate), /repeat|due/i);
  assert.equal(ok(await tasks.reschedule(repeating.id, { date: "2026-09-09" }, neel)).due?.date, "2026-09-09");

  const proposed = await add({ title: "Call the mortgage broker" }, codex);
  assert.deepEqual(ok(await tasks.reschedule(proposed.id, { date: "2026-09-12" }, neel)).due, { date: "2026-09-12" }, "proposed is open");
  ok(await tasks.complete(t.id, neel));
  const closed = rejectedOf(await tasks.reschedule(t.id, { date: "2026-09-12" }, neel), "done is not open");
  assert.match(issuesText(closed), /status|done|open/i);
  const cancelled = await add({ title: "Call the travel agent" });
  ok(await tasks.cancel(cancelled.id, { actor: "neel", reason: "booked online" }));
  rejectedOf(await tasks.reschedule(cancelled.id, { date: "2026-09-12" }, neel), "cancelled is not open");
});

test("note: appends a comment with the ctx's actor, on any status", async () => {
  const t = await add({ title: "Fix the leaking tap" });
  const noted = ok(await tasks.note(t.id, "Plumber can come Thursday", codex, [{ name: "quote", url: "vault:Quotes/plumber.pdf" }]));
  assert.deepEqual(noted.comments, [{ actor: "codex", at: now, text: "Plumber can come Thursday", attachments: [{ name: "quote", url: "vault:Quotes/plumber.pdf" }] }]);
  assert.equal(noted.version, 2);
  assert.equal(noted.status, "accepted");
  const entry = await assertLogged(t.id, "task.note", codex);
  assert.deepEqual(patchKeys(entry), ["comments"]);

  const plain = ok(await tasksLater.note(t.id, "  Confirmed for 10am  ", neel));
  assert.equal(plain.comments.length, 2);
  assert.deepEqual(plain.comments[1], { actor: "neel", at: laterIso, text: "Confirmed for 10am", attachments: [] });
  assert.equal(plain.updatedAt, laterIso);
  assert.equal(plain.version, 3);
  assert.equal((await lastLog(t.id)).at, laterIso);
  assert.deepEqual(ids(await tasks.list({ filter: "search: 10am" })), [t.id], "comments are searchable");

  ok(await tasks.complete(t.id, neel));
  const onDone = ok(await tasks.note(t.id, "Tap fixed, no more drip", { actor: "agent:plumber" }));
  assert.equal(onDone.comments.length, 3);
  assert.equal(onDone.comments[2]!.actor, "agent:plumber");
  assert.equal(onDone.status, "done");
  const cancelled = await add({ title: "Replace the tap entirely" }, codex);
  ok(await tasks.cancel(cancelled.id, { actor: "neel", reason: "repair was enough" }));
  assert.equal(ok(await tasks.note(cancelled.id, "Keeping the note for the record", neel)).comments.length, 1);

  rejectedOf(await tasks.note(t.id, "", neel), "empty text");
  rejectedOf(await tasks.note(t.id, "   ", neel), "blank text");
  rejectedOf(await tasks.note(t.id, "bad attachment", neel, [{ name: "", url: "x" }]), "attachment needs a name");
  rejectedOf(await tasks.note(t.id, "bad attachment", neel, [{ name: "x", url: "" }]), "attachment needs a url");
  rejectedOf(await tasks.note("t_0000000000", "nobody home", neel), "unknown");
  rejectedOf(await tasks.note(t.id, "no actor", {} as Ctx), "ctx needs an actor");
  assert.equal((await raw(t.id))!.comments.length, 3);
});

test("history: the task's entries in order; unknown ids have none", async () => {
  const t = await add({ title: "Sharpen the kitchen knives" }, codex);
  ok(await tasks.accept(t.id, neel));
  ok(await tasks.start(t.id, neel));
  ok(await tasks.note(t.id, "Whetstone is in the drawer", neel));
  ok(await tasks.complete(t.id, { actor: "neel", key: "knives-done" }));
  const history = await tasks.history(t.id);
  assert.deepEqual(history.map((e) => e.op), ["task.add", "task.accept", "task.start", "task.note", "task.complete"]);
  assert.deepEqual(history.map((e) => e.actor), ["codex", "neel", "neel", "neel", "neel"]);
  assert.ok(history.every((e, i) => i === 0 || e.seq > history[i - 1]!.seq), "seq increases");
  assert.ok(history.every((e) => e.recordKind === "task" && e.recordId === t.id && e.at === now));
  assert.equal(history[0]!.reason, codex.reason);
  assert.equal(history[4]!.key, "knives-done");
  assert.deepEqual(await tasks.history("t_0000000000"), []);
  const same = await tasks.complete(t.id, { actor: "neel", key: "knives-done" });
  assert.equal(same.ok, true, "the key returns the stored ok receipt even though the task is now done");
  assert.equal((await tasks.history(t.id)).length, 5, "and applies nothing");
});

// ------------------------------------------------------------------ batch

test("batch: one transaction, one receipt per item in order; by default each item succeeds or fails on its own", async () => {
  const lab = await project("Batch lab");
  const a = await add({ title: "Batch alpha", project: lab.id }, codex);
  const b = await add({ title: "Batch bravo", project: lab.id });
  const c = await add({ title: "Batch charlie", project: lab.id });
  const d = await add({ title: "Batch delta", project: lab.id });
  const dKid = await add({ title: "Batch delta child", parent: d.id });
  const before = await logCount();

  const items: BatchItem[] = [
    { op: "accept", id: a.id },
    { op: "start", id: a.id },
    { op: "complete", id: "t_0000000000" },
    { op: "cancel", id: b.id },
    { op: "reschedule", id: c.id, input: { date: "2026-09-10" } },
    { op: "assign", id: c.id, input: { executor: "agent:batcher", bucket: "safe" } },
    { op: "update", id: c.id, input: { title: "Batch charlie renamed", priority: 1 } },
    { op: "move", id: c.id, input: { project: "work", section: "Backlog" } },
    { op: "duplicate", id: c.id, options: { subtasks: false } },
    { op: "complete", id: d.id },
    { op: "delete", id: d.id, options: { subtasks: "leave" } },
    { op: "restore", id: d.id },
    { op: "uncomplete", id: b.id },
    { op: "frobnicate", id: c.id } as unknown as BatchItem,
    { op: "update", id: c.id, input: { bogus: true } },
  ];
  const receipts = await tasks.batch(items, neel);
  assert.equal(receipts.length, items.length);
  assert.equal(ok(receipts[0]!, "accept").status, "accepted");
  assert.equal(ok(receipts[1]!, "start after accept in the same transaction").status, "in_progress");
  rejectedOf(receipts[2]!, "unknown id");
  assert.match(issuesText(rejectedOf(receipts[3]!, "cancel without a reason")), /reason/i);
  assert.deepEqual(ok(receipts[4]!, "reschedule").due, { date: "2026-09-10" });
  assert.equal(ok(receipts[5]!, "assign").executor, "agent:batcher");
  assert.equal(ok(receipts[6]!, "update").title, "Batch charlie renamed");
  assert.equal(ok(receipts[7]!, "move").sectionId, workBacklog.id);
  const dup = ok(receipts[8]!, "duplicate");
  assert.notEqual(dup.id, c.id);
  assert.equal(dup.title, "Batch charlie renamed");
  assert.equal(dup.projectId, work.id);
  const asked = rejectedOf(receipts[9]!, "complete with an open sub-task");
  assert.equal(asked.needs?.field, "subtasks");
  assert.equal(ok(receipts[10]!, "delete leave").deletedAt, now);
  assert.equal(ok(receipts[11]!, "restore").deletedAt, null);
  rejectedOf(receipts[12]!, "uncomplete on an open task");
  assert.match(issuesText(rejectedOf(receipts[13]!, "unknown op")), /op|frobnicate/i);
  rejectedOf(receipts[14]!, "bad input");
  for (const r of receipts) if (r.ok) assert.ok(r.record.id && r.version >= 1);

  const cAfter = (await raw(c.id))!;
  assert.equal(cAfter.title, "Batch charlie renamed");
  assert.equal(cAfter.priority, 1);
  assert.deepEqual(cAfter.due, { date: "2026-09-10" });
  assert.equal(cAfter.executor, "agent:batcher");
  assert.equal(cAfter.bucket, "safe");
  assert.equal(cAfter.projectId, work.id);
  assert.equal(cAfter.sectionId, workBacklog.id);
  assert.equal(cAfter.version, 5, "reschedule, assign, update, move");
  assert.equal((await raw(a.id))!.status, "in_progress");
  assert.equal((await raw(b.id))!.status, "accepted", "the rejected items changed nothing");
  assert.equal((await raw(b.id))!.version, 1);
  assert.equal((await raw(d.id))!.deletedAt, null);
  assert.equal((await raw(d.id))!.status, "accepted");
  assert.equal((await raw(dKid.id))!.parentId, undefined, "leave re-parented the child");
  assert.equal((await raw(dup.id))!.title, "Batch charlie renamed");
  assert.deepEqual((await tasks.history(a.id)).map((e) => e.op), ["task.add", "task.accept", "task.start"], "each applied item logs its own entry");
  assert.deepEqual((await tasks.history(d.id)).map((e) => e.op), ["task.add", "task.delete", "task.restore"]);
  assert.equal(await logCount(), before + 10, "accept, start, reschedule, assign, update, move, duplicate, delete + its cascade, restore");

  assert.deepEqual(await tasks.batch([], neel), []);
  const badCtx = await tasks.batch([{ op: "accept", id: a.id }], { actor: "nobody" } as Ctx);
  assert.equal(badCtx.length, 1);
  rejectedOf(badCtx[0]!, "bad ctx");
});

test("batch atomic: any rejection rolls everything back and every receipt reports it", async () => {
  const lab = await project("Atomic lab");
  const e = await add({ title: "Atomic echo", project: lab.id });
  const f = await add({ title: "Atomic foxtrot", project: lab.id });
  const before = await logCount();

  const failed = await tasks.batch(
    [
      { op: "start", id: e.id },
      { op: "reschedule", id: f.id, input: { date: "2026-09-10" } },
      { op: "complete", id: "t_0000000000" },
    ],
    neel,
    { atomic: true },
  );
  assert.equal(failed.length, 3);
  for (const r of failed) rejectedOf(r, "atomic: every receipt is rejected");
  assert.match(failed.map(issuesText).join("\n"), /t_0000000000|not found|no task/i, "the receipts say what failed");
  assert.equal((await raw(e.id))!.status, "accepted", "nothing was persisted");
  assert.equal((await raw(e.id))!.version, 1);
  assert.equal((await raw(f.id))!.due, null);
  assert.equal(await logCount(), before, "and nothing was logged");
  assert.equal((await tasks.history(e.id)).length, 1);

  const applied = await tasks.batch(
    [
      { op: "start", id: e.id },
      { op: "reschedule", id: f.id, input: { date: "2026-09-10" } },
      { op: "note", id: f.id } as unknown as BatchItem,
    ],
    codex,
    { atomic: true },
  );
  for (const r of applied) rejectedOf(r, "an unknown op is a rejection too");
  assert.equal((await raw(e.id))!.status, "accepted");

  const succeeded = await tasks.batch(
    [
      { op: "start", id: e.id },
      { op: "reschedule", id: f.id, input: { date: "2026-09-10" } },
      { op: "cancel", id: f.id },
    ],
    codex,
    { atomic: true },
  );
  assert.equal(succeeded.length, 3);
  assert.equal(ok(succeeded[0]!).status, "in_progress");
  assert.deepEqual(ok(succeeded[1]!).due, { date: "2026-09-10" });
  assert.equal(ok(succeeded[2]!).status, "cancelled");
  assert.equal((await raw(e.id))!.status, "in_progress");
  assert.equal((await raw(f.id))!.status, "cancelled");
  assert.equal((await raw(f.id))!.version, 3);
  assert.equal(await logCount(), before + 3);
  await assertLogged(f.id, "task.cancel", codex);
});

// ------------------------------------------------------------------ import

test("import: one transaction with per-item outcomes; dryRun reports the same and persists nothing", async () => {
  const lab = await project("Import lab");
  const existing = await add({ title: "Renew the car insurance", project: lab.id });
  const importer: Ctx = { actor: "import:todoist", reason: "Todoist export of Sept 6", evidence: ["todoist:export:2026-09-06"] };
  const items: unknown[] = [
    { title: "Renew the car insurance", project: "import-lab" },
    { title: "Pay the electricity bill", project: "import-lab", id: "t_import0001", labels: ["bills"], due: { date: "2026-09-15" }, priority: 2 },
    { title: "", project: "import-lab" },
    { title: "Pay the electricity bill", project: "import-lab" },
    { title: "Call the plumber about the boiler", project: "nowhere/at-all" },
    { title: "Call the plumber about the boiler", id: existing.id },
    { title: "Call the plumber about the boiler", project: lab.id, status: "accepted", section: "Nope" },
    { title: "Call the plumber about the boiler", project: lab.id, status: "accepted" },
    { title: "Bad id", project: lab.id, id: "p_import0001" },
    "not an object",
  ];
  const expectedOutcomes = ["duplicate", "created", "rejected", "duplicate", "rejected", "rejected", "rejected", "created", "rejected", "rejected"];

  const before = await logCount();
  const labelsBefore = (await org.label.list()).length;
  const dry: ImportResult = await tasks.import(items, importer, { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.created, 2);
  assert.equal(dry.duplicate, 2);
  assert.equal(dry.rejected, 6);
  assert.equal(dry.items.length, items.length);
  assert.deepEqual(dry.items.map((i) => i.index), items.map((_, i) => i));
  assert.deepEqual(dry.items.map((i) => i.outcome), expectedOutcomes);
  assert.equal(dry.items[1]!.id, "t_import0001", "a given id is honored");
  assert.match(dry.items[7]!.id ?? "", /^t_[a-z0-9]{10}$/, "a created item reports its id");
  for (const [i, item] of dry.items.entries()) {
    if (item.outcome === "created") assert.deepEqual(item.issues, [], `item ${i} has no issues`);
    else assert.ok(item.issues.length > 0, `item ${i} explains itself`);
  }
  assert.match(dry.items[5]!.issues.join("\n"), /id/i, "an id in use is rejected");
  assert.match(dry.items[8]!.issues.join("\n"), /id/i, "a non-task id is rejected");
  assert.equal(await tasks.get("t_import0001"), null, "dryRun persisted nothing");
  assert.equal(await tasks.get(dry.items[7]!.id!), null);
  assert.deepEqual(ids(await tasks.list({ project: lab.id, includeClosed: true, includeDeleted: true })), [existing.id]);
  assert.equal(await org.label.get("bills"), null, "not even the labels");
  assert.equal((await org.label.list()).length, labelsBefore);
  assert.equal(await logCount(), before, "and logged nothing");

  const real = await tasks.import(items, importer);
  assert.equal(real.dryRun, false);
  assert.deepEqual([real.created, real.duplicate, real.rejected], [2, 2, 6]);
  assert.deepEqual(real.items.map((i) => i.outcome), expectedOutcomes);
  const bill = await tasks.get("t_import0001");
  assert.ok(bill);
  assert.equal(bill.title, "Pay the electricity bill");
  assert.equal(bill.projectId, lab.id);
  assert.deepEqual(bill.labels, ["bills"]);
  assert.deepEqual(bill.due, { date: "2026-09-15" });
  assert.equal(bill.priority, 2);
  assert.equal(bill.status, "proposed", "an importer's tasks land proposed unless the item says otherwise");
  assert.equal(bill.executor, "neel");
  assert.equal(bill.origin.actor, "import:todoist");
  assert.equal(bill.origin.reason, importer.reason);
  const plumber = await tasks.get(real.items[7]!.id!);
  assert.ok(plumber);
  assert.equal(plumber.status, "accepted");
  assert.equal(plumber.projectId, lab.id);
  assert.deepEqual(ids(await tasks.list({ project: lab.id })).sort(), [existing.id, bill.id, plumber.id].sort());
  const label = await org.label.get("bills");
  assert.ok(label, "labels are registered on import");
  assert.equal(label.origin.actor, "import:todoist");
  for (const id of [bill.id, plumber.id]) {
    const entry = await lastLog(id);
    assert.match(entry.op, /^task\./);
    assert.equal(entry.actor, "import:todoist");
    assert.equal(entry.reason, importer.reason);
    assert.deepEqual(entry.evidence, importer.evidence);
    assert.deepEqual(entry.patch.title, { from: null, to: (await raw(id))!.title });
  }
  assert.equal(await logCount(), before + 3, "two tasks and one label");

  const again = await tasks.import([{ title: "Pay the electricity bill", project: lab.id, id: "t_import0001" }], importer);
  assert.deepEqual([again.created, again.duplicate, again.rejected], [0, 0, 1], "a used id is rejected before the duplicate check");
  assert.deepEqual(await tasks.import([], importer), { dryRun: false, created: 0, duplicate: 0, rejected: 0, items: [] });
  const badCtx = await tasks.import([{ title: "Nobody home" }], { actor: "nobody" } as Ctx);
  assert.equal(badCtx.created, 0);
  assert.equal(badCtx.rejected, 1);
  assert.equal(await tasks.get(badCtx.items[0]?.id ?? "t_0000000000"), null);
});

// ------------------------------------------------------------------ the log as a whole

test("every task mutation in this file left one log entry with an actor, a task op, and a non-empty patch", async () => {
  const log = await db.store.read((tx) => tx.allLog());
  const taskEntries = log.filter((e) => e.recordKind === "task");
  assert.ok(taskEntries.length > 100, `expected many task entries, got ${taskEntries.length}`);
  for (const e of taskEntries) {
    assert.match(e.actor, /^(neel|codex|agent:[a-z0-9._-]+|import:[a-z0-9._-]+)$/, `entry ${e.seq}`);
    assert.match(e.op, /^(task|project|section|label)\.[a-z]+$/, `entry ${e.seq}: ${e.op}`);
    assert.match(e.recordId, /^t_[a-z0-9]{10}$/, `entry ${e.seq}`);
    assert.ok(Object.keys(e.patch).length > 0, `entry ${e.seq} (${e.op} on ${e.recordId}) has an empty patch`);
    assert.ok(!("version" in e.patch) && !("updatedAt" in e.patch), `entry ${e.seq} leaks bookkeeping`);
    assert.match(e.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  }
  const seqs = log.map((e) => e.seq);
  assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y), "allLog is in sequence order");
  // Every live task's version equals the number of log entries that touched it.
  const all = await db.store.read((tx) => tx.all("task", { includeDeleted: true }));
  for (const t of all) {
    const touched = taskEntries.filter((e) => e.recordId === t.id).length;
    assert.equal(t.version, touched, `${t.title} (${t.id}): version ${t.version} but ${touched} log entries`);
  }
});
