// An independent specification suite for organize.ts, written from the brief
// (README.md) and HANDS.md alone. Tasks are inserted straight through the
// store because tasks.ts does not exist yet. One throwaway schema per file;
// tests within the file run in order and build on each other's records.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Ctx, Label, LogEntry, Project, Receipt, Section, Task } from "./contract.ts";
import { newId } from "./core.ts";
import { createTestDb, fixedClock, type TestDb } from "./db/testing.ts";
import type { Kind } from "./store.ts";
import {
  createOrganize,
  effectiveLabels,
  ensureInbox,
  projectDescendants,
  projectPath,
  resolveProject,
  resolveSection,
} from "./organize.ts";

// 12:00Z on Sept 6 is 05:00 in Los Angeles, so "today" in the clock's timezone is 2026-09-06.
const clock = fixedClock("2026-09-06T12:00:00Z");
const now = "2026-09-06T12:00:00Z";
const today = "2026-09-06";
const tomorrow = "2026-09-07";
const neel: Ctx = { actor: "neel" };
const codex: Ctx = { actor: "codex", reason: "Neel asked in chat", evidence: ["msg:42"] };
const origin = { actor: "neel", at: now, evidence: [] };

let db: TestDb;
let org: ReturnType<typeof createOrganize>;
let inbox: Project;

before(async () => {
  db = await createTestDb();
  org = createOrganize(db.store, clock);
});
after(() => db.drop());

// ------------------------------------------------------------------ helpers

/** Narrow an ok receipt to its record, failing loudly otherwise. */
function ok<T>(receipt: Receipt<T>, why = ""): T {
  assert.ok(receipt.ok, `expected ok${why ? ` (${why})` : ""}, got ${JSON.stringify(receipt)}`);
  return receipt.record;
}

/** Narrow a rejected receipt, failing loudly otherwise. */
function rejectedOf<T>(receipt: Receipt<T>, why = ""): Extract<Receipt<T>, { outcome: "rejected" }> {
  assert.equal(receipt.ok, false, `expected a rejection${why ? ` (${why})` : ""}, got ${JSON.stringify(receipt)}`);
  assert.equal(receipt.outcome, "rejected");
  return receipt as Extract<Receipt<T>, { outcome: "rejected" }>;
}

const issuesText = <T>(receipt: Receipt<T>) => receipt.issues.join("\n");

const historyOf = (kind: Kind, id: string): Promise<LogEntry[]> => db.store.read((tx) => tx.history(kind, id));

/** The most recent log entry for a record, which every mutation must have appended. */
async function lastLog(kind: Kind, id: string): Promise<LogEntry> {
  const entries = await historyOf(kind, id);
  assert.ok(entries.length > 0, `${kind} ${id} has no log entries`);
  return entries[entries.length - 1]!;
}

/** Assert that the newest log entry for a record names the op and the actor. */
async function assertLogged(kind: Kind, id: string, op: string, ctx: Ctx): Promise<LogEntry> {
  const entry = await lastLog(kind, id);
  assert.equal(entry.op, op, `last log op for ${id}`);
  assert.equal(entry.actor, ctx.actor, `last log actor for ${id}`);
  assert.equal(entry.recordKind, kind);
  assert.equal(entry.recordId, id);
  assert.equal(entry.reason, ctx.reason ?? null);
  assert.deepEqual(entry.evidence, ctx.evidence ?? []);
  assert.equal(entry.key, ctx.key ?? null);
  assert.equal(entry.at, now, "log timestamps come from the injected clock");
  return entry;
}

const getRaw = <K extends Kind>(kind: K, id: string) => db.store.read((tx) => tx.get(kind, id));

const task = (projectId: string, extra: Partial<Task> = {}): Task => ({
  id: newId("task"),
  title: "A task",
  notes: "",
  projectId,
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

/** Insert tasks straight through the store, bypassing the (not yet existing) task operations. */
async function putTasks(...tasks: Task[]): Promise<Task[]> {
  await db.store.transaction(async (tx) => {
    for (const t of tasks) await tx.put("task", t);
  });
  return tasks;
}

const projectsById = (projects: Project[]) => new Map(projects.map((p) => [p.id, p]));

/** Descendants normalized to ids, whether the function returns records or ids. */
const descendantIds = (id: string, projects: Project[]) =>
  (projectDescendants(id, projects) as (Project | string)[]).map((p) => (typeof p === "string" ? p : p.id)).sort();

const liveProjects = () => db.store.read((tx) => tx.all("project"));

type Node = Awaited<ReturnType<typeof org.project.tree>>[number];
function findNode(nodes: Node[], id: string): Node | null {
  for (const node of nodes) {
    if (node.project.id === id) return node;
    const inner = findNode(node.children, id);
    if (inner) return inner;
  }
  return null;
}

// ------------------------------------------------------------------ inbox

test("ensureInbox creates the Inbox once, as a system project owned by neel", async () => {
  const created = await db.store.transaction((tx) => ensureInbox(tx, clock));
  assert.match(created.id, /^p_[a-z0-9]{10}$/);
  assert.equal(created.name, "Inbox");
  assert.equal(created.slug, "inbox");
  assert.equal(created.system, true);
  assert.equal(created.parentId, null);
  assert.equal(created.archived, false);
  assert.equal(created.deletedAt, null);
  assert.equal(created.origin.actor, "neel");
  assert.equal(created.version, 1);
  assert.equal(created.createdAt, now);
  inbox = created;

  const again = await db.store.transaction((tx) => ensureInbox(tx, clock));
  assert.deepEqual(again, created, "the second call returns the same record");
  const inboxes = (await liveProjects()).filter((p) => p.slug === "inbox" || p.system);
  assert.equal(inboxes.length, 1, "exactly one Inbox exists");
  assert.deepEqual(await getRaw("project", created.id), created);

  const history = await historyOf("project", created.id);
  assert.equal(history.length, 1, "creating the Inbox logs once; the second ensure logs nothing");
  assert.equal(history[0]!.actor, "neel");
  assert.match(history[0]!.op, /^project\./);
});

test("the Inbox resolves by slug and by id, in the tree and through resolveProject", async () => {
  assert.equal((await org.project.get("inbox"))?.id, inbox.id);
  assert.equal((await org.project.get(inbox.id))?.id, inbox.id);
  assert.equal((await db.store.read((tx) => resolveProject(tx, "inbox")))?.id, inbox.id);
  assert.equal((await db.store.read((tx) => resolveProject(tx, inbox.id)))?.id, inbox.id);
  const tree = await org.project.tree();
  const node = tree.find((n) => n.project.id === inbox.id);
  assert.ok(node, "the Inbox is a top-level node of the tree");
  assert.deepEqual(node.children, []);
  assert.deepEqual(node.sections, []);
});

test("the Inbox cannot be moved, deleted, or archived", async () => {
  const other = ok(await org.project.add({ name: "Somewhere" }, neel));
  const moved = rejectedOf(await org.project.move("inbox", other.id, neel), "move inbox");
  assert.match(issuesText(moved), /inbox/i);
  const deleted = rejectedOf(await org.project.delete("inbox", neel), "delete inbox");
  assert.match(issuesText(deleted), /inbox/i);
  rejectedOf(await org.project.delete(inbox.id, neel, { contents: "delete" }), "delete inbox by id with a choice");
  rejectedOf(await org.project.delete("inbox", neel, { contents: "inbox" }), "delete inbox into itself");
  rejectedOf(await org.project.archive("inbox", neel), "archive inbox");

  const stored = await getRaw("project", inbox.id);
  assert.deepEqual(stored, inbox, "the Inbox is untouched by the refused calls");
  assert.equal((await historyOf("project", inbox.id)).length, 1, "refusals log nothing");
  ok(await org.project.delete(other.id, neel));
});

// ------------------------------------------------------------------ projects

let health: Project;
let dental: Project;
let ortho: Project;
let topDental: Project;

test("project.add defaults the slug to kebab-case, orders siblings last, and logs with the actor", async () => {
  const receipt = await org.project.add({ name: "  Health & Fitness!  " }, codex);
  assert.equal(receipt.ok && receipt.outcome, "created");
  health = ok(receipt);
  assert.match(health.id, /^p_[a-z0-9]{10}$/);
  assert.equal(health.name, "Health & Fitness!", "text is trimmed");
  assert.equal(health.slug, "health-fitness");
  assert.equal(health.parentId, null);
  assert.equal(health.layout, "list");
  assert.deepEqual(health.labels, []);
  assert.equal(health.archived, false);
  assert.equal(health.system, false);
  assert.equal(health.color, undefined);
  assert.deepEqual(health.external, []);
  assert.equal(health.origin.actor, "codex");
  assert.equal(health.origin.at, now);
  assert.equal(health.version, 1);
  assert.equal(health.createdAt, now);
  assert.equal(health.updatedAt, now);
  assert.equal(health.deletedAt, null);
  assert.deepEqual(await getRaw("project", health.id), health, "the receipt's record is what is stored");
  const entry = await assertLogged("project", health.id, "project.add", codex);
  assert.deepEqual(entry.patch.slug, { from: null, to: "health-fitness" });

  const siblings = await Promise.all([
    org.project.add({ name: "Reading", color: "blue", layout: "board", labels: ["growth"] }, neel),
    org.project.add({ name: "Money" }, neel),
  ]);
  const [reading, money] = siblings.map((r) => ok(r));
  assert.equal(reading!.color, "blue");
  assert.equal(reading!.layout, "board");
  assert.deepEqual(reading!.labels, ["growth"]);
  assert.ok(health.order < reading!.order && reading!.order < money!.order, "each new sibling orders after the last");
});

test("project slugs are unique among siblings only, and nested projects resolve by slug path", async () => {
  const clash = rejectedOf(await org.project.add({ name: "Health Fitness" }, neel), "same slug at the top level");
  assert.match(issuesText(clash), /slug/i);
  rejectedOf(await org.project.add({ name: "Anything", slug: "health-fitness" }, neel), "explicit clashing slug");
  rejectedOf(await org.project.add({ name: "Bad", slug: "Not A Slug" }, neel), "slug grammar");
  rejectedOf(await org.project.add({ name: "Orphan", parent: "no-such-project" }, neel), "unknown parent");
  rejectedOf(await org.project.add({ name: "" }, neel), "empty name");

  dental = ok(await org.project.add({ name: "Dental Care", slug: "dental", parent: "health-fitness" }, neel));
  assert.equal(dental.parentId, health.id);
  assert.equal(dental.slug, "dental");
  ortho = ok(await org.project.add({ name: "Ortho", parent: "health-fitness/dental" }, neel), "parent by slug path");
  assert.equal(ortho.parentId, dental.id);
  const byId = ok(await org.project.add({ name: "Checkups", parent: dental.id }, neel), "parent by id");
  assert.equal(byId.parentId, dental.id);
  assert.ok(ortho.order < byId.order, "order is scoped to the parent");

  rejectedOf(await org.project.add({ name: "Dental", parent: health.id }, neel), "duplicate slug under the same parent");
  topDental = ok(await org.project.add({ name: "Dental" }, neel), "the same slug under a different parent is fine");
  assert.equal(topDental.slug, "dental");
  assert.equal(topDental.parentId, null);

  assert.equal((await org.project.get("health-fitness"))?.id, health.id);
  assert.equal((await org.project.get("health-fitness/dental"))?.id, dental.id);
  assert.equal((await org.project.get("health-fitness/dental/ortho"))?.id, ortho.id);
  assert.equal((await org.project.get("dental"))?.id, topDental.id, "a bare slug is a top-level path");
  assert.equal((await org.project.get(ortho.id))?.id, ortho.id);
  assert.equal(await org.project.get("dental/ortho"), null, "paths start at the root");
  assert.equal(await org.project.get("health-fitness/nope"), null);
  assert.equal(await org.project.get("p_0000000000"), null);

  await db.store.read(async (tx) => {
    assert.equal((await resolveProject(tx, "health-fitness/dental/ortho"))?.id, ortho.id);
    assert.equal((await resolveProject(tx, ortho.id))?.id, ortho.id);
    assert.equal(await resolveProject(tx, "nowhere"), null);
  });

  const map = projectsById(await liveProjects());
  assert.equal(projectPath(ortho, map), "health-fitness/dental/ortho");
  assert.equal(projectPath(topDental, map), "dental");
  assert.equal(projectPath(inbox, map), "inbox");
  const all = await liveProjects();
  assert.deepEqual(descendantIds(health.id, all), [dental.id, ortho.id, byId.id].sort());
  assert.deepEqual(descendantIds(dental.id, all), [ortho.id, byId.id].sort());
  assert.deepEqual(descendantIds(ortho.id, all), []);
  assert.ok(!descendantIds(health.id, all).includes(health.id), "a project is not its own descendant");
});

test("project.tree nests children and sections, each ordered by order", async () => {
  const later = ok(await org.section.add({ project: "health-fitness", name: "Later" }, neel));
  const soon = ok(await org.section.add({ project: health.id, name: "Soon" }, neel));
  assert.ok(later.order < soon.order);
  for (const receipt of await org.section.reorder([soon.id, later.id], neel)) ok(receipt);
  const zeta = ok(await org.project.add({ name: "Zeta", parent: ortho.id }, neel));
  const alpha = ok(await org.project.add({ name: "Alpha", parent: ortho.id }, neel));
  for (const receipt of await org.project.reorder([alpha.id, zeta.id], neel)) ok(receipt);

  const tree = await org.project.tree();
  assert.ok(tree.every((node) => node.project.parentId === null), "top level holds only roots");
  const orders = tree.map((node) => node.project.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), "roots are ordered by order");
  const node = findNode(tree, health.id);
  assert.ok(node);
  assert.deepEqual(node.sections.map((s) => s.name), ["Soon", "Later"]);
  assert.deepEqual(node.children.map((c) => c.project.id), [dental.id]);
  const dentalNode = node.children[0]!;
  assert.deepEqual(dentalNode.children.map((c) => c.project.slug), ["ortho", "checkups"]);
  const orthoNode = dentalNode.children[0]!;
  assert.deepEqual(orthoNode.children.map((c) => c.project.name), ["Alpha", "Zeta"]);
  assert.deepEqual(orthoNode.children[0]!.children, []);
  assert.deepEqual(orthoNode.sections, []);
  assert.ok(findNode(tree, topDental.id), "the top-level dental is its own root");
});

test("project.move re-parents, refuses cycles and slug clashes, and reports an unchanged move", async () => {
  const cycle = rejectedOf(await org.project.move("health-fitness", ortho.id, neel), "into own grandchild");
  assert.match(issuesText(cycle), /cycle|descendant|itself|own/i);
  rejectedOf(await org.project.move(dental.id, dental.id, neel), "into itself");
  rejectedOf(await org.project.move(ortho.id, "p_0000000000", neel), "unknown parent");
  rejectedOf(await org.project.move("dental", "health-fitness", neel), "a sibling already has that slug");
  assert.equal((await getRaw("project", health.id))?.parentId, null, "nothing moved");

  const same = await org.project.move(ortho.id, "health-fitness/dental", neel);
  assert.equal(same.ok && same.outcome, "unchanged");
  assert.equal((await historyOf("project", ortho.id)).length, 1, "an unchanged move logs nothing");

  const top = ok(await org.project.move("health-fitness/dental/ortho", null, codex));
  assert.equal(top.parentId, null);
  assert.equal(top.version, 2);
  const roots = (await liveProjects()).filter((p) => p.parentId === null && p.id !== top.id);
  assert.ok(roots.every((p) => p.order < top.order), "a moved project orders last among its new siblings");
  assert.equal((await org.project.get("ortho"))?.id, ortho.id);
  assert.equal(await org.project.get("health-fitness/dental/ortho"), null);
  assert.equal((await org.project.get("ortho/alpha"))?.name, "Alpha", "the subtree follows the moved project");
  const entry = await assertLogged("project", ortho.id, "project.move", codex);
  assert.deepEqual(entry.patch.parentId, { from: dental.id, to: null });

  ortho = ok(await org.project.move(ortho.id, dental.id, neel));
  assert.equal(ortho.parentId, dental.id);
  assert.equal((await org.project.get("health-fitness/dental/ortho/alpha"))?.name, "Alpha", "the subtree moves with it");
});

test("project.archive and unarchive toggle the flag, hide the project from the tree, and log", async () => {
  const archived = ok(await org.project.archive("health-fitness/dental", codex));
  assert.equal(archived.archived, true);
  assert.equal(archived.version, 2);
  await assertLogged("project", dental.id, "project.archive", codex);
  assert.equal((await org.project.get("health-fitness/dental"))?.archived, true, "get still finds an archived project");
  assert.equal(findNode(await org.project.tree(), dental.id), null, "archived projects leave the default tree");
  assert.ok(findNode(await org.project.tree({ includeArchived: true }), dental.id), "includeArchived shows them");

  const twice = await org.project.archive(dental.id, neel);
  assert.equal(twice.ok && twice.outcome, "unchanged");
  assert.equal((await historyOf("project", dental.id)).length, 2);

  const restored = ok(await org.project.unarchive(dental.id, neel));
  assert.equal(restored.archived, false);
  assert.equal(restored.version, 3);
  await assertLogged("project", dental.id, "project.unarchive", neel);
  assert.ok(findNode(await org.project.tree(), dental.id));
  dental = restored;
});

test("project.update changes name, slug, color, layout and labels; slugs stay unique; ifVersion guards", async () => {
  const updated = ok(await org.project.update("health-fitness", { name: "Health", slug: "health", color: "green", layout: "board", labels: ["health"] }, codex));
  assert.equal(updated.name, "Health");
  assert.equal(updated.slug, "health");
  assert.equal(updated.color, "green");
  assert.equal(updated.layout, "board");
  assert.deepEqual(updated.labels, ["health"]);
  assert.equal(updated.version, 2);
  const entry = await assertLogged("project", health.id, "project.update", codex);
  assert.deepEqual(entry.patch.slug, { from: "health-fitness", to: "health" });
  assert.deepEqual(entry.patch.color, { from: null, to: "green" });
  assert.equal(entry.patch.version, undefined);
  assert.equal(await org.project.get("health-fitness"), null);
  assert.equal((await org.project.get("health/dental/ortho"))?.id, ortho.id, "children follow the renamed path");

  const cleared = ok(await org.project.update(health.id, { color: null }, neel));
  assert.equal(cleared.color, undefined);
  assert.equal(cleared.version, 3);
  const same = await org.project.update(health.id, { name: "Health" }, neel);
  assert.equal(same.ok && same.outcome, "unchanged");
  assert.equal(same.ok && same.version, 3);

  rejectedOf(await org.project.update(topDental.id, { slug: "health" }, neel), "slug taken by a sibling");
  rejectedOf(await org.project.update("health", { slug: "" }, neel), "empty slug");
  rejectedOf(await org.project.update("health", { name: "x", bogus: true } as never, neel), "unknown field");
  rejectedOf(await org.project.update("nowhere", { name: "x" }, neel), "unknown project");
  const stale = rejectedOf(await org.project.update(health.id, { name: "Stale" }, { actor: "neel", ifVersion: 1 }), "ifVersion");
  assert.match(issuesText(stale), /version/);
  assert.equal(stale.id, health.id);
  assert.equal(stale.record?.version, 3, "the rejection carries the current record");
  assert.equal((await getRaw("project", health.id))?.name, "Health");
  health = cleared;
});

test("project.reorder assigns 0..n-1 to siblings and refuses non-siblings", async () => {
  const roots = (await liveProjects()).filter((p) => p.parentId === null && !p.system).sort((a, b) => a.order - b.order);
  const ids = roots.map((p) => p.id);
  const reversed = [...ids].reverse();
  const receipts = await org.project.reorder(reversed, neel);
  assert.equal(receipts.length, reversed.length);
  receipts.forEach((receipt, index) => {
    const record = ok(receipt);
    assert.equal(record.id, reversed[index]);
    assert.equal(record.order, index);
  });
  const tree = await org.project.tree();
  assert.deepEqual(tree.filter((n) => !n.project.system).map((n) => n.project.id), reversed);

  const mixed = await org.project.reorder([health.id, dental.id], neel);
  assert.ok(mixed.length > 0 && mixed.every((r) => !r.ok), "non-siblings are refused");
  rejectedOf(mixed[0]!);
  assert.equal((await getRaw("project", dental.id))?.version, dental.version, "nothing changed");
  const unknown = await org.project.reorder([health.id, "p_0000000000"], neel);
  assert.ok(unknown.every((r) => !r.ok));
});

test("project.history returns the project's log entries in order", async () => {
  const history = await org.project.history(health.id);
  assert.deepEqual(history, await historyOf("project", health.id));
  assert.deepEqual(history.map((e) => e.op).slice(0, 3), ["project.add", "project.update", "project.update"]);
  assert.ok(history.every((e, i) => i === 0 || history[i - 1]!.seq < e.seq));
  assert.deepEqual(await org.project.history("p_0000000000"), []);
});

test("an idempotency key returns the stored receipt and applies nothing twice", async () => {
  const ctx: Ctx = { actor: "codex", key: "org-project-add-1", reason: "twice" };
  const first = await org.project.add({ name: "Idempotent" }, ctx);
  const again = await org.project.add({ name: "Idempotent" }, ctx);
  assert.deepEqual(again, first);
  ok(first);
  assert.equal((await liveProjects()).filter((p) => p.slug === "idempotent").length, 1);
  assert.equal((await historyOf("project", first.ok ? first.id : "")).length, 1);
  assert.deepEqual(await db.store.read((tx) => tx.getReceipt("org-project-add-1")), first);

  const labelCtx: Ctx = { actor: "neel", key: "org-label-add-1" };
  const l1 = await org.label.add({ name: "idem" }, labelCtx);
  const l2 = await org.label.add({ name: "idem" }, labelCtx);
  assert.deepEqual(l2, l1);
  assert.equal(l1.ok && l1.outcome, "created", "the replay is the stored created receipt, not a uniqueness rejection");

  const sectionCtx: Ctx = { actor: "neel", key: "org-section-add-1" };
  const s1 = await org.section.add({ project: "health", name: "Idem" }, sectionCtx);
  const s2 = await org.section.add({ project: "health", name: "Idem" }, sectionCtx);
  assert.deepEqual(s2, s1);
  assert.equal((await org.section.list("health")).filter((s) => s.name === "Idem").length, 1);

  const bad = await org.project.add({ name: "No actor" }, { actor: "nobody", key: "org-bad-1" } as never);
  rejectedOf(bad);
  assert.equal(await db.store.read((tx) => tx.getReceipt("org-bad-1")), null, "rejections are never stored");
});

// ------------------------------------------------------------------ project delete and restore

test("project.delete on an empty project needs no choice; the slug stops resolving and the record stays readable", async () => {
  const empty = ok(await org.project.add({ name: "Empty Room" }, neel));
  const gone = ok(await org.project.delete("empty-room", codex));
  assert.equal(gone.deletedAt, now);
  assert.equal(gone.version, 2);
  assert.equal(gone.archived, false, "delete does not archive");
  const entry = await assertLogged("project", empty.id, "project.delete", codex);
  assert.deepEqual(entry.patch.deletedAt, { from: null, to: now });
  assert.equal(await org.project.get("empty-room"), null, "deleted projects do not resolve by slug");
  assert.equal(await db.store.read((tx) => resolveProject(tx, "empty-room")), null);
  assert.equal((await getRaw("project", empty.id))?.deletedAt, now);
  assert.equal(findNode(await org.project.tree({ includeArchived: true }), empty.id), null, "deleted projects are never in the tree");
  rejectedOf(await org.project.delete("empty-room", neel), "deleting by a slug that no longer resolves");
});

let work: Project;
let client: Project;
let site: Project;
let workSection: Section;
let workTasks: Task[];

test("project.delete with tasks or sub-projects and no choice asks what to do with the contents", async () => {
  work = ok(await org.project.add({ name: "Work" }, neel));
  client = ok(await org.project.add({ name: "Client", parent: "work" }, neel));
  site = ok(await org.project.add({ name: "Site", parent: "work/client" }, neel));
  workSection = ok(await org.section.add({ project: "work", name: "This week" }, neel));
  workTasks = await putTasks(
    task(work.id, { title: "Send invoice", sectionId: workSection.id }),
    task(client.id, { title: "Call the client", status: "in_progress" }),
    task(site.id, { title: "Deploy the site", status: "proposed" }),
  );

  const asked = rejectedOf(await org.project.delete("work", neel), "contents without a choice");
  assert.deepEqual(asked.needs?.field, "contents");
  assert.deepEqual(asked.needs?.options, ["delete", "inbox"]);
  assert.ok(asked.needs?.message);
  assert.equal(asked.id, work.id);
  for (const t of workTasks) assert.equal((await getRaw("task", t.id))?.deletedAt, null, "nothing changed");
  assert.equal((await getRaw("project", work.id))?.deletedAt, null);
  assert.equal((await getRaw("project", work.id))?.version, 1);

  const onlyProjects = ok(await org.project.add({ name: "Shell" }, neel));
  ok(await org.project.add({ name: "Kernel", parent: "shell" }, neel));
  const askedAgain = rejectedOf(await org.project.delete(onlyProjects.id, neel), "sub-projects alone are contents too");
  assert.equal(askedAgain.needs?.field, "contents");

  const onlyDeletedTask = ok(await org.project.add({ name: "Husk" }, neel));
  await putTasks(task(onlyDeletedTask.id, { title: "Already gone", deletedAt: now }));
  ok(await org.project.delete("husk", neel), "already-deleted tasks do not count as contents");
});

test('project.delete with contents "delete" soft-deletes sub-projects, sections and tasks recursively, each logged', async () => {
  const receipt = ok(await org.project.delete("work", codex, { contents: "delete" }));
  assert.equal(receipt.deletedAt, now);
  await assertLogged("project", work.id, "project.delete", codex);
  for (const p of [client, site]) {
    const stored = await getRaw("project", p.id);
    assert.equal(stored?.deletedAt, now, `${p.name} is deleted`);
    assert.equal(stored?.version, 2);
    const entry = await lastLog("project", p.id);
    assert.equal(entry.actor, "codex");
    assert.deepEqual(entry.patch.deletedAt, { from: null, to: now });
  }
  const section = await getRaw("section", workSection.id);
  assert.equal(section?.deletedAt, now);
  assert.equal((await lastLog("section", workSection.id)).actor, "codex");
  for (const t of workTasks) {
    const stored = await getRaw("task", t.id);
    assert.equal(stored?.deletedAt, now, `${t.title} is deleted`);
    assert.equal(stored?.status, t.status, "delete leaves status alone");
    assert.equal(stored?.projectId, t.projectId, "delete leaves the task where it was");
    assert.equal(stored?.sectionId, t.sectionId);
    assert.equal(stored?.version, 2);
    const entry = await lastLog("task", t.id);
    assert.equal(entry.actor, "codex");
    assert.deepEqual(entry.patch.deletedAt, { from: null, to: now });
  }
  assert.equal(await org.project.get("work"), null);
  assert.equal(await org.project.get("work/client/site"), null);
  await assert.rejects(org.section.list(work.id), /deleted|no project/i, "listing sections of a deleted project is a failed read, not an empty list");
});

test("project.restore of a project whose parent is deleted becomes top level; its tasks stay deleted", async () => {
  const restored = ok(await org.project.restore(site.id, codex));
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.parentId, null, "the parent is deleted, so the project becomes a root");
  assert.equal(restored.version, 3);
  const entry = await assertLogged("project", site.id, "project.restore", codex);
  assert.deepEqual(entry.patch.deletedAt, { from: now, to: null });
  assert.deepEqual(entry.patch.parentId, { from: client.id, to: null });
  assert.equal((await org.project.get("site"))?.id, site.id);
  assert.ok(findNode(await org.project.tree(), site.id));
  const siteTask = workTasks.find((t) => t.projectId === site.id)!;
  assert.equal((await getRaw("task", siteTask.id))?.deletedAt, now, "tasks deleted with the project stay deleted");

  const parentBack = ok(await org.project.restore(client.id, neel));
  assert.equal(parentBack.parentId, null, "its parent Work is still deleted");
  const workBack = ok(await org.project.restore(work.id, neel));
  assert.equal(workBack.parentId, null);
  assert.equal(workBack.deletedAt, null);
  assert.equal((await getRaw("section", workSection.id))?.deletedAt, now, "sections deleted with the project stay deleted");
  assert.deepEqual(await org.section.list("work"), [], "deleted sections leave the list");
  rejectedOf(await org.project.restore("p_0000000000", neel), "unknown id");
  rejectedOf(await org.project.restore("work", neel), "restore takes an id, not a ref");
});

test('project.delete with contents "inbox" moves every task in the subtree to Inbox with no section and deletes the rest', async () => {
  const home = ok(await org.project.add({ name: "Home" }, neel));
  const garden = ok(await org.project.add({ name: "Garden", parent: "home" }, neel));
  const emptyChild = ok(await org.project.add({ name: "Attic", parent: home.id }, neel));
  const chores = ok(await org.section.add({ project: "home", name: "Chores" }, neel));
  const parentTask = task(garden.id, { title: "Plant tomatoes", labels: ["outdoors"] });
  const tasks = await putTasks(
    task(home.id, { title: "Fix the tap", sectionId: chores.id, order: 3 }),
    parentTask,
    task(garden.id, { title: "Buy seedlings", parentId: parentTask.id, order: 0 }),
    task(home.id, { title: "Already done", status: "done", completedAt: now }),
  );
  const alreadyDeleted = (await putTasks(task(home.id, { title: "Was deleted", deletedAt: "2026-09-01T00:00:00Z" })))[0]!;

  const receipt = ok(await org.project.delete("home", codex, { contents: "inbox" }));
  assert.equal(receipt.deletedAt, now);
  await assertLogged("project", home.id, "project.delete", codex);
  for (const p of [garden, emptyChild]) assert.equal((await getRaw("project", p.id))?.deletedAt, now, `${p.name} deleted`);
  assert.equal((await getRaw("section", chores.id))?.deletedAt, now, "the emptied section is deleted");
  for (const t of tasks) {
    const stored = await getRaw("task", t.id);
    assert.equal(stored?.deletedAt, null, `${t.title} is not deleted`);
    assert.equal(stored?.projectId, inbox.id, `${t.title} is in the Inbox`);
    assert.equal(stored?.sectionId, undefined, `${t.title} has no section`);
    assert.equal(stored?.status, t.status);
    assert.equal(stored?.version, 2);
    assert.deepEqual(stored?.labels, t.labels);
    const entry = await lastLog("task", t.id);
    assert.equal(entry.actor, "codex");
    assert.deepEqual(entry.patch.projectId, { from: t.projectId, to: inbox.id });
  }
  const child = await getRaw("task", tasks[2]!.id);
  assert.equal(child?.parentId, parentTask.id, "a sub-task keeps its parent, which moved with it");
  const untouched = await getRaw("task", alreadyDeleted.id);
  assert.equal(untouched?.projectId, home.id, "already-deleted tasks are left where they are");
  assert.equal(untouched?.version, 1);
  assert.equal(await org.project.get("home"), null);
});

// ------------------------------------------------------------------ sections

let planning: Project;
let backlog: Section;
let doing: Section;

test("section.add, get, list and resolveSection", async () => {
  planning = ok(await org.project.add({ name: "Planning" }, neel));
  const receipt = await org.section.add({ project: "planning", name: "  Backlog  " }, codex);
  assert.equal(receipt.ok && receipt.outcome, "created");
  backlog = ok(receipt);
  assert.match(backlog.id, /^s_[a-z0-9]{10}$/);
  assert.equal(backlog.projectId, planning.id);
  assert.equal(backlog.name, "Backlog");
  assert.equal(backlog.archived, false);
  assert.equal(backlog.deletedAt, null);
  assert.equal(backlog.origin.actor, "codex");
  assert.equal(backlog.version, 1);
  assert.deepEqual(await getRaw("section", backlog.id), backlog);
  await assertLogged("section", backlog.id, "section.add", codex);

  doing = ok(await org.section.add({ project: planning.id, name: "Doing" }, neel));
  assert.ok(backlog.order < doing.order, "sections order last in their project");
  const elsewhere = ok(await org.section.add({ project: "health", name: "Doing" }, neel));
  assert.equal(elsewhere.projectId, health.id);

  rejectedOf(await org.section.add({ project: "no-such", name: "X" }, neel), "unknown project");
  rejectedOf(await org.section.add({ project: "planning", name: "" }, neel), "empty name");
  rejectedOf(await org.section.add({ project: "planning", name: "X" }, { actor: "ghost" } as never), "bad actor");

  assert.deepEqual(await org.section.get(backlog.id), backlog);
  assert.equal(await org.section.get("s_0000000000"), null);
  assert.deepEqual((await org.section.list("planning")).map((s) => s.id), [backlog.id, doing.id]);
  assert.deepEqual((await org.section.list(planning.id)).map((s) => s.id), [backlog.id, doing.id]);
  await assert.rejects(org.section.list("no-such-project"), /no project|not found|unknown/i, "no silent empties: an unknown project is a failed read");

  await db.store.read(async (tx) => {
    assert.equal((await resolveSection(tx, planning.id, "Backlog"))?.id, backlog.id, "by name");
    assert.equal((await resolveSection(tx, planning.id, backlog.id))?.id, backlog.id, "by id");
    assert.equal((await resolveSection(tx, planning.id, "Doing"))?.id, doing.id, "the name resolves within the project");
    assert.equal((await resolveSection(tx, health.id, "Doing"))?.id, elsewhere.id);
    assert.equal(await resolveSection(tx, planning.id, "Nowhere"), null);
    assert.equal(await resolveSection(tx, health.id, backlog.id), null, "a section id from another project does not resolve");
  });
});

test("section.update, reorder, archive and unarchive log with the op name", async () => {
  const renamed = ok(await org.section.update(backlog.id, { name: "Ideas" }, codex));
  assert.equal(renamed.name, "Ideas");
  assert.equal(renamed.version, 2);
  const entry = await assertLogged("section", backlog.id, "section.update", codex);
  assert.deepEqual(entry.patch, { name: { from: "Backlog", to: "Ideas" } });
  const same = await org.section.update(backlog.id, { name: "Ideas" }, neel);
  assert.equal(same.ok && same.outcome, "unchanged");
  rejectedOf(await org.section.update("s_0000000000", { name: "X" }, neel));
  rejectedOf(await org.section.update(backlog.id, { name: "" }, neel));
  backlog = renamed;

  const receipts = await org.section.reorder([doing.id, backlog.id], neel);
  assert.deepEqual(receipts.map((r) => ok(r).order), [0, 1]);
  assert.deepEqual((await org.section.list("planning")).map((s) => s.id), [doing.id, backlog.id]);
  await assertLogged("section", doing.id, "section.reorder", neel);
  const mixed = await org.section.reorder([doing.id, (await org.section.list("health"))[0]!.id], neel);
  assert.ok(mixed.length > 0 && mixed.every((r) => !r.ok), "sections of different projects are refused");
  assert.deepEqual((await org.section.list("planning")).map((s) => s.id), [doing.id, backlog.id], "nothing changed");

  const archived = ok(await org.section.archive(doing.id, codex));
  assert.equal(archived.archived, true);
  await assertLogged("section", doing.id, "section.archive", codex);
  const unarchived = ok(await org.section.unarchive(doing.id, neel));
  assert.equal(unarchived.archived, false);
  await assertLogged("section", doing.id, "section.unarchive", neel);
  doing = unarchived;
});

test("section.delete asks about tasks, unsections or deletes them, and restore brings the section back", async () => {
  const [inSection, alsoInSection] = await putTasks(
    task(planning.id, { title: "Sketch the plan", sectionId: backlog.id }),
    task(planning.id, { title: "Review the plan", sectionId: backlog.id, status: "done", completedAt: now }),
  );
  const other = (await putTasks(task(planning.id, { title: "Elsewhere", sectionId: doing.id })))[0]!;

  const asked = rejectedOf(await org.section.delete(backlog.id, neel), "tasks without a choice");
  assert.equal(asked.needs?.field, "tasks");
  assert.deepEqual(asked.needs?.options, ["delete", "unsection"]);
  assert.ok(asked.needs?.message);
  assert.equal((await getRaw("section", backlog.id))?.deletedAt, null);

  const unsectioned = ok(await org.section.delete(backlog.id, codex, { tasks: "unsection" }));
  assert.equal(unsectioned.deletedAt, now);
  await assertLogged("section", backlog.id, "section.delete", codex);
  for (const t of [inSection!, alsoInSection!]) {
    const stored = await getRaw("task", t.id);
    assert.equal(stored?.sectionId, undefined, `${t.title} lost its section`);
    assert.equal(stored?.projectId, planning.id, "and stayed in the project");
    assert.equal(stored?.deletedAt, null);
    assert.equal(stored?.version, 2);
    const entry = await lastLog("task", t.id);
    assert.equal(entry.actor, "codex");
    assert.deepEqual(entry.patch.sectionId, { from: backlog.id, to: null });
  }
  assert.equal((await getRaw("task", other.id))?.sectionId, doing.id, "tasks in other sections are untouched");
  assert.deepEqual((await org.section.list("planning")).map((s) => s.id), [doing.id]);
  assert.equal((await getRaw("section", backlog.id))?.deletedAt, now);

  const restored = ok(await org.section.restore(backlog.id, neel));
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.projectId, planning.id);
  await assertLogged("section", backlog.id, "section.restore", neel);
  assert.deepEqual((await org.section.list("planning")).map((s) => s.id).sort(), [doing.id, backlog.id].sort());
  assert.equal((await getRaw("task", inSection!.id))?.sectionId, undefined, "restoring the section does not re-section tasks");

  const deleted = ok(await org.section.delete(doing.id, codex, { tasks: "delete" }));
  assert.equal(deleted.deletedAt, now);
  const gone = await getRaw("task", other.id);
  assert.equal(gone?.deletedAt, now);
  assert.equal(gone?.sectionId, doing.id, "a deleted task keeps its section so restore can put it back");
  assert.equal(gone?.status, "accepted");
  assert.equal((await lastLog("task", other.id)).actor, "codex");

  const empty = ok(await org.section.add({ project: "planning", name: "Empty" }, neel));
  ok(await org.section.delete(empty.id, neel), "an empty section needs no choice");
  rejectedOf(await org.section.delete("s_0000000000", neel));
  rejectedOf(await org.section.restore("s_0000000000", neel));
});

// ------------------------------------------------------------------ labels

let sleepLabel: Label;
let fitnessLabel: Label;

test("label.add, get and list; names are unique among non-deleted labels", async () => {
  const receipt = await org.label.add({ name: "sleep", color: "green" }, codex);
  assert.equal(receipt.ok && receipt.outcome, "created");
  sleepLabel = ok(receipt);
  assert.match(sleepLabel.id, /^l_[a-z0-9]{10}$/);
  assert.equal(sleepLabel.name, "sleep");
  assert.equal(sleepLabel.color, "green");
  assert.equal(sleepLabel.origin.actor, "codex");
  assert.equal(sleepLabel.version, 1);
  assert.equal(sleepLabel.deletedAt, null);
  assert.deepEqual(await getRaw("label", sleepLabel.id), sleepLabel);
  await assertLogged("label", sleepLabel.id, "label.add", codex);

  const dup = rejectedOf(await org.label.add({ name: "sleep" }, neel), "duplicate name");
  assert.match(issuesText(dup), /sleep|name|exists/i);
  rejectedOf(await org.label.add({ name: "Sleep" }, neel), "label names are slugs");
  rejectedOf(await org.label.add({ name: "" }, neel));
  fitnessLabel = ok(await org.label.add({ name: "fitness" }, neel));
  assert.ok(sleepLabel.order < fitnessLabel.order);

  assert.deepEqual(await org.label.get("sleep"), sleepLabel);
  assert.deepEqual(await org.label.get(sleepLabel.id), sleepLabel);
  assert.equal(await org.label.get("nope"), null);
  const listed = await org.label.list();
  const ours = listed.filter((l) => ["sleep", "fitness"].includes(l.name));
  assert.deepEqual(ours.map((l) => l.name), ["sleep", "fitness"], "list is ordered by order");
  assert.ok(listed.every((l, i) => i === 0 || listed[i - 1]!.order <= l.order));
});

test("label.reorder assigns 0..n-1 and label.update changes color", async () => {
  const names = (await org.label.list()).map((l) => l.id);
  const reversed = [...names].reverse();
  const receipts = await org.label.reorder(reversed, neel);
  assert.deepEqual(receipts.map((r) => ok(r).order), reversed.map((_, i) => i));
  assert.deepEqual((await org.label.list()).map((l) => l.id), reversed);
  await assertLogged("label", reversed[0]!, "label.reorder", neel);
  assert.ok((await org.label.reorder([sleepLabel.id, "l_0000000000"], neel)).every((r) => !r.ok));

  const teal = ok(await org.label.update("sleep", { color: "teal" }, codex));
  assert.equal(teal.color, "teal");
  const entry = await assertLogged("label", sleepLabel.id, "label.update", codex);
  assert.deepEqual(entry.patch, { color: { from: "green", to: "teal" } });
  const cleared = ok(await org.label.update(sleepLabel.id, { color: null }, neel));
  assert.equal(cleared.color, undefined);
  const same = await org.label.update("sleep", {}, neel);
  assert.equal(same.ok && same.outcome, "unchanged");
  rejectedOf(await org.label.update("nope", { color: "x" }, neel));
  sleepLabel = cleared;
});

test("renaming a label rewrites every task and project that carries it, each logged with the actor", async () => {
  const labeledProject = ok(await org.project.add({ name: "Wellbeing", labels: ["sleep", "fitness"] }, neel));
  const [t1, t2] = await putTasks(
    task(labeledProject.id, { title: "Run", labels: ["sleep"] }),
    task(inbox.id, { title: "Sleep", labels: ["fitness", "sleep"], status: "done", completedAt: now }),
  );
  const untouched = (await putTasks(task(inbox.id, { title: "Nothing to do with it", labels: ["fitness"] })))[0]!;
  const ctx: Ctx = { actor: "codex", reason: "areas were renamed", evidence: ["vault:Areas.md"] };

  rejectedOf(await org.label.update("sleep", { name: "fitness" }, neel), "renaming onto an existing name");
  const renamed = ok(await org.label.update("sleep", { name: "rest" }, ctx));
  assert.equal(renamed.name, "rest");
  assert.equal(renamed.id, sleepLabel.id);
  const entry = await assertLogged("label", sleepLabel.id, "label.update", ctx);
  assert.deepEqual(entry.patch.name, { from: "sleep", to: "rest" });
  assert.equal(await org.label.get("sleep"), null);
  assert.equal((await org.label.get("rest"))?.id, sleepLabel.id);

  const project = await getRaw("project", labeledProject.id);
  assert.deepEqual(project?.labels, ["rest", "fitness"], "the project's labels are rewritten in place");
  assert.equal(project?.version, 2);
  const projectEntry = await lastLog("project", labeledProject.id);
  assert.equal(projectEntry.actor, "codex");
  assert.equal(projectEntry.reason, "areas were renamed");
  assert.deepEqual(projectEntry.patch.labels, { from: ["sleep", "fitness"], to: ["rest", "fitness"] });

  const first = await getRaw("task", t1!.id);
  assert.deepEqual(first?.labels, ["rest"]);
  assert.equal(first?.version, 2);
  const second = await getRaw("task", t2!.id);
  assert.deepEqual(second?.labels, ["fitness", "rest"], "closed tasks are rewritten too");
  for (const t of [t1!, t2!]) {
    const taskEntry = await lastLog("task", t.id);
    assert.equal(taskEntry.actor, "codex");
    assert.equal(taskEntry.reason, "areas were renamed");
    assert.deepEqual(taskEntry.evidence, ["vault:Areas.md"]);
    assert.ok(taskEntry.patch.labels, "the task's log entry records the label change");
  }
  const bystander = await getRaw("task", untouched.id);
  assert.equal(bystander?.version, 1, "tasks without the label are not touched");
  assert.deepEqual(await historyOf("task", untouched.id), []);
  sleepLabel = renamed;
});

test("label.delete is refused while a non-deleted task or project carries it, then works, and restore brings it back", async () => {
  const inUse = rejectedOf(await org.label.delete("rest", neel), "in use");
  assert.match(issuesText(inUse), /rest|use|carr/i);
  assert.equal((await getRaw("label", sleepLabel.id))?.deletedAt, null);

  // Strip the label from everything that carries it, straight through the store.
  await db.store.transaction(async (tx) => {
    for (const t of await tx.all("task")) {
      if (t.labels.includes("rest")) await tx.put("task", { ...t, labels: t.labels.filter((l) => l !== "rest") });
    }
    for (const p of await tx.all("project")) {
      if (p.labels.includes("rest")) await tx.put("project", { ...p, labels: p.labels.filter((l) => l !== "rest") });
    }
  });
  // A deleted task carrying the label does not block deletion.
  await putTasks(task(inbox.id, { title: "Gone but labeled", labels: ["rest"], deletedAt: now }));

  const deleted = ok(await org.label.delete("rest", codex));
  assert.equal(deleted.deletedAt, now);
  assert.equal(deleted.name, "rest", "the name is kept so restore is exact");
  await assertLogged("label", sleepLabel.id, "label.delete", codex);
  assert.equal(await org.label.get("rest"), null, "deleted labels do not resolve by name");
  assert.ok(!(await org.label.list()).some((l) => l.id === sleepLabel.id), "deleted labels leave the list");
  rejectedOf(await org.label.delete("rest", neel), "already deleted");

  const restored = ok(await org.label.restore(sleepLabel.id, neel));
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.name, "rest");
  await assertLogged("label", sleepLabel.id, "label.restore", neel);
  assert.equal((await org.label.get("rest"))?.id, sleepLabel.id);
  rejectedOf(await org.label.add({ name: "rest" }, neel), "the name is taken again");

  ok(await org.label.delete(sleepLabel.id, neel));
  const replacement = ok(await org.label.add({ name: "rest" }, neel), "a deleted label's name is free");
  assert.notEqual(replacement.id, sleepLabel.id);
  rejectedOf(await org.label.restore("l_0000000000", neel));
});

// ------------------------------------------------------------------ effective labels

test("effectiveLabels adds the labels of the project and every ancestor, without duplicates", async () => {
  const root = ok(await org.project.add({ name: "Life", labels: ["life", "shared"] }, neel));
  const mid = ok(await org.project.add({ name: "Body", parent: "life", labels: ["body"] }, neel));
  const leaf = ok(await org.project.add({ name: "Teeth", parent: "life/body", labels: [] }, neel));
  const map = projectsById(await liveProjects());

  const deep = task(leaf.id, { labels: ["urgent", "shared"] });
  assert.deepEqual([...effectiveLabels(deep, map)].sort(), ["body", "life", "shared", "urgent"]);
  assert.equal(effectiveLabels(deep, map).length, 4, "no duplicates");
  assert.deepEqual([...effectiveLabels(task(mid.id), map)].sort(), ["body", "life", "shared"]);
  assert.deepEqual([...effectiveLabels(task(root.id, { labels: ["x"] }), map)].sort(), ["life", "shared", "x"]);
  assert.deepEqual(effectiveLabels(task(inbox.id), map), []);
  assert.deepEqual(effectiveLabels(task("p_0000000000", { labels: ["only"] }), map), ["only"], "an unknown project contributes nothing");
  assert.equal(projectPath(leaf, map), "life/body/teeth");
});

// ------------------------------------------------------------------ filters

let fitTasks: Record<string, Task>;
let savedFilter: Awaited<ReturnType<typeof org.filter.get>>;

test("filter.add validates the query grammar, and get/list find saved filters by name or id", async () => {
  const bad = rejectedOf(await org.filter.add({ name: "Broken", query: "bogus term & today" }, neel), "unknown term");
  assert.match(issuesText(bad), /query/);
  assert.match(issuesText(bad), /Unknown filter term/);
  rejectedOf(await org.filter.add({ name: "Unbalanced", query: "(today & @fit" }, neel), "missing parenthesis");
  rejectedOf(await org.filter.add({ name: "Empty", query: "   " }, neel), "empty query");
  rejectedOf(await org.filter.add({ name: "", query: "today" }, neel), "empty name");
  assert.deepEqual(await org.filter.list(), []);

  const receipt = await org.filter.add({ name: "Fit today", query: "today & @fit" }, codex);
  assert.equal(receipt.ok && receipt.outcome, "created");
  const saved = ok(receipt);
  assert.match(saved.id, /^f_[a-z0-9]{10}$/);
  assert.equal(saved.name, "Fit today");
  assert.equal(saved.query, "today & @fit");
  assert.equal(saved.origin.actor, "codex");
  assert.equal(saved.version, 1);
  await assertLogged("filter", saved.id, "filter.add", codex);
  const second = ok(await org.filter.add({ name: "Priorities", query: "p1 & no date" }, neel));
  assert.ok(saved.order < second.order);

  assert.deepEqual(await org.filter.get("Fit today"), saved);
  assert.deepEqual(await org.filter.get(saved.id), saved);
  assert.equal(await org.filter.get("Nope"), null);
  assert.deepEqual((await org.filter.list()).map((f) => f.id), [saved.id, second.id]);
  savedFilter = saved;
});

test("filter.run returns matching non-deleted tasks, open only unless the query mentions status", async () => {
  const plan = ok(await org.project.add({ name: "Fitness Plan", labels: ["fit"] }, neel));
  const runs = ok(await org.project.add({ name: "Runs", parent: "fitness-plan" }, neel));
  const parent = task(plan.id, { title: "Buy running shoes", due: { date: today } });
  const list = [
    ["viaProject", parent],
    ["direct", task(inbox.id, { title: "Stretch", due: { date: today, time: "07:00", timezone: "America/Los_Angeles" }, labels: ["fit"] })],
    ["tomorrow", task(inbox.id, { title: "Swim", due: { date: tomorrow }, labels: ["fit"] })],
    ["done", task(inbox.id, { title: "Yoga", due: { date: today }, labels: ["fit"], status: "done", completedAt: now })],
    ["cancelled", task(inbox.id, { title: "Box", due: { date: today }, labels: ["fit"], status: "cancelled" })],
    ["deleted", task(inbox.id, { title: "Deleted run", due: { date: today }, labels: ["fit"], deletedAt: now })],
    ["viaAncestor", task(runs.id, { title: "Tempo run", due: { date: today }, status: "proposed" })],
    ["priority", task(plan.id, { title: "Plan the season", priority: 1, status: "in_progress" })],
    ["subtask", task(plan.id, { title: "Lace them", parentId: parent.id, due: { date: today } })],
    ["overdue", task(plan.id, { title: "Old run", due: { date: "2026-09-01" }, deadline: today, repeat: "FREQ=WEEKLY;BYDAY=MO" })],
    ["unlabeled", task(inbox.id, { title: "Taxes", due: { date: today }, notes: "quarterly" })],
  ] as const;
  await putTasks(...list.map(([, t]) => t));
  fitTasks = Object.fromEntries(list);
  const ids = (tasks: Task[]) => tasks.map((t) => t.id).sort();
  const expect = (...names: (keyof typeof fitTasks)[]) => names.map((n) => fitTasks[n]!.id).sort();

  assert.deepEqual(ids(await org.filter.run("Fit today")), expect("viaProject", "direct", "viaAncestor", "subtask"));
  assert.deepEqual(ids(await org.filter.run(savedFilter!.id)), expect("viaProject", "direct", "viaAncestor", "subtask"), "by id");
  assert.deepEqual(ids(await org.filter.run("today & @fit")), expect("viaProject", "direct", "viaAncestor", "subtask"), "ad hoc");
  assert.deepEqual(ids(await org.filter.run("today & @fit & done")), expect("done"), "a status term lifts the open-only default");
  assert.deepEqual(ids(await org.filter.run("@fit & all")), expect("viaProject", "direct", "tomorrow", "done", "cancelled", "viaAncestor", "priority", "subtask", "overdue"));
  assert.deepEqual(ids(await org.filter.run("cancelled")), expect("cancelled"));
  assert.deepEqual(ids(await org.filter.run("#fitness-plan")), expect("viaProject", "priority", "subtask", "overdue"), "#project is the project alone");
  assert.deepEqual(ids(await org.filter.run("##fitness-plan")), expect("viaProject", "viaAncestor", "priority", "subtask", "overdue"), "##project includes sub-projects");
  assert.deepEqual(ids(await org.filter.run(`#${runs.id}`)), expect("viaAncestor"), "#id works too");
  assert.deepEqual(ids(await org.filter.run("#inbox & today")), expect("direct", "unlabeled"));
  assert.deepEqual(ids(await org.filter.run("p1 & no date")), expect("priority"));
  assert.deepEqual(ids(await org.filter.run("subtask & ##fitness-plan")), expect("subtask"), "scoped: an earlier test left a sub-task in the Inbox");
  assert.deepEqual(ids(await org.filter.run("overdue")), expect("overdue"));
  assert.deepEqual(ids(await org.filter.run("recurring")), expect("overdue"));
  assert.deepEqual(ids(await org.filter.run("deadline: today")), expect("overdue"));
  assert.deepEqual(ids(await org.filter.run("tomorrow | status: proposed")), expect("tomorrow", "viaAncestor"));
  assert.deepEqual(ids(await org.filter.run("search: shoes")), expect("viaProject"));
  assert.deepEqual(ids(await org.filter.run("search: quarterly")), expect("unlabeled"), "notes are searchable");
  assert.deepEqual(ids(await org.filter.run("assigned to: agent:runner")), []);
  assert.deepEqual(ids(await org.filter.run("!(@fit) & today")), expect("unlabeled"));
  await assert.rejects(org.filter.run("no such filter and not a query"), /Unknown filter term|filter/);
});

test("filter.update, reorder, delete and restore", async () => {
  const updated = ok(await org.filter.update("Fit today", { name: "Fit now", query: "today & @fit & !subtask" }, codex));
  assert.equal(updated.name, "Fit now");
  assert.equal(updated.query, "today & @fit & !subtask");
  assert.equal(updated.version, 2);
  const entry = await assertLogged("filter", savedFilter!.id, "filter.update", codex);
  assert.deepEqual(entry.patch.query, { from: "today & @fit", to: "today & @fit & !subtask" });
  assert.equal(await org.filter.get("Fit today"), null);
  assert.deepEqual(
    (await org.filter.run("Fit now")).map((t) => t.id).sort(),
    ["viaProject", "direct", "viaAncestor"].map((n) => fitTasks[n]!.id).sort(),
  );
  const invalid = rejectedOf(await org.filter.update(savedFilter!.id, { query: "wat" }, neel), "invalid query on update");
  assert.match(issuesText(invalid), /query/);
  assert.equal((await getRaw("filter", savedFilter!.id))?.query, "today & @fit & !subtask");
  const same = await org.filter.update(savedFilter!.id, { name: "Fit now" }, neel);
  assert.equal(same.ok && same.outcome, "unchanged");
  rejectedOf(await org.filter.update("Nope", { name: "x" }, neel));

  const all = (await org.filter.list()).map((f) => f.id);
  const reversed = [...all].reverse();
  assert.deepEqual((await org.filter.reorder(reversed, neel)).map((r) => ok(r).order), reversed.map((_, i) => i));
  assert.deepEqual((await org.filter.list()).map((f) => f.id), reversed);
  assert.ok((await org.filter.reorder([savedFilter!.id, "f_0000000000"], neel)).every((r) => !r.ok));

  const deleted = ok(await org.filter.delete("Fit now", codex));
  assert.equal(deleted.deletedAt, now);
  await assertLogged("filter", savedFilter!.id, "filter.delete", codex);
  assert.equal(await org.filter.get("Fit now"), null);
  assert.ok(!(await org.filter.list()).some((f) => f.id === savedFilter!.id));
  rejectedOf(await org.filter.delete("Fit now", neel), "already deleted");

  const restored = ok(await org.filter.restore(savedFilter!.id, neel));
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.query, "today & @fit & !subtask");
  await assertLogged("filter", savedFilter!.id, "filter.restore", neel);
  assert.ok((await org.filter.list()).some((f) => f.id === savedFilter!.id));
  rejectedOf(await org.filter.restore("f_0000000000", neel));
});
