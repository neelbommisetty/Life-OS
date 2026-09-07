import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Ctx, Project, Receipt, Task, TaskAdd } from "./contract.ts";
import { ITEM_KEY_SEPARATOR } from "./core.ts";
import { createTestDb, fixedClock, type TestDb } from "./db/testing.ts";
import { createOrganize, type Organize } from "./organize.ts";
import { childrenOf, createTasks, descendantsOf, findDuplicates, normalizeTitle, similarTitles, type TaskOps } from "./tasks.ts";

// 2026-09-06T12:00Z is 05:00 in Los Angeles, so "today" is 2026-09-06. Sep 7 is a Monday.
const clock = fixedClock("2026-09-06T12:00:00Z");
const now = "2026-09-06T12:00:00Z";
const neel: Ctx = { actor: "neel" };
const codex: Ctx = { actor: "codex", reason: "inferred from notes", evidence: ["vault:Areas/Health.md#2026-09-04"] };
const origin = { actor: "neel", at: now, evidence: [] };

let db: TestDb;
let org: Organize;
let tasks: TaskOps;
before(async () => {
  db = await createTestDb();
  org = createOrganize(db.store, clock);
  tasks = createTasks(db.store, clock, org);
});
after(() => db.drop());

/** Assert a receipt is ok and hand back its record. */
function okRecord<T>(receipt: Receipt<T>, label = "receipt"): T {
  assert.equal(receipt.ok, true, `${label}: ${JSON.stringify(receipt)}`);
  if (!receipt.ok) throw new Error("unreachable");
  return receipt.record;
}

function rejectedWith<T>(receipt: Receipt<T>, pattern: RegExp): Extract<Receipt<T>, { outcome: "rejected" }> {
  assert.equal(receipt.ok, false, JSON.stringify(receipt));
  assert.equal(receipt.outcome, "rejected", JSON.stringify(receipt));
  assert.match(receipt.issues.join("\n"), pattern);
  return receipt as Extract<Receipt<T>, { outcome: "rejected" }>;
}

function duplicateOf<T>(receipt: Receipt<T>): Extract<Receipt<T>, { outcome: "duplicate" }> {
  assert.equal(receipt.ok, false, JSON.stringify(receipt));
  assert.equal(receipt.outcome, "duplicate", JSON.stringify(receipt));
  return receipt as Extract<Receipt<T>, { outcome: "duplicate" }>;
}

/** A fixture task; allowDuplicate keeps fixtures from tripping the duplicate check across tests. */
const mk = async (title: string, extra: Partial<TaskAdd> = {}, ctx: Ctx = neel): Promise<Task> => okRecord(await tasks.add({ title, allowDuplicate: true, ...extra }, ctx), title);
const project = async (name: string, extra: { parent?: string; labels?: string[] } = {}): Promise<Project> => okRecord(await org.project.add({ name, ...extra }, neel), name);
const section = async (projectRef: string, name: string) => okRecord(await org.section.add({ project: projectRef, name }, neel), name);
const history = (id: string) => db.store.read((tx) => tx.history("task", id));
const ops = async (id: string) => (await history(id)).map((e) => e.op);
const logCount = () => db.store.read(async (tx) => (await tx.allLog()).length);
/** The key batch, reorder, and import store item `index` under. */
const itemKey = (key: string, index: number): string => `${key}${ITEM_KEY_SEPARATOR}${index}`;
const get = async (id: string): Promise<Task> => {
  const task = await tasks.get(id);
  assert.ok(task, `task ${id} exists`);
  return task;
};

const fixture = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  notes: "",
  projectId: "p_fixture000",
  order: 0,
  status: "accepted",
  executor: "neel",
  due: null,
  deadline: null,
  labels: [],
  comments: [],
  occurrences: [],
  origin,
  external: [],
  completedAt: null,
  version: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...extra,
});

// ------------------------------------------------------------------ pure helpers

test("normalizeTitle, similarTitles thresholds, findDuplicates, childrenOf, descendantsOf", () => {
  assert.equal(normalizeTitle("  Book the Dentist!!  "), "book the dentist");
  assert.equal(normalizeTitle("Café Déjà-Vu"), "cafe deja vu");
  assert.equal(normalizeTitle("!!!"), "");

  assert.equal(similarTitles("Call Mom", "call mom"), true, "same normalized title");
  assert.equal(similarTitles("Call mom", "Call mom now"), false, "fewer than three words: only exact matches count");
  assert.equal(similarTitles("book dentist appointment", "book dentist appointment now"), true, "3/4 = 0.75");
  assert.equal(similarTitles("book dentist appointment", "book doctor appointment"), false, "2/4 = 0.5");
  assert.equal(similarTitles("a b c d", "a b c e"), false, "3/5 = 0.6");
  assert.equal(similarTitles("a b c d", "a b c d e"), true, "4/5 = 0.8");
  assert.equal(similarTitles("!!!", "???"), false, "empty after normalization never matches");

  const open = fixture("t_dup0000001", { title: "Pay the rent" });
  const done = fixture("t_dup0000002", { title: "Pay the rent", status: "done" });
  const gone = fixture("t_dup0000003", { title: "Pay the rent", deletedAt: now });
  const other = fixture("t_dup0000004", { title: "Pay the electricity bill" });
  assert.deepEqual(findDuplicates("pay the rent", [done, gone, other, open]).map((t) => t.id), [open.id]);

  const root = fixture("t_tree000001");
  const a = fixture("t_tree00000a", { parentId: root.id, order: 1 });
  const b = fixture("t_tree00000b", { parentId: root.id, order: 0 });
  const aa = fixture("t_tree0000aa", { parentId: a.id });
  const loop = fixture("t_tree0000lp", { parentId: "t_tree0000lp" });
  assert.deepEqual(childrenOf(root.id, [aa, a, b, loop]).map((t) => t.id), [b.id, a.id]);
  assert.deepEqual(descendantsOf(root.id, [aa, a, b, loop]).map((t) => t.id), [b.id, a.id, aa.id]);
  assert.deepEqual(descendantsOf(loop.id, [loop]), [], "a self-parented task does not loop");
});

// ------------------------------------------------------------------ add

test("add lands in the Inbox as accepted for neel, orders last, logs, and honors the key", async () => {
  const before = await logCount();
  const ctx = { actor: "neel", reason: "asked", evidence: ["msg:1"], key: "add-1" };
  const receipt = await tasks.add({ title: "  Book the dentist  " }, ctx);
  const task = okRecord(receipt);
  const inbox = await org.project.get("inbox");
  assert.equal(receipt.outcome, "created");
  assert.match(task.id, /^t_[a-z0-9]{10}$/);
  assert.equal(task.title, "Book the dentist");
  assert.equal(task.projectId, inbox!.id);
  assert.equal(task.sectionId, undefined);
  assert.equal(task.parentId, undefined);
  assert.equal(task.status, "accepted");
  assert.equal(task.executor, "neel");
  assert.equal(task.order, 0);
  assert.equal(task.notes, "");
  assert.deepEqual(task.labels, []);
  assert.equal(task.due, null);
  assert.equal(task.deadline, null);
  assert.deepEqual(task.comments, []);
  assert.deepEqual(task.occurrences, []);
  assert.deepEqual(task.origin, { actor: "neel", at: now, reason: "asked", evidence: ["msg:1"] });
  assert.equal(task.version, 1);
  assert.equal(task.createdAt, now);
  assert.equal(task.deletedAt, null);
  assert.deepEqual(await tasks.get(task.id), task);

  const entries = await history(task.id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.op, "task.add");
  assert.equal(entries[0]!.actor, "neel");
  assert.equal(entries[0]!.key, "add-1");
  assert.equal(entries[0]!.reason, "asked");
  assert.deepEqual(entries[0]!.patch.title, { from: null, to: "Book the dentist" });
  assert.equal(await logCount(), before + 2, "the Inbox creation and the task");

  assert.deepEqual(await tasks.add({ title: "ignored" }, ctx), receipt, "the key returns the stored receipt");
  assert.equal(await logCount(), before + 2);

  const second = await mk("Renew the passport");
  assert.equal(second.order, 1, "max order in the Inbox scope plus one");
});

test("add: status follows the actor unless given, labels are registered with the same ctx, invalid input is rejected", async () => {
  const proposed = await mk("Follow up on lab results", { labels: ["health", "health"] }, codex);
  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.executor, "neel");
  assert.deepEqual(proposed.labels, ["health"]);
  assert.deepEqual(proposed.origin, { actor: "codex", at: now, reason: codex.reason, evidence: codex.evidence });
  const label = await org.label.get("health");
  assert.equal(label?.origin.actor, "codex", "the label was created with the same ctx");
  assert.equal(label?.origin.reason, codex.reason);
  assert.equal((await db.store.read((tx) => tx.history("label", label!.id)))[0]!.key, null);

  assert.equal((await mk("Codex says accepted", { status: "accepted" }, codex)).status, "accepted");
  assert.equal((await mk("Neel says proposed", { status: "proposed" })).status, "proposed");
  const full = await mk("Everything set", {
    notes: "some notes",
    executor: "agent:booker",
    bucket: "review",
    due: { date: "2026-09-10", time: "09:30", timezone: "America/Los_Angeles" },
    repeat: "FREQ=WEEKLY;BYDAY=MO",
    deadline: "2026-09-30",
    duration: 45,
    priority: 2,
    external: [{ provider: "todoist", id: "123" }],
  });
  assert.equal(full.executor, "agent:booker");
  assert.equal(full.bucket, "review");
  assert.deepEqual(full.due, { date: "2026-09-10", time: "09:30", timezone: "America/Los_Angeles" });
  assert.equal(full.repeat, "FREQ=WEEKLY;BYDAY=MO");
  assert.equal(full.deadline, "2026-09-30");
  assert.equal(full.duration, 45);
  assert.equal(full.priority, 2);
  assert.deepEqual(full.external, [{ provider: "todoist", id: "123" }]);

  rejectedWith(await tasks.add({ title: "   " }, neel), /^title: /m);
  rejectedWith(await tasks.add({ title: "Repeat needs due", repeat: "FREQ=DAILY" }, neel), /repeating task needs a due date/);
  rejectedWith(await tasks.add({ title: "Bad rule", repeat: "FREQ=HOURLY", due: { date: "2026-09-10" } }, neel), /^repeat: /m);
  rejectedWith(await tasks.add({ title: "Time needs tz", due: { date: "2026-09-10", time: "09:00" } }, neel), /timezone/);
  rejectedWith(await tasks.add({ title: "Bad executor", executor: "codex" as never }, neel), /^executor: /m);
  rejectedWith(await tasks.add({ title: "Bad status", status: "done" as never }, neel), /^status: /m);
  rejectedWith(await tasks.add({ title: "Nobody" }, { actor: "nobody" } as Ctx), /actor/);
  rejectedWith(await tasks.add({ title: "Extra", extra: 1 } as never, neel), /extra/);
});

test("add resolves project refs, sections by name or id, and parents that imply project and section", async () => {
  const health = await project("Health");
  const dental = await project("Dental", { parent: health.id });
  const nowSection = await section(health.id, "Now");
  const later = await section(health.id, "Later");

  assert.equal((await mk("By slug path", { project: "health/dental" })).projectId, dental.id);
  assert.equal((await mk("By id", { project: health.id })).projectId, health.id);
  assert.equal((await mk("By inbox", { project: "inbox" })).projectId, (await org.project.get("inbox"))!.id);
  assert.equal((await mk("Section by name", { project: "health", section: "now" })).sectionId, nowSection.id);
  assert.equal((await mk("Section by id", { project: "health", section: later.id })).sectionId, later.id);
  rejectedWith(await tasks.add({ title: "No such section", project: "health", section: "Someday" }, neel), /section: no section "Someday" in project "health"/);
  rejectedWith(await tasks.add({ title: "Section of another project", project: "health/dental", section: nowSection.id }, neel), /section: no section/);
  rejectedWith(await tasks.add({ title: "No such project", project: "nope" }, neel), /project: no project "nope"/);

  const parent = await mk("Parent in Now", { project: "health", section: "Now" });
  const child = await mk("Child one", { parent: parent.id });
  assert.equal(child.projectId, health.id, "the project comes from the parent");
  assert.equal(child.sectionId, nowSection.id, "the section is inherited");
  assert.equal(child.parentId, parent.id);
  assert.equal(child.order, 0, "order counts within the parent");
  assert.equal((await mk("Child two", { parent: parent.id, project: "health", section: "Now" })).order, 1);
  rejectedWith(await tasks.add({ title: "Wrong project", parent: parent.id, project: "health/dental" }, neel), /parent: task .* is not in project "health\/dental"/);
  rejectedWith(await tasks.add({ title: "Wrong section", parent: parent.id, section: "Later" }, neel), /sub-task lives in its parent's section/);
  rejectedWith(await tasks.add({ title: "No such parent", parent: "t_nothere001" }, neel), /parent: no task "t_nothere001"/);
  rejectedWith(await tasks.add({ title: "Not an id", parent: "parent" } as never, neel), /^parent: /m);

  const doomed = await mk("Doomed parent");
  okRecord(await tasks.delete(doomed.id, neel));
  rejectedWith(await tasks.add({ title: "Under deleted", parent: doomed.id }, neel), /parent: task .* is deleted; restore it first/);
  const temp = await project("Temp Project");
  okRecord(await org.project.delete(temp.id, neel));
  rejectedWith(await tasks.add({ title: "In deleted project", project: temp.id }, neel), /project: project .* is deleted; restore it first/);
});

test("add: the duplicate check returns candidates among open tasks unless allowDuplicate", async () => {
  const first = okRecord(await tasks.add({ title: "Schedule six-month dental cleaning" }, neel));
  const before = await logCount();

  const exact = duplicateOf(await tasks.add({ title: "schedule SIX-month dental cleaning!" }, { actor: "neel", key: "dup-1" }));
  assert.deepEqual(exact.candidates.map((t) => t.id), [first.id]);
  assert.match(exact.issues[0]!, new RegExp(`Similar open tasks exist \\(${first.id}\\); pass allowDuplicate`));
  assert.equal(exact.id, undefined);
  assert.equal(await logCount(), before, "nothing written");
  assert.equal(await db.store.read((tx) => tx.getReceipt("dup-1")), null, "duplicate receipts are never stored");

  const near = duplicateOf(await tasks.add({ title: "Schedule six-month dental cleaning soon" }, neel));
  assert.deepEqual(near.candidates.map((t) => t.id), [first.id], "5/6 shared words");
  okRecord(await tasks.add({ title: "Schedule dental cleaning" }, neel), "3/5 shared words is below the threshold");
  okRecord(await tasks.add({ title: "Pay rent" }, neel));
  okRecord(await tasks.add({ title: "Pay rent now" }, neel), "two-word titles only match exactly");
  duplicateOf(await tasks.add({ title: "pay rent" }, codex));

  const allowed = okRecord(await tasks.add({ title: "Schedule six-month dental cleaning", allowDuplicate: true }, { actor: "neel", key: "dup-1" }));
  assert.notEqual(allowed.id, first.id);
  assert.equal(allowed.title, first.title);

  okRecord(await tasks.complete(first.id, neel));
  okRecord(await tasks.delete(allowed.id, neel));
  okRecord(await tasks.add({ title: "Schedule six-month dental cleaning" }, neel), "closed and deleted tasks are not candidates");
});

// ------------------------------------------------------------------ get and list

test("get returns deleted tasks and null for anything that is not a task id", async () => {
  const t = await mk("Gettable");
  okRecord(await tasks.delete(t.id, neel));
  assert.equal((await tasks.get(t.id))?.deletedAt, now);
  assert.equal(await tasks.get("t_nothere001"), null);
  assert.equal(await tasks.get("nonsense"), null);
  assert.equal(await tasks.get(""), null);
});

test("list applies the open-only default, every criterion, the filter grammar, the sort, and throws on bad refs", async () => {
  const root = await project("List Root", { labels: ["area"] });
  const kid = await project("List Kid", { parent: root.id });
  const grandkid = await project("List Grandkid", { parent: kid.id });
  const sec = await section(root.id, "Focus");
  const pool = "list-root";
  const a = await mk("L overdue p1", { project: pool, due: { date: "2026-09-01" }, priority: 1 });
  const b = await mk("L today timed", { project: pool, due: { date: "2026-09-06", time: "14:00", timezone: "UTC" }, section: "Focus", labels: ["urgent"] });
  const c = await mk("L today untimed", { project: pool, due: { date: "2026-09-06" }, priority: 3, executor: "agent:booker" });
  const d = await mk("L next week", { project: "list-root/list-kid", due: { date: "2026-09-13" } });
  const e = await mk("L undated deep", { project: "list-root/list-kid/list-grandkid", notes: "Needle in the notes", priority: 2 });
  const f = await mk("L undated child", { parent: e.id });
  const done = await mk("L finished", { project: pool, due: { date: "2026-09-02" } });
  okRecord(await tasks.complete(done.id, neel));
  const proposed = await mk("L proposed", { project: pool }, codex);
  const gone = await mk("L deleted", { project: pool });
  okRecord(await tasks.delete(gone.id, neel));
  okRecord(await tasks.note(f.id, "Comment mentions Haystack", codex));

  const ids = (list: Task[]) => list.map((t) => t.id);
  const everything = await tasks.list({ project: pool, withSubprojects: true });
  assert.deepEqual(ids(everything), [a.id, b.id, c.id, d.id, e.id, f.id, proposed.id], "open only, dated first by date then time then priority, undated last by priority then order");
  assert.deepEqual(ids(await tasks.list({ project: pool, withSubprojects: true, includeClosed: true })), [a.id, done.id, b.id, c.id, d.id, e.id, f.id, proposed.id]);
  assert.deepEqual(ids(await tasks.list({ project: pool, status: ["done"] })), [done.id]);
  assert.deepEqual(ids(await tasks.list({ project: pool, status: ["done", "proposed"] })), [done.id, proposed.id]);
  assert.deepEqual(ids(await tasks.list({ project: pool, includeDeleted: true, status: ["accepted"] })), [a.id, b.id, c.id, gone.id]);
  assert.deepEqual(ids(await tasks.list({ project: pool })), [a.id, b.id, c.id, proposed.id], "no sub-projects unless asked");
  assert.deepEqual(ids(await tasks.list({ project: root.id, withSubprojects: true, section: "focus" })), [b.id]);
  assert.deepEqual(ids(await tasks.list({ section: sec.id })), [b.id], "a section id needs no project");
  assert.deepEqual(ids(await tasks.list({ project: pool, withSubprojects: true, parent: null })), [a.id, b.id, c.id, d.id, e.id, proposed.id]);
  assert.deepEqual(ids(await tasks.list({ parent: e.id })), [f.id]);
  assert.deepEqual(ids(await tasks.list({ label: "area" })), [a.id, b.id, c.id, d.id, e.id, f.id, proposed.id], "labels reach tasks through the project tree");
  assert.deepEqual(ids(await tasks.list({ label: "urgent" })), [b.id]);
  assert.deepEqual(ids(await tasks.list({ project: pool, executor: "agent:booker" })), [c.id]);
  assert.deepEqual(ids(await tasks.list({ project: pool, dueOn: "2026-09-06" })), [b.id, c.id]);
  assert.deepEqual(ids(await tasks.list({ project: pool, withSubprojects: true, dueBefore: "2026-09-06" })), [a.id]);
  assert.deepEqual(ids(await tasks.list({ project: pool, withSubprojects: true, dueAfter: "2026-09-06" })), [d.id]);
  assert.deepEqual(ids(await tasks.list({ project: pool, withSubprojects: true, undated: true })), [e.id, f.id, proposed.id]);
  assert.deepEqual(ids(await tasks.list({ text: "needle" })), [e.id]);
  assert.deepEqual(ids(await tasks.list({ text: "HAYSTACK" })), [f.id], "comments are searchable");
  assert.deepEqual(ids(await tasks.list({ project: pool, withSubprojects: true, limit: 2 })), [a.id, b.id]);
  assert.deepEqual(ids(await tasks.list({ filter: "overdue & ##list-root" })), [a.id]);
  assert.deepEqual(ids(await tasks.list({ filter: "today & @area" })), [b.id, c.id]);
  assert.deepEqual(ids(await tasks.list({ project: pool, filter: "done" })), [done.id], "a filter that mentions status lifts the open-only default");
  assert.deepEqual(ids(await tasks.list({ project: pool, filter: "all" })), [a.id, done.id, b.id, c.id, proposed.id]);
  assert.deepEqual(ids(await tasks.list({ project: pool, filter: "p1 | search: proposed" })), [a.id, proposed.id]);
  assert.deepEqual(ids(await tasks.list({ project: pool, filter: "subtask" })), []);
  await assert.rejects(tasks.list({ project: "list-root/list-grandkid" }), /no project "list-root\/list-grandkid"/, "a slug path must name every level");

  await assert.rejects(tasks.list({ project: "no-such-project" }), /no project "no-such-project"/);
  await assert.rejects(tasks.list({ project: pool, section: "Nowhere" }), /no section "Nowhere" in project "list-root"/);
  await assert.rejects(tasks.list({ section: "Focus" }), /pass project to look up section "Focus" by name/);
  await assert.rejects(tasks.list({ limit: 0 }), /limit/);
  await assert.rejects(tasks.list({ filter: "bogus term" }), /filter/);
  await assert.rejects(tasks.list({ status: [] }), /status/);
});

// ------------------------------------------------------------------ update

test("update changes content and scheduling, clears with null, keeps a repeating task dated, and honors ifVersion", async () => {
  const t = await mk("Update me", { due: { date: "2026-09-10" }, priority: 2, deadline: "2026-09-30", duration: 30, repeat: "FREQ=DAILY", labels: ["one"] });
  const later = createTasks(db.store, fixedClock("2026-09-06T13:00:00Z"));
  const updated = okRecord(
    await later.update(
      t.id,
      { title: "Updated", notes: "notes", priority: null, deadline: null, duration: null, labels: ["two", "two"], due: { date: "2026-09-11", time: "08:00", timezone: "UTC" } },
      { actor: "neel", reason: "tidy" },
    ),
  );
  assert.equal(updated.title, "Updated");
  assert.equal(updated.notes, "notes");
  assert.equal(updated.priority, undefined);
  assert.equal(updated.deadline, null);
  assert.equal(updated.duration, undefined);
  assert.deepEqual(updated.labels, ["two"]);
  assert.deepEqual(updated.due, { date: "2026-09-11", time: "08:00", timezone: "UTC" });
  assert.equal(updated.repeat, "FREQ=DAILY");
  assert.equal(updated.version, 2);
  assert.equal(updated.updatedAt, "2026-09-06T13:00:00Z");
  assert.ok(await org.label.get("two"), "labels named on update are registered");
  const entries = await history(t.id);
  assert.equal(entries.length, 2);
  assert.equal(entries[1]!.op, "task.update");
  assert.equal(entries[1]!.reason, "tidy");
  assert.deepEqual(entries[1]!.patch, {
    title: { from: "Update me", to: "Updated" },
    notes: { from: "", to: "notes" },
    priority: { from: 2, to: null },
    deadline: { from: "2026-09-30", to: null },
    duration: { from: 30, to: null },
    labels: { from: ["one"], to: ["two"] },
    due: { from: { date: "2026-09-10" }, to: { date: "2026-09-11", time: "08:00", timezone: "UTC" } },
  });

  const same = await tasks.update(t.id, { title: "Updated", labels: ["two"] }, neel);
  assert.equal(same.ok && same.outcome, "unchanged");
  assert.equal((await history(t.id)).length, 2, "unchanged logs nothing");

  rejectedWith(await tasks.update(t.id, { due: null }, neel), /repeating task needs a due date/);
  const undated = okRecord(await tasks.update(t.id, { due: null, repeat: null }, neel));
  assert.equal(undated.due, null);
  assert.equal(undated.repeat, undefined);
  rejectedWith(await tasks.update(t.id, { repeat: "FREQ=WEEKLY" }, neel), /repeating task needs a due date/);

  const stale = rejectedWith(await tasks.update(t.id, { title: "Stale" }, { actor: "neel", ifVersion: 2 }), /version: expected 2, current is 3/);
  assert.equal(stale.record?.title, "Updated");
  assert.equal(stale.id, t.id);
  okRecord(await tasks.update(t.id, { title: "Fresh" }, { actor: "neel", ifVersion: 3 }));

  rejectedWith(await tasks.update(t.id, { priority: 9 }, neel), /^priority: /m);
  rejectedWith(await tasks.update(t.id, { status: "done" } as never, neel), /status/);
  rejectedWith(await tasks.update("t_nothere001", { title: "x" }, neel), /task: no task "t_nothere001"/);
  okRecord(await tasks.delete(t.id, neel));
  rejectedWith(await tasks.update(t.id, { title: "x" }, neel), /is deleted; restore it first/);
});

// ------------------------------------------------------------------ move and reorder

test("move changes project, section, and parent with validation, and the subtree follows", async () => {
  const pa = await project("Move A");
  const pb = await project("Move B");
  const a1 = await section(pa.id, "A1");
  const b1 = await section(pb.id, "B1");
  const root = await mk("M root", { project: "move-a", section: "A1" });
  const c1 = await mk("M child 1", { parent: root.id });
  const c2 = await mk("M child 2", { parent: root.id });
  const g = await mk("M grandchild", { parent: c1.id });
  const x = await mk("M other", { project: "move-b" });
  const deletedChild = await mk("M deleted child", { parent: root.id });
  okRecord(await tasks.delete(deletedChild.id, neel));

  const receipt = await tasks.move(root.id, { project: "move-b" }, { actor: "neel", key: "move-1" });
  const moved = okRecord(receipt);
  assert.equal(moved.projectId, pb.id);
  assert.equal(moved.sectionId, undefined, "the old section does not exist in the target project");
  assert.equal(moved.parentId, undefined);
  assert.equal(moved.order, 1, "after the task already there");
  for (const id of [c1.id, c2.id, g.id, deletedChild.id]) {
    const sub = await get(id);
    assert.equal(sub.projectId, pb.id, `${id} followed`);
    assert.equal(sub.sectionId, undefined);
    const entries = await history(id);
    assert.equal(entries.at(-1)!.op, "task.move");
    assert.equal(entries.at(-1)!.key, null, "cascaded moves carry no key");
  }
  assert.equal((await get(g.id)).parentId, c1.id, "the subtree keeps its shape");
  assert.equal((await history(root.id)).at(-1)!.key, "move-1");
  assert.deepEqual(await tasks.move(root.id, { project: "move-b" }, { actor: "neel", key: "move-1" }), receipt);

  const sectioned = okRecord(await tasks.move(root.id, { section: "b1" }, neel));
  assert.equal(sectioned.sectionId, b1.id);
  assert.equal(sectioned.order, 0, "first in the new scope");
  assert.equal((await get(g.id)).sectionId, b1.id, "sub-tasks live in their parent's section");
  rejectedWith(await tasks.move(root.id, { section: a1.id }, neel), /section: no section ".*" in project "move-b"/);
  rejectedWith(await tasks.move(root.id, { section: "A1" }, neel), /section: no section "A1" in project "move-b"/);

  const same = await tasks.move(root.id, { project: pb.id, section: "B1" }, neel);
  assert.equal(same.ok && same.outcome, "unchanged");

  rejectedWith(await tasks.move(root.id, { parent: root.id }, neel), /cannot be its own parent/);
  rejectedWith(await tasks.move(root.id, { parent: g.id }, neel), /cannot move under its own sub-task/);
  const y = await mk("M elsewhere", { project: "move-a" });
  rejectedWith(await tasks.move(root.id, { parent: y.id }, neel), /parent: task .* is not in the target project/);
  rejectedWith(await tasks.move(c2.id, { parent: x.id, section: "B1" }, neel), /sub-task lives in its parent's section/);
  rejectedWith(await tasks.move(root.id, {}, neel), /Nothing to move/);
  rejectedWith(await tasks.move(root.id, { parent: "t_nothere001" }, neel), /parent: no task/);

  const underX = okRecord(await tasks.move(root.id, { parent: x.id }, neel));
  assert.equal(underX.parentId, x.id);
  assert.equal(underX.sectionId, undefined, "a sub-task takes its parent's section");
  assert.equal((await get(c1.id)).sectionId, undefined);

  const out = okRecord(await tasks.move(c1.id, { project: "move-a", section: null }, neel));
  assert.equal(out.projectId, pa.id);
  assert.equal(out.parentId, undefined, "moving to another project detaches from the parent");
  assert.equal((await get(g.id)).projectId, pa.id);
  assert.equal((await get(g.id)).parentId, c1.id);

  const detached = okRecord(await tasks.move(root.id, { parent: null }, neel));
  assert.equal(detached.parentId, undefined);
  rejectedWith(await tasks.move(deletedChild.id, { parent: null }, neel), /is deleted; restore it first/);
  rejectedWith(await tasks.move(root.id, { project: "move-a" }, { actor: "neel", ifVersion: 1 }), /version: expected 1/);
});

test("reorder assigns 0..n-1 within one scope and rejects mixed scopes, deleted or unknown ids, duplicates, and ifVersion", async () => {
  const p = await project("Reorder P");
  const a = await mk("R a", { project: p.id });
  const b = await mk("R b", { project: p.id });
  const c = await mk("R c", { project: p.id });
  const child = await mk("R child", { parent: a.id });
  const receipts = await tasks.reorder([c.id, a.id, b.id], { actor: "neel", key: "reorder-1" });
  assert.deepEqual(receipts.map((r) => r.ok && [r.outcome, r.record.order]), [["updated", 0], ["updated", 1], ["updated", 2]]);
  assert.deepEqual((await tasks.list({ project: p.id, parent: null })).map((t) => t.id), [c.id, a.id, b.id]);
  assert.equal((await history(c.id)).at(-1)!.key, itemKey("reorder-1", 0));
  assert.equal((await history(c.id)).at(-1)!.op, "task.reorder");
  assert.deepEqual(await tasks.reorder([c.id, a.id, b.id], { actor: "neel", key: "reorder-1" }), receipts, "a retry returns the stored receipts");
  assert.deepEqual((await tasks.reorder([c.id, a.id, b.id], neel)).map((r) => r.ok && r.outcome), ["unchanged", "unchanged", "unchanged"]);

  for (const r of await tasks.reorder([a.id, child.id], neel)) rejectedWith(r, /must share the same project, section, and parent/);
  for (const r of await tasks.reorder([a.id, "t_nothere001"], neel)) rejectedWith(r, /t_nothere001: no task/);
  okRecord(await tasks.delete(b.id, neel));
  for (const r of await tasks.reorder([a.id, b.id], neel)) rejectedWith(r, /is deleted/);
  for (const r of await tasks.reorder([a.id, a.id], neel)) rejectedWith(r, /duplicates/);
  for (const r of await tasks.reorder([a.id], { actor: "neel", ifVersion: 1 })) rejectedWith(r, /ifVersion: not supported/);
  for (const r of await tasks.reorder([a.id], { actor: "nobody" } as Ctx)) rejectedWith(r, /actor/);
  assert.deepEqual(await tasks.reorder([], neel), []);
});

// ------------------------------------------------------------------ duplicate

test("duplicate copies the fields and the subtree, not comments or occurrences, with the add status rule", async () => {
  const p = await project("Dup P");
  const s = await section(p.id, "S");
  const source = await mk("D source", {
    project: p.id,
    section: "S",
    notes: "keep",
    labels: ["dup-label"],
    priority: 1,
    due: { date: "2026-09-08", time: "10:00", timezone: "UTC" },
    deadline: "2026-09-20",
    duration: 15,
    repeat: "FREQ=DAILY",
    executor: "agent:booker",
    bucket: "safe",
    external: [{ provider: "todoist", id: "9" }],
  });
  const sibling = await mk("D sibling", { project: p.id, section: "S" });
  const c1 = await mk("D child 1", { parent: source.id, priority: 4 });
  const c2 = await mk("D child 2", { parent: source.id });
  const g = await mk("D grandchild", { parent: c1.id });
  okRecord(await tasks.note(source.id, "a comment", neel));
  okRecord(await tasks.complete(source.id, neel, { subtasks: "leave" }), "a repeating complete leaves an occurrence");
  okRecord(await tasks.complete(c2.id, neel));
  const gone = await mk("D deleted child", { parent: source.id });
  okRecord(await tasks.delete(gone.id, neel));
  const original = await get(source.id);

  const before = await logCount();
  const receipt = await tasks.duplicate(source.id, { ...codex, key: "duplicate-source-1" });
  const copy = okRecord(receipt);
  assert.equal(receipt.outcome, "created");
  assert.notEqual(copy.id, source.id);
  assert.equal(copy.title, original.title);
  assert.equal(copy.notes, "keep");
  assert.equal(copy.projectId, p.id);
  assert.equal(copy.sectionId, s.id);
  assert.equal(copy.parentId, undefined);
  assert.equal(copy.order, original.order + 1);
  assert.deepEqual(copy.labels, ["dup-label"]);
  assert.equal(copy.priority, 1);
  assert.deepEqual(copy.due, original.due);
  assert.equal(copy.deadline, "2026-09-20");
  assert.equal(copy.duration, 15);
  assert.equal(copy.repeat, "FREQ=DAILY");
  assert.equal(copy.executor, "agent:booker");
  assert.equal(copy.bucket, "safe");
  assert.equal(copy.status, "proposed", "codex duplicates land proposed");
  assert.deepEqual(copy.comments, []);
  assert.deepEqual(copy.occurrences, []);
  assert.deepEqual(copy.external, []);
  assert.equal(copy.completedAt, null);
  assert.equal(copy.version, 1);
  assert.deepEqual(copy.origin, { actor: "codex", at: now, reason: codex.reason, evidence: codex.evidence });
  assert.equal((await history(copy.id))[0]!.key, "duplicate-source-1");

  const children = await tasks.list({ parent: copy.id, includeClosed: true });
  assert.deepEqual(children.map((t) => [t.title, t.status, t.order, t.sectionId]), [["D child 1", "proposed", 0, s.id], ["D child 2", "proposed", 1, s.id]]);
  const grandchildren = await tasks.list({ parent: children[0]!.id });
  assert.deepEqual(grandchildren.map((t) => t.title), ["D grandchild"]);
  assert.equal((await history(children[0]!.id))[0]!.op, "task.duplicate");
  assert.equal((await history(children[0]!.id))[0]!.key, null);
  assert.equal(await logCount(), before + 4, "the copy and three sub-task copies, the deleted one skipped");
  assert.deepEqual((await tasks.list({ parent: source.id })).map((t) => t.id), [c1.id], "the original subtree is untouched");
  assert.equal((await get(g.id)).parentId, c1.id);
  assert.equal((await get(sibling.id)).version, 1);

  const flat = okRecord(await tasks.duplicate(source.id, neel, { subtasks: false }));
  assert.equal(flat.status, "accepted");
  assert.deepEqual(await tasks.list({ parent: flat.id, includeClosed: true }), []);

  rejectedWith(await tasks.duplicate(gone.id, neel), /is deleted; restore it first/);
  rejectedWith(await tasks.duplicate("t_nothere001", neel), /no task/);
  rejectedWith(await tasks.duplicate(source.id, neel, { subtasks: "yes" } as never), /subtasks/);
});

// ------------------------------------------------------------------ lifecycle

test("accept, start, cancel, and uncomplete follow the lifecycle and reject the rest", async () => {
  const t = await mk("Lifecycle", {}, codex);
  assert.equal(t.status, "proposed");
  rejectedWith(await tasks.start(t.id, neel), /status: start needs accepted, task is proposed/);
  rejectedWith(await tasks.complete(t.id, neel), /status: complete needs accepted or in_progress, task is proposed/);
  const accepted = okRecord(await tasks.accept(t.id, { actor: "neel", key: "accept-1" }));
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.version, 2);
  const stale = rejectedWith(await tasks.accept(t.id, neel), /status: accept needs proposed, task is accepted/);
  assert.equal(stale.record?.status, "accepted");
  const started = okRecord(await tasks.start(t.id, neel));
  assert.equal(started.status, "in_progress");
  rejectedWith(await tasks.uncomplete(t.id, neel), /uncomplete needs done, cancelled, or a repeating task with an occurrence; task is in_progress/);

  const noReason = rejectedWith(await tasks.cancel(t.id, neel), /reason: cancel needs a reason/);
  assert.equal(noReason.id, t.id);
  const cancelled = okRecord(await tasks.cancel(t.id, { actor: "neel", reason: "not doing this" }));
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.completedAt, null);
  rejectedWith(await tasks.cancel(t.id, { actor: "neel", reason: "again" }), /status: cancel needs proposed or accepted or in_progress, task is cancelled/);
  const reopened = okRecord(await tasks.uncomplete(t.id, neel));
  assert.equal(reopened.status, "accepted");
  okRecord(await tasks.complete(t.id, neel));
  rejectedWith(await tasks.cancel(t.id, { actor: "neel", reason: "too late" }), /task is done/);
  assert.deepEqual(await ops(t.id), ["task.add", "task.accept", "task.start", "task.cancel", "task.uncomplete", "task.complete"]);
  rejectedWith(await tasks.accept("t_nothere001", neel), /no task/);
  rejectedWith(await tasks.accept(t.id, { actor: "neel", ifVersion: 1 }), /version: expected 1, current is 6/);
});

test("complete closes a task with an occurrence, honors date and key, and rejects closed tasks", async () => {
  const t = await mk("Complete me", { due: { date: "2026-09-10" } });
  const before = await logCount();
  const receipt = await tasks.complete(t.id, { actor: "neel", key: "complete-1" });
  const done = okRecord(receipt);
  assert.equal(receipt.outcome, "updated");
  assert.equal(done.status, "done");
  assert.equal(done.completedAt, now);
  assert.deepEqual(done.occurrences, [{ date: "2026-09-10", at: now, actor: "neel" }]);
  assert.equal(done.due?.date, "2026-09-10", "a plain task keeps its due date");
  const entries = await history(t.id);
  assert.equal(entries.length, 2);
  assert.equal(entries[1]!.op, "task.complete");
  assert.deepEqual(entries[1]!.patch.status, { from: "accepted", to: "done" });
  assert.deepEqual(await tasks.complete(t.id, { actor: "neel", key: "complete-1" }), receipt, "the key returns the stored receipt");
  assert.equal(await logCount(), before + 1);
  rejectedWith(await tasks.complete(t.id, neel), /complete needs accepted or in_progress, task is done/);

  const undated = await mk("Complete undated", {}, codex);
  okRecord(await tasks.accept(undated.id, neel));
  const closed = okRecord(await tasks.complete(undated.id, { actor: "codex" }));
  assert.deepEqual(closed.occurrences, [{ date: "2026-09-06", at: now, actor: "codex" }], "no due date: today in the clock's timezone");

  const dated = await mk("Complete dated");
  okRecord(await tasks.start(dated.id, neel));
  assert.deepEqual(okRecord(await tasks.complete(dated.id, neel, { date: "2026-09-04" })).occurrences, [{ date: "2026-09-04", at: now, actor: "neel" }]);
  rejectedWith(await tasks.complete(dated.id, neel, { date: "yesterday" }), /^date: /m);
  rejectedWith(await tasks.complete(dated.id, neel, { subtasks: "skip" } as never), /^subtasks: /m);
  okRecord(await tasks.delete(dated.id, neel));
  rejectedWith(await tasks.complete(dated.id, neel), /is deleted; restore it first/);
});

test("complete on a repeating task records the occurrence, advances due, and stays accepted", async () => {
  const t = await mk("Weekly review", { due: { date: "2026-09-07", time: "09:00", timezone: "America/Los_Angeles" }, repeat: "FREQ=WEEKLY;BYDAY=MO,FR" });
  const first = okRecord(await tasks.complete(t.id, neel));
  assert.equal(first.status, "accepted");
  assert.equal(first.completedAt, null);
  assert.deepEqual(first.due, { date: "2026-09-11", time: "09:00", timezone: "America/Los_Angeles" }, "Friday after Monday; time and zone kept");
  assert.deepEqual(first.occurrences, [{ date: "2026-09-07", at: now, actor: "neel" }]);
  assert.deepEqual((await history(t.id))[1]!.patch.due, { from: { date: "2026-09-07", time: "09:00", timezone: "America/Los_Angeles" }, to: first.due });

  const early = okRecord(await tasks.complete(t.id, codex, { date: "2026-09-09" }));
  assert.equal(early.due?.date, "2026-09-14", "done early: the next occurrence after the due date");
  assert.equal(early.occurrences[1]?.date, "2026-09-09");
  assert.equal(early.occurrences[1]?.actor, "codex");

  okRecord(await tasks.start(t.id, neel));
  const late = okRecord(await tasks.complete(t.id, neel, { date: "2026-09-20" }));
  assert.equal(late.status, "accepted", "in_progress goes back to accepted");
  assert.equal(late.due?.date, "2026-09-21", "done late: the next occurrence after the completion date");
  assert.deepEqual(late.occurrences.map((o) => o.date), ["2026-09-07", "2026-09-09", "2026-09-20"]);

  const rewound = okRecord(await tasks.uncomplete(t.id, neel));
  assert.equal(rewound.due?.date, "2026-09-14", "the due date the late completion advanced from, read from its log entry; not the 09-20 it recorded");
  assert.deepEqual(rewound.occurrences.map((o) => o.date), ["2026-09-07", "2026-09-09"]);
  assert.deepEqual((await history(t.id)).at(-1)!.patch.due, {
    from: { date: "2026-09-21", time: "09:00", timezone: "America/Los_Angeles" },
    to: { date: "2026-09-14", time: "09:00", timezone: "America/Los_Angeles" },
  });
  assert.equal(okRecord(await tasks.uncomplete(t.id, neel)).due?.date, "2026-09-11", "before the early completion, not the 09-09 it recorded");
  const start = okRecord(await tasks.uncomplete(t.id, neel));
  assert.equal(start.due?.date, "2026-09-07");
  assert.deepEqual(start.occurrences, []);
  rejectedWith(await tasks.uncomplete(t.id, neel), /no recorded occurrence to rewind/);
  assert.deepEqual(await ops(t.id), ["task.add", "task.complete", "task.complete", "task.start", "task.complete", "task.uncomplete", "task.uncomplete", "task.uncomplete"]);
});

test("complete with open sub-tasks asks, changes nothing, then completes them recursively or leaves them", async () => {
  const p = await mk("C parent");
  const s1 = await mk("C sub 1", { parent: p.id });
  const s2 = await mk("C sub 2 proposed", { parent: p.id }, codex);
  const s3 = await mk("C sub 3 done", { parent: p.id });
  okRecord(await tasks.complete(s3.id, neel));
  const s1a = await mk("C sub 1a", { parent: s1.id });
  const s4 = await mk("C sub 4 deleted", { parent: p.id });
  okRecord(await tasks.delete(s4.id, neel));

  const before = await logCount();
  const asked = rejectedWith(await tasks.complete(p.id, { actor: "neel", key: "ask-1" }), /has 3 open sub-tasks; pass subtasks "complete"/);
  assert.deepEqual(asked.needs, { field: "subtasks", options: ["complete", "leave"], message: asked.issues[0] });
  assert.equal(asked.id, p.id);
  assert.equal(asked.record?.version, 1);
  assert.equal(await logCount(), before, "the question changes nothing");
  assert.equal(await db.store.read((tx) => tx.getReceipt("ask-1")), null);
  assert.equal((await get(p.id)).status, "accepted");

  const left = okRecord(await tasks.complete(p.id, neel, { subtasks: "leave" }));
  assert.equal(left.status, "done");
  assert.equal((await get(s1.id)).status, "accepted");
  assert.equal((await get(s2.id)).status, "proposed");
  assert.equal(await logCount(), before + 1);

  const q = await mk("C parent 2");
  const t1 = await mk("C sub of 2", { parent: q.id });
  const t2 = await mk("C daily sub of 2", { parent: q.id, due: { date: "2026-09-06" }, repeat: "FREQ=DAILY" });
  const t3 = await mk("C proposed sub of 2", { parent: q.id }, codex);
  const t1a = await mk("C grandsub of 2", { parent: t1.id });
  const count = await logCount();
  const receipt = await tasks.complete(q.id, { actor: "neel", key: "cascade-1", reason: "all done" }, { subtasks: "complete", date: "2026-09-05" });
  const parent = okRecord(receipt);
  assert.equal(parent.status, "done");
  assert.equal(parent.occurrences[0]?.date, "2026-09-05");
  for (const id of [t1.id, t3.id, t1a.id]) {
    const sub = await get(id);
    assert.equal(sub.status, "done", `${id} completed`);
    assert.equal(sub.completedAt, now);
    assert.equal(sub.occurrences[0]?.date, "2026-09-05");
    const entry = (await history(id)).at(-1)!;
    assert.equal(entry.op, "task.complete");
    assert.equal(entry.actor, "neel");
    assert.equal(entry.reason, "all done");
    assert.equal(entry.key, null, "cascaded completions carry no key");
  }
  const daily = await get(t2.id);
  assert.equal(daily.status, "accepted", "a repeating sub-task advances instead of closing");
  assert.equal(daily.due?.date, "2026-09-07");
  assert.deepEqual(daily.occurrences.map((o) => o.date), ["2026-09-05"]);
  assert.equal((await history(q.id)).at(-1)!.key, "cascade-1");
  assert.equal(await logCount(), count + 5, "each sub-task logs its own entry");
  assert.deepEqual(await tasks.complete(q.id, { actor: "neel", key: "cascade-1", reason: "all done" }, { subtasks: "complete", date: "2026-09-05" }), receipt);
});

test("uncomplete reopens done and cancelled tasks, popping the completion's occurrence", async () => {
  const t = await mk("Uncomplete me", { due: { date: "2026-09-03" } });
  okRecord(await tasks.complete(t.id, neel));
  const reopened = okRecord(await tasks.uncomplete(t.id, { actor: "neel", key: "unc-1" }));
  assert.equal(reopened.status, "accepted");
  assert.equal(reopened.completedAt, null);
  assert.deepEqual(reopened.occurrences, []);
  assert.deepEqual((await history(t.id)).at(-1)!.patch, {
    status: { from: "done", to: "accepted" },
    completedAt: { from: now, to: null },
    occurrences: { from: [{ date: "2026-09-03", at: now, actor: "neel" }], to: [] },
  });
  rejectedWith(await tasks.uncomplete(t.id, neel), /task is accepted/);
  okRecord(await tasks.delete(t.id, neel));
  rejectedWith(await tasks.uncomplete(t.id, neel), /is deleted/);
});

// ------------------------------------------------------------------ delete and restore

test("delete is soft, asks about sub-tasks, deletes the subtree or re-parents the children; restore puts things back", async () => {
  const p = await project("Delete P");
  const s = await section(p.id, "DS");
  const parent = await mk("Del parent", { project: p.id, section: "DS" });
  const c1 = await mk("Del child 1", { parent: parent.id });
  const c2 = await mk("Del child 2", { parent: parent.id });
  const g = await mk("Del grandchild", { parent: c1.id });
  okRecord(await tasks.start(c2.id, neel));

  const before = await logCount();
  // The same question complete asks (HANDS D54): open sub-tasks anywhere below, here c1, c2 and the grandchild.
  const asked = rejectedWith(await tasks.delete(parent.id, neel), /has 3 open sub-tasks; pass subtasks "delete"/);
  assert.deepEqual(asked.needs, { field: "subtasks", options: ["delete", "leave"], message: asked.issues[0] });
  assert.equal(await logCount(), before);
  assert.equal((await get(parent.id)).deletedAt, null);

  const receipt = await tasks.delete(parent.id, { actor: "neel", key: "del-1" }, { subtasks: "delete" });
  const deleted = okRecord(receipt);
  assert.equal(deleted.deletedAt, now);
  assert.equal(deleted.status, "accepted", "status is left alone");
  for (const id of [c1.id, c2.id, g.id]) {
    const sub = await get(id);
    assert.equal(sub.deletedAt, now, `${id} deleted`);
    assert.equal((await history(id)).at(-1)!.op, "task.delete");
    assert.equal((await history(id)).at(-1)!.key, null);
  }
  assert.equal((await get(c2.id)).status, "in_progress");
  assert.equal((await history(parent.id)).at(-1)!.key, "del-1");
  assert.equal(await logCount(), before + 4);
  assert.deepEqual(await tasks.list({ project: p.id }), []);
  assert.equal((await tasks.list({ project: p.id, includeDeleted: true })).length, 4);
  rejectedWith(await tasks.delete(parent.id, neel), /is deleted; restore it first/);
  assert.deepEqual(await tasks.delete(parent.id, { actor: "neel", key: "del-1" }, { subtasks: "delete" }), receipt);

  const child = okRecord(await tasks.restore(c1.id, neel));
  assert.equal(child.deletedAt, null);
  assert.equal(child.parentId, undefined, "its parent is deleted, so it becomes top level");
  assert.equal(child.projectId, p.id);
  assert.equal(child.sectionId, s.id);
  assert.equal(child.order, 0, "first among the live top-level tasks in the section; deleted tasks hold no slot");
  assert.equal((await get(g.id)).deletedAt, now, "sub-tasks deleted with it stay deleted");
  const restoredParent = okRecord(await tasks.restore(parent.id, neel));
  assert.equal(restoredParent.deletedAt, null);
  assert.equal(restoredParent.sectionId, s.id);
  assert.equal(restoredParent.order, 0, "same scope, same order");
  assert.equal((await get(c2.id)).deletedAt, now);
  const same = await tasks.restore(parent.id, neel);
  assert.equal(same.ok && same.outcome, "unchanged");
  const grandchild = okRecord(await tasks.restore(g.id, neel));
  assert.equal(grandchild.parentId, c1.id, "its parent is live again");
  rejectedWith(await tasks.restore("t_nothere001", neel), /no task/);
  rejectedWith(await tasks.restore(c2.id, { actor: "neel", ifVersion: 1 }), /version: expected 1/);

  const q = await mk("Del leave parent", { project: p.id });
  const k1 = await mk("Del leave child 1", { parent: q.id });
  const k2 = await mk("Del leave child 2", { parent: q.id });
  const k1a = await mk("Del leave grandchild", { parent: k1.id });
  okRecord(await tasks.delete(q.id, neel, { subtasks: "leave" }));
  assert.equal((await get(k1.id)).parentId, undefined, "children move to the top level");
  assert.equal((await get(k2.id)).parentId, undefined);
  assert.deepEqual([(await get(k1.id)).order, (await get(k2.id)).order], [1, 2], "ordered after q, the only live top-level task outside the section");
  assert.equal((await get(k1a.id)).parentId, k1.id, "grandchildren stay under their parents");
  assert.equal((await history(k1.id)).at(-1)!.op, "task.delete");

  const r = await mk("Del grandparent", { project: p.id });
  const q2 = await mk("Del middle", { parent: r.id });
  const k3 = await mk("Del leaf", { parent: q2.id });
  okRecord(await tasks.delete(q2.id, neel, { subtasks: "leave" }));
  assert.equal((await get(k3.id)).parentId, r.id, "children move under the grandparent");
  okRecord(await tasks.delete(r.id, neel, { subtasks: "delete" }));
  const leaf = okRecord(await tasks.restore(k3.id, neel));
  assert.equal(leaf.parentId, undefined);
});

test("restore moves a task whose project or section is gone to the Inbox or out of the section", async () => {
  const temp = await project("Restore Temp");
  const t = await mk("Restore from deleted project", { project: temp.id });
  okRecord(await org.project.delete(temp.id, neel, { contents: "delete" }));
  assert.equal((await get(t.id)).deletedAt, now);
  const restored = okRecord(await tasks.restore(t.id, { actor: "neel", key: "restore-1" }));
  assert.equal(restored.projectId, (await org.project.get("inbox"))!.id);
  assert.equal(restored.sectionId, undefined);
  assert.equal(restored.deletedAt, null);
  assert.equal((await history(t.id)).at(-1)!.op, "task.restore");
  assert.equal((await history(t.id)).at(-1)!.key, "restore-1");

  const keep = await project("Restore Keep");
  const sec = await section(keep.id, "Gone");
  const u = await mk("Restore from deleted section", { project: keep.id, section: "Gone" });
  okRecord(await org.section.delete(sec.id, neel, { tasks: "delete" }));
  const unsectioned = okRecord(await tasks.restore(u.id, neel));
  assert.equal(unsectioned.projectId, keep.id);
  assert.equal(unsectioned.sectionId, undefined);
});

// ------------------------------------------------------------------ assign, reschedule, note, history

test("assign sets executor and bucket, null clears the bucket, and invalid values are rejected", async () => {
  const t = await mk("Assign me");
  const assigned = okRecord(await tasks.assign(t.id, { executor: "agent:booker", bucket: "review" }, neel));
  assert.equal(assigned.executor, "agent:booker");
  assert.equal(assigned.bucket, "review");
  assert.deepEqual((await history(t.id)).at(-1)!.patch, { executor: { from: "neel", to: "agent:booker" }, bucket: { from: null, to: "review" } });
  const cleared = okRecord(await tasks.assign(t.id, { bucket: null }, neel));
  assert.equal(cleared.bucket, undefined);
  assert.equal(cleared.executor, "agent:booker");
  const same = await tasks.assign(t.id, { executor: "agent:booker" }, neel);
  assert.equal(same.ok && same.outcome, "unchanged");
  rejectedWith(await tasks.assign(t.id, {}, neel), /Nothing to assign/);
  rejectedWith(await tasks.assign(t.id, { executor: "codex" }, neel), /^executor: /m);
  rejectedWith(await tasks.assign(t.id, { bucket: "maybe" as never }, neel), /^bucket: /m);
  rejectedWith(await tasks.assign(t.id, { executor: "neel" }, { actor: "neel", ifVersion: 1 }), /version: expected 1, current is 3/);
  okRecord(await tasks.complete(t.id, neel));
  okRecord(await tasks.assign(t.id, { executor: "neel" }, neel), "any status");
});

test("reschedule changes due on open tasks only and keeps repeating tasks dated", async () => {
  const t = await mk("Reschedule me", { due: { date: "2026-09-10" } });
  const moved = okRecord(await tasks.reschedule(t.id, { date: "2026-09-12", time: "07:00", timezone: "UTC" }, neel));
  assert.deepEqual(moved.due, { date: "2026-09-12", time: "07:00", timezone: "UTC" });
  assert.equal((await history(t.id)).at(-1)!.op, "task.reschedule");
  assert.equal(okRecord(await tasks.reschedule(t.id, null, neel)).due, null);
  const same = await tasks.reschedule(t.id, null, neel);
  assert.equal(same.ok && same.outcome, "unchanged");
  rejectedWith(await tasks.reschedule(t.id, { date: "2026-09-12", time: "07:00" }, neel), /timezone/);
  rejectedWith(await tasks.reschedule(t.id, { date: "next week" }, neel), /^due\.date: /m);
  rejectedWith(await tasks.reschedule(t.id, undefined as never, neel), /due: reschedule needs a due date or null/);
  okRecord(await tasks.complete(t.id, neel));
  rejectedWith(await tasks.reschedule(t.id, { date: "2026-09-15" }, neel), /reschedule needs an open task, task is done/);

  const daily = await mk("Reschedule daily", { due: { date: "2026-09-10" }, repeat: "FREQ=DAILY" });
  rejectedWith(await tasks.reschedule(daily.id, null, neel), /repeating task cannot go undated/);
  assert.equal(okRecord(await tasks.reschedule(daily.id, { date: "2026-09-11" }, neel)).due?.date, "2026-09-11");
});

test("note appends a comment with the ctx actor on any status; history lists the entries in order", async () => {
  const t = await mk("Note me");
  const noted = okRecord(await tasks.note(t.id, "  Called the clinic  ", codex, [{ name: "call", url: "vault:calls/1.md" }]));
  assert.deepEqual(noted.comments, [{ actor: "codex", at: now, text: "Called the clinic", attachments: [{ name: "call", url: "vault:calls/1.md" }] }]);
  okRecord(await tasks.complete(t.id, neel));
  const again = okRecord(await tasks.note(t.id, "Done and dusted", neel));
  assert.equal(again.comments.length, 2);
  assert.deepEqual(again.comments[1], { actor: "neel", at: now, text: "Done and dusted", attachments: [] });
  rejectedWith(await tasks.note(t.id, "   ", neel), /^text: /m);
  rejectedWith(await tasks.note(t.id, "bad attachment", neel, [{ name: "", url: "x" }]), /^attachments\./m);
  rejectedWith(await tasks.note(t.id, "x", { actor: "neel", ifVersion: 1 }), /version: expected 1, current is 4/);
  const entries = await tasks.history(t.id);
  assert.deepEqual(entries.map((e) => e.op), ["task.add", "task.note", "task.complete", "task.note"]);
  assert.ok(entries.every((e, i) => i === 0 || e.seq > entries[i - 1]!.seq));
  assert.deepEqual(entries[1]!.patch.comments, { from: [], to: noted.comments });
  assert.deepEqual(await tasks.history("t_nothere001"), []);
  okRecord(await tasks.delete(t.id, neel));
  rejectedWith(await tasks.note(t.id, "too late", neel), /is deleted/);
});

// ------------------------------------------------------------------ batch

test("batch runs every kind of item in one transaction; by default each item stands on its own", async () => {
  const p = await project("Batch P");
  const s = await section(p.id, "BS");
  const b1 = await mk("B one", { project: p.id });
  const b2 = await mk("B two proposed", { project: p.id }, codex);
  const b3 = await mk("B three", { project: p.id });
  const b4 = await mk("B four", { project: p.id, due: { date: "2026-09-10" } });
  const b5 = await mk("B five");
  okRecord(await tasks.complete(b5.id, neel));
  const b6 = await mk("B six");
  const receipts = await tasks.batch(
    [
      { op: "complete", id: b1.id, options: { date: "2026-09-05" } },
      { op: "complete", id: b2.id },
      { op: "start", id: b3.id },
      { op: "update", id: b3.id, input: { title: "B three renamed" } },
      { op: "assign", id: b3.id, input: { executor: "agent:x" } },
      { op: "reschedule", id: b4.id, input: null },
      { op: "move", id: b4.id, input: { section: s.id } },
      { op: "uncomplete", id: b5.id },
      { op: "cancel", id: b6.id },
      { op: "delete", id: b6.id, options: { subtasks: "delete" } },
      { op: "restore", id: b6.id },
      { op: "duplicate", id: b6.id, options: { subtasks: false } },
      { op: "accept", id: "t_nothere001" },
      { op: "rename" as never, id: b1.id },
      { op: "reschedule", id: b4.id },
      { op: "update", id: b3.id, input: { priority: 0 } },
    ],
    { actor: "neel", key: "batch-1" },
  );
  assert.equal(receipts.length, 16);
  const outcomes = receipts.map((r) => (r.ok ? r.outcome : `${r.outcome}: ${r.issues[0]}`));
  assert.equal(outcomes[0], "updated");
  assert.match(String(outcomes[1]), /complete needs accepted or in_progress, task is proposed/);
  assert.deepEqual(outcomes.slice(2, 8), ["updated", "updated", "updated", "updated", "updated", "updated"]);
  assert.match(String(outcomes[8]), /reason: cancel needs a reason/);
  assert.deepEqual(outcomes.slice(9, 12), ["updated", "updated", "created"]);
  assert.match(String(outcomes[12]), /no task "t_nothere001"/);
  assert.match(String(outcomes[13]), /op: expected one of accept, start/);
  assert.match(String(outcomes[14]), /due: reschedule needs a due date or null/);
  assert.match(String(outcomes[15]), /^rejected: priority: /);

  assert.equal((await get(b1.id)).status, "done");
  assert.equal((await get(b1.id)).occurrences[0]?.date, "2026-09-05");
  assert.equal((await get(b2.id)).status, "proposed");
  const three = await get(b3.id);
  assert.deepEqual([three.status, three.title, three.executor, three.version], ["in_progress", "B three renamed", "agent:x", 4]);
  const four = await get(b4.id);
  assert.deepEqual([four.due, four.sectionId], [null, s.id]);
  assert.equal((await get(b5.id)).status, "accepted");
  const six = await get(b6.id);
  assert.deepEqual([six.status, six.deletedAt], ["accepted", null]);
  assert.equal((await tasks.list({ project: "inbox", text: "B six" })).length, 2, "the duplicate landed");
  assert.equal((await history(b1.id)).at(-1)!.key, itemKey("batch-1", 0), "per-item keys derive from the caller's");
  assert.equal((await history(b3.id)).at(-1)!.key, itemKey("batch-1", 4));
  assert.deepEqual(await tasks.batch([{ op: "complete", id: b1.id, options: { date: "2026-09-05" } }], { actor: "neel", key: "batch-1" }), [receipts[0]], "a retry returns the stored receipt");

  assert.deepEqual(await tasks.batch([], neel), []);
  for (const r of await tasks.batch([{ op: "accept", id: b2.id }], { actor: "nobody" } as Ctx)) rejectedWith(r, /actor/);
  assert.equal((await get(b2.id)).status, "proposed");
});

test("an atomic batch rolls everything back on the first rejection and every receipt reports it", async () => {
  const a = await mk("Atomic a", {}, codex);
  const b = await mk("Atomic b");
  const before = await logCount();
  const receipts = await tasks.batch(
    [
      { op: "accept", id: a.id },
      { op: "complete", id: b.id, options: { date: "2026-09-05" } },
      { op: "accept", id: "t_nothere001" },
      { op: "start", id: b.id },
    ],
    { actor: "neel", key: "atomic-1" },
    { atomic: true },
  );
  assert.equal(receipts.length, 4);
  rejectedWith(receipts[0]!, /batch: rolled back; item 2 \(accept t_nothere001\) was rejected: task: no task "t_nothere001"/);
  rejectedWith(receipts[1]!, /batch: rolled back; item 2/);
  rejectedWith(receipts[2]!, /task: no task "t_nothere001"/);
  rejectedWith(receipts[3]!, /batch: rolled back; item 2/);
  assert.equal((await get(a.id)).status, "proposed", "rolled back");
  assert.equal((await get(b.id)).status, "accepted");
  assert.equal(await logCount(), before, "nothing logged");
  assert.equal(await db.store.read((tx) => tx.getReceipt(itemKey("atomic-1", 0))), null, "receipts stored before the abort are rolled back too");

  const p = await mk("Atomic parent");
  const c = await mk("Atomic child", { parent: p.id });
  const asked = await tasks.batch([{ op: "start", id: c.id }, { op: "complete", id: p.id }], neel, { atomic: true });
  rejectedWith(asked[0]!, /rolled back; item 1/);
  assert.deepEqual(rejectedWith(asked[1]!, /open sub-task/).needs?.options, ["complete", "leave"], "the culprit keeps its own receipt");
  assert.equal((await get(c.id)).status, "accepted", "the start was rolled back with it");

  const good = await tasks.batch([{ op: "accept", id: a.id }, { op: "start", id: a.id }, { op: "complete", id: a.id }], { actor: "neel", key: "atomic-2" }, { atomic: true });
  assert.deepEqual(good.map((r) => r.ok && r.outcome), ["updated", "updated", "updated"]);
  assert.equal((await get(a.id)).status, "done");
  assert.deepEqual(await ops(a.id), ["task.add", "task.accept", "task.start", "task.complete"]);
});

// ------------------------------------------------------------------ import

test("import creates each item in one transaction, reports per item, and a dry run rolls back", async () => {
  const p = await project("Import P");
  const ctx: Ctx = { actor: "import:todoist", key: "import-1", evidence: ["todoist:export-2026-09-06"] };
  const items: unknown[] = [
    { title: "Imported one", project: "import-p", labels: ["imported"], due: { date: "2026-09-08" } },
    { id: "t_import0001", title: "Imported two", status: "accepted", notes: "with id" },
    { title: "imported one" },
    { title: "" },
    { id: "bad-id", title: "Bad id" },
    "not an object",
    { id: "t_import0001", title: "Imported three" },
    { title: "Imported one", allowDuplicate: true },
  ];
  const expectOutcomes = ["created", "created", "duplicate", "rejected", "rejected", "rejected", "rejected", "created"];

  const before = await logCount();
  const dry = await tasks.import(items, ctx, { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.deepEqual([dry.created, dry.duplicate, dry.rejected], [3, 1, 4]);
  assert.deepEqual(dry.items.map((i) => i.outcome), expectOutcomes);
  assert.deepEqual(dry.items.map((i) => i.index), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.match(dry.items[0]!.id ?? "", /^t_[a-z0-9]{10}$/);
  assert.equal(dry.items[1]!.id, "t_import0001");
  assert.match(dry.items[2]!.issues[0]!, /Similar open tasks exist/);
  assert.match(dry.items[3]!.issues[0]!, /^title: /);
  assert.match(dry.items[4]!.issues[0]!, /^id: /);
  assert.match(dry.items[5]!.issues[0]!, /expected an object/);
  assert.match(dry.items[6]!.issues[0]!, /id: "t_import0001" is already used/);
  assert.equal(await logCount(), before, "a dry run writes nothing");
  assert.equal(await tasks.get("t_import0001"), null);
  assert.equal(await org.label.get("imported"), null);

  const real = await tasks.import(items, ctx);
  assert.equal(real.dryRun, false);
  assert.deepEqual([real.created, real.duplicate, real.rejected], [3, 1, 4]);
  assert.deepEqual(real.items.map((i) => i.outcome), expectOutcomes);
  assert.equal(await logCount(), before + 4, "three tasks and one label");
  const one = await get(real.items[0]!.id!);
  assert.equal(one.projectId, p.id);
  assert.equal(one.status, "proposed", "an importer is not neel");
  assert.deepEqual(one.labels, ["imported"]);
  assert.deepEqual(one.origin, { actor: "import:todoist", at: now, evidence: ["todoist:export-2026-09-06"] });
  const two = await get("t_import0001");
  assert.equal(two.status, "accepted");
  assert.equal(two.notes, "with id");
  const entry = (await history("t_import0001"))[0]!;
  assert.equal(entry.op, "task.import");
  assert.equal(entry.actor, "import:todoist");
  assert.equal(entry.key, itemKey("import-1", 1));
  assert.equal((await org.label.get("imported"))?.origin.actor, "import:todoist");

  const again = await tasks.import(items, { actor: "import:todoist" });
  assert.deepEqual(again.items.map((i) => i.outcome), ["duplicate", "rejected", "duplicate", "rejected", "rejected", "rejected", "rejected", "created"], "without keys: the titles are now duplicates and the explicit id is taken");
  assert.match(again.items[1]!.issues[0]!, /id: "t_import0001" is already used/, "a used id is rejected before the title is checked");
  const retried = await tasks.import(items, ctx);
  assert.deepEqual(retried.items.map((i) => i.outcome), expectOutcomes, "the keys return the stored receipts");
  assert.deepEqual(retried.items[0], real.items[0]);

  const bad = await tasks.import([{ title: "x" }], { actor: "nobody" } as Ctx);
  assert.deepEqual([bad.created, bad.duplicate, bad.rejected], [0, 0, 1]);
  assert.match(bad.items[0]!.issues[0]!, /actor/);
  assert.deepEqual(await tasks.import([], neel), { dryRun: false, created: 0, duplicate: 0, rejected: 0, items: [] });
});

// ------------------------------------------------------------------ the log

test("every mutation logs one entry with its op, and unchanged writes log nothing", async () => {
  const p = await project("Log P");
  const s = await section(p.id, "LS");
  const t = await mk("Log everything", { project: p.id, due: { date: "2026-09-10" } });
  const other = await mk("Log sibling", { project: p.id });
  okRecord(await tasks.update(t.id, { notes: "n" }, neel));
  okRecord(await tasks.assign(t.id, { bucket: "safe" }, neel));
  okRecord(await tasks.reschedule(t.id, { date: "2026-09-11" }, neel));
  okRecord(await tasks.note(t.id, "note", neel));
  okRecord(await tasks.start(t.id, neel));
  okRecord(await tasks.complete(t.id, neel));
  okRecord(await tasks.uncomplete(t.id, neel));
  okRecord(await tasks.cancel(t.id, { actor: "neel", reason: "why" }));
  okRecord(await tasks.uncomplete(t.id, neel));
  okRecord(await tasks.move(t.id, { section: s.id }, neel));
  okRecord(await tasks.move(t.id, { section: null }, neel));
  for (const r of await tasks.reorder([other.id, t.id], neel)) okRecord(r);
  okRecord(await tasks.duplicate(t.id, neel));
  okRecord(await tasks.delete(t.id, neel));
  okRecord(await tasks.restore(t.id, neel));
  assert.deepEqual(await ops(t.id), [
    "task.add",
    "task.update",
    "task.assign",
    "task.reschedule",
    "task.note",
    "task.start",
    "task.complete",
    "task.uncomplete",
    "task.cancel",
    "task.uncomplete",
    "task.move",
    "task.move",
    "task.reorder",
    "task.delete",
    "task.restore",
  ]);
  assert.equal((await get(t.id)).version, 15);
  const entries = await history(t.id);
  assert.ok(entries.every((e) => e.actor === "neel" && e.recordKind === "task" && e.recordId === t.id && e.at === now));
  assert.ok(entries.every((e) => Object.keys(e.patch).length > 0), "every entry carries a patch");

  const before = await logCount();
  for (const receipt of [
    await tasks.update(t.id, { notes: "n" }, neel),
    await tasks.assign(t.id, { bucket: "safe" }, neel),
    await tasks.reschedule(t.id, { date: "2026-09-11" }, neel),
    await tasks.move(t.id, { project: p.id }, neel),
    await tasks.restore(t.id, neel),
    ...(await tasks.reorder([other.id, t.id], neel)),
  ]) {
    assert.equal(receipt.ok && receipt.outcome, "unchanged", JSON.stringify(receipt));
  }
  assert.equal(await logCount(), before);
});

// ------------------------------------------------------------------ review findings

test("a rejected mutation writes nothing, even when a cascade ran before the check that failed", async () => {
  const weekly = await mk("Side effect weekly", { due: { date: "2026-09-08" }, repeat: "FREQ=WEEKLY" });
  const before = await logCount();
  rejectedWith(await tasks.update(weekly.id, { labels: ["garden-side-effect"], due: null }, neel), /due: a repeating task needs a due date/);
  assert.equal(await org.label.get("garden-side-effect"), null, "the label the update would have registered does not exist");
  assert.equal(await logCount(), before, "nothing logged");
  assert.deepEqual((await get(weekly.id)).labels, []);

  rejectedWith(await tasks.add({ title: "Side effect add", labels: ["never-registered"], section: "No Such Section" }, neel), /section: no section "No Such Section"/);
  assert.equal(await org.label.get("never-registered"), null);
  assert.equal(await logCount(), before);

  // On an empty database the Inbox itself is a write that add cascades; a rejection leaves it uncreated.
  const fresh = await createTestDb();
  try {
    const ops = createTasks(fresh.store, clock);
    rejectedWith(await ops.add({ title: "Fresh add", section: "Nope" }, neel), /section: no section "Nope" in project "inbox"/);
    rejectedWith(await ops.add({ title: "Fresh add", project: "inbox", parent: "t_0000000000" }, neel), /parent: no task "t_0000000000"/);
    assert.deepEqual(await fresh.store.read((tx) => tx.all("project", { includeDeleted: true })), [], "no Inbox row");
    assert.deepEqual(await fresh.store.read((tx) => tx.allLog()), []);
  } finally {
    await fresh.drop();
  }
});

test('add and move with the ref "inbox" create the Inbox on first use, like the default', async () => {
  const fresh = await createTestDb();
  try {
    const ops = createTasks(fresh.store, clock);
    const first = okRecord(await ops.add({ title: "Renew car registration", project: "inbox" }, codex));
    const projects = await fresh.store.read((tx) => tx.all("project"));
    assert.equal(projects.length, 1);
    assert.equal(projects[0]!.system, true, "the Inbox");
    assert.equal(first.projectId, projects[0]!.id);
    assert.equal(first.status, "proposed");
    const elsewhere = okRecord(await createOrganize(fresh.store, clock).project.add({ name: "Elsewhere" }, neel));
    assert.equal(okRecord(await ops.move(first.id, { project: elsewhere.id }, neel)).projectId, elsewhere.id);
    assert.equal(okRecord(await ops.move(first.id, { project: "Inbox" }, neel)).projectId, projects[0]!.id, "the ref is case-insensitive");
  } finally {
    await fresh.drop();
  }
});

test("uncomplete on a repeating task restores the due date the completion advanced from, not the date it recorded", async () => {
  const t = await mk("Rewind weekly", { due: { date: "2026-09-14" }, repeat: "FREQ=WEEKLY" });
  const early = okRecord(await tasks.complete(t.id, neel, { date: "2026-09-10" }));
  assert.equal(early.due?.date, "2026-09-21");
  assert.deepEqual(early.occurrences.map((o) => o.date), ["2026-09-10"]);
  const rewound = okRecord(await tasks.uncomplete(t.id, neel));
  assert.equal(rewound.due?.date, "2026-09-14", "the due date before the completion, from its log entry");
  assert.deepEqual(rewound.occurrences, []);
  assert.deepEqual((await history(t.id)).at(-1)!.patch.due, { from: { date: "2026-09-21" }, to: { date: "2026-09-14" } });

  // Completed twice more and rewound twice: each rewind pairs with its own completion's entry.
  okRecord(await tasks.complete(t.id, codex, { date: "2026-09-16" }));
  okRecord(await tasks.complete(t.id, neel));
  assert.equal(okRecord(await tasks.uncomplete(t.id, neel)).due?.date, "2026-09-21");
  assert.equal(okRecord(await tasks.uncomplete(t.id, neel)).due?.date, "2026-09-14");
  assert.deepEqual((await get(t.id)).occurrences, []);
});

test("an idempotency key answers one operation, and item keys cannot collide with caller keys", async () => {
  const receipt = await tasks.add({ title: "Key kind probe", allowDuplicate: true }, { actor: "neel", key: "shared-kind-key" });
  okRecord(receipt);
  const other = await mk("Key kind other", {}, codex);
  rejectedWith(await tasks.accept(other.id, { actor: "neel", key: "shared-kind-key" }), /key: "shared-kind-key" was already used by task.add/);
  assert.equal((await get(other.id)).status, "proposed", "the accept did not run");
  assert.deepEqual(await tasks.add({ title: "Key kind probe", allowDuplicate: true }, { actor: "neel", key: "shared-kind-key" }), receipt, "the same op still replays");

  const proposed = await mk("Key item probe", {}, codex);
  okRecord(await tasks.add({ title: "Key colon zero", allowDuplicate: true }, { actor: "neel", key: "b:0" }));
  const [accepted] = await tasks.batch([{ op: "accept", id: proposed.id }], { actor: "neel", key: "b" });
  assert.equal(accepted!.ok && accepted!.outcome, "updated", 'item 0 of key "b" does not replay the receipt stored under "b:0"');
  assert.equal((await get(proposed.id)).status, "accepted");
  rejectedWith(await tasks.accept(proposed.id, { actor: "neel", key: itemKey("b", 0) }), /key: No control characters/);
});
