import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Ctx, Project, Receipt, Task } from "./contract.ts";
import { ITEM_KEY_SEPARATOR } from "./core.ts";
import { createTestDb, fixedClock, type TestDb } from "./db/testing.ts";
import {
  createOrganize,
  effectiveLabels,
  ensureInbox,
  ensureLabels,
  filterSubject,
  indexProjects,
  projectDescendants,
  projectPath,
  resolveProject,
  resolveSection,
  slugify,
  sortTasks,
  type Organize,
} from "./organize.ts";

const clock = fixedClock("2026-09-06T12:00:00Z");
const now = "2026-09-06T12:00:00Z";
const neel: Ctx = { actor: "neel" };
const origin = { actor: "neel", at: now, evidence: [] };

const proj = (id: string, slug: string, parentId: string | null, labels: string[] = []): Project => ({
  id,
  name: slug,
  slug,
  parentId,
  layout: "list",
  order: 0,
  labels,
  archived: false,
  system: false,
  origin,
  external: [],
  version: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
});

const task = (id: string, projectId: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
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

/** Assert a receipt is ok and hand back its record. */
function okRecord<T>(receipt: Receipt<T>, label = "receipt"): T {
  assert.equal(receipt.ok, true, `${label}: ${JSON.stringify(receipt)}`);
  if (!receipt.ok) throw new Error("unreachable");
  return receipt.record;
}

function rejectedWith<T>(receipt: Receipt<T>, pattern: RegExp): Extract<Receipt<T>, { outcome: "rejected" }> {
  assert.equal(receipt.ok, false, JSON.stringify(receipt));
  assert.equal(receipt.outcome, "rejected");
  assert.match(receipt.issues.join("\n"), pattern);
  return receipt as Extract<Receipt<T>, { outcome: "rejected" }>;
}

let db: TestDb;
let org: Organize;
before(async () => {
  db = await createTestDb();
  org = createOrganize(db.store, clock);
});
after(() => db.drop());

const putTasks = (...tasks: Task[]) =>
  db.store.transaction(async (tx) => {
    for (const t of tasks) await tx.put("task", t);
  });
const getTask = (id: string) => db.store.read((tx) => tx.get("task", id));
const history = (kind: "task" | "project" | "section" | "label" | "filter", id: string) => db.store.read((tx) => tx.history(kind, id));

// ------------------------------------------------------------------ pure helpers

test("slugify, projectPath, projectDescendants, effectiveLabels, filterSubject, sortTasks", () => {
  assert.equal(slugify("Health & Fitness"), "health-fitness");
  assert.equal(slugify("  Café  Déjà Vu! "), "cafe-deja-vu");
  assert.equal(slugify("!!!"), "");
  assert.equal(slugify("a".repeat(80)).length, 64);

  const root = proj("p_root000001", "health", null, ["health"]);
  const child = proj("p_child00001", "dental", root.id, ["dental"]);
  const grandchild = proj("p_grand00001", "cleanings", child.id);
  const other = proj("p_other00001", "work", null, ["work"]);
  const all = [other, grandchild, child, root];
  const index = indexProjects(all);

  assert.equal(projectPath(root, index), "health");
  assert.equal(projectPath(grandchild, index), "health/dental/cleanings");
  assert.equal(projectPath(grandchild, { [child.id]: child }), "dental/cleanings", "a missing ancestor ends the path");
  assert.deepEqual(projectDescendants(root.id, all).map((p) => p.id), [child.id, grandchild.id]);
  assert.deepEqual(projectDescendants(other.id, all), []);

  const t = task("t_helpers001", grandchild.id, { labels: ["urgent", "health"], parentId: "t_helpers000", priority: 2, due: { date: "2026-09-07" }, comments: [{ actor: "codex", at: now, text: "Ping the Clinic", attachments: [] }] });
  assert.deepEqual(effectiveLabels(t, index), ["urgent", "health", "dental"]);
  assert.deepEqual(effectiveLabels(t, {}), ["urgent", "health"], "an unknown project contributes nothing");
  const subject = filterSubject(t, index);
  assert.deepEqual(subject, {
    status: "accepted",
    dueDate: "2026-09-07",
    deadline: null,
    priority: 2,
    executor: "neel",
    hasParent: true,
    recurring: false,
    labels: ["urgent", "health", "dental"],
    projectPaths: ["health", "health/dental", "health/dental/cleanings"],
    projectPath: "health/dental/cleanings",
    projectIds: [root.id, child.id, grandchild.id],
    searchable: "task t_helpers001\n\nping the clinic",
  });

  const sorted = sortTasks([
    task("t_sort000004", root.id, { order: 1 }),
    task("t_sort000003", root.id, { due: { date: "2026-09-08" }, priority: 1 }),
    task("t_sort000002", root.id, { due: { date: "2026-09-07" } }),
    task("t_sort000001", root.id, { due: { date: "2026-09-07", time: "09:00", timezone: "UTC" }, priority: 4 }),
    task("t_sort000000", root.id, { order: 0 }),
  ]);
  assert.deepEqual(
    sorted.map((x) => x.id),
    ["t_sort000001", "t_sort000002", "t_sort000003", "t_sort000000", "t_sort000004"],
  );
});

// ------------------------------------------------------------------ the Inbox

test("ensureInbox creates the Inbox once, as neel, and get('inbox') finds it", async () => {
  const first = await db.store.transaction((tx) => ensureInbox(tx, clock));
  const again = await db.store.transaction((tx) => ensureInbox(tx, clock));
  assert.equal(again.id, first.id);
  assert.match(first.id, /^p_[a-z0-9]{10}$/);
  assert.equal(first.name, "Inbox");
  assert.equal(first.slug, "inbox");
  assert.equal(first.system, true);
  assert.equal(first.parentId, null);
  assert.equal(first.origin.actor, "neel");
  const entries = await history("project", first.id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.op, "project.add");
  assert.equal(entries[0]!.actor, "neel");
  assert.deepEqual(await org.project.get("inbox"), first);
  assert.deepEqual(await org.project.get("INBOX"), first);
  assert.deepEqual(await db.store.read((tx) => resolveProject(tx, "inbox")), first);
});

// ------------------------------------------------------------------ projects

test("project.add derives the slug, orders last among siblings, registers labels, and honors the key", async () => {
  const receipt = await org.project.add({ name: "Health & Fitness", labels: ["health", "health"], color: "green" }, { actor: "codex", reason: "areas", key: "proj-add-1" });
  const health = okRecord(receipt);
  assert.equal(receipt.outcome, "created");
  assert.equal(health.slug, "health-fitness");
  assert.equal(health.parentId, null);
  assert.equal(health.order, 1, "the Inbox holds order 0");
  assert.equal(health.layout, "list");
  assert.equal(health.color, "green");
  assert.deepEqual(health.labels, ["health"]);
  assert.equal(health.system, false);
  assert.deepEqual(health.origin, { actor: "codex", at: now, reason: "areas", evidence: [] });
  assert.deepEqual(await org.project.add({ name: "ignored" }, { actor: "neel", key: "proj-add-1" }), receipt, "the key returns the stored receipt");

  const label = await org.label.get("health");
  assert.equal(label?.origin.actor, "codex", "the label was created with the same ctx");
  assert.equal((await history("label", label!.id))[0]!.key, null, "cascaded creations carry no key");

  const dental = okRecord(await org.project.add({ name: "Dental", parent: "health-fitness", layout: "board" }, neel));
  assert.equal(dental.parentId, health.id);
  assert.equal(dental.slug, "dental");
  assert.equal(dental.order, 0);
  assert.equal(dental.layout, "board");
  assert.deepEqual(await org.project.get("health-fitness/dental"), dental);
  assert.deepEqual(await org.project.get("Health-Fitness/Dental"), dental, "paths are case-insensitive");
  assert.deepEqual(await org.project.get(dental.id), dental);
  assert.equal(await org.project.get("dental"), null, "a slug path resolves from the roots");
  assert.equal(await org.project.get("nope/dental"), null);

  const sibling = okRecord(await org.project.add({ name: "Sleep", parent: health.id }, neel));
  assert.equal(sibling.order, 1);
  const patch = (await history("project", health.id))[0]!.patch;
  assert.deepEqual(patch.slug, { from: null, to: "health-fitness" });
});

test("project.add rejections: sibling slug clash, unknown parent, Inbox as parent, id-like slug, empty slug, invalid input", async () => {
  okRecord(await org.project.add({ name: "Clash" }, neel));
  rejectedWith(await org.project.add({ name: "clash" }, neel), /slug: "clash" is already used by a sibling/);
  const other = okRecord(await org.project.add({ name: "Elsewhere" }, neel));
  okRecord(await org.project.add({ name: "Clash", parent: other.id }, neel), "the same slug under another parent is fine");
  rejectedWith(await org.project.add({ name: "Orphan", parent: "nowhere" }, neel), /parent: no project "nowhere"/);
  rejectedWith(await org.project.add({ name: "Nested", parent: "inbox" }, neel), /Inbox cannot have sub-projects/);
  rejectedWith(await org.project.add({ name: "Sneaky", slug: "p_abcdefghij" }, neel), /looks like an id/);
  rejectedWith(await org.project.add({ name: "!!!" }, neel), /cannot derive a slug/);
  rejectedWith(await org.project.add({ name: "   " }, neel), /^name: /m);
  rejectedWith(await org.project.add({ name: "Bad slug", slug: "Not Valid" }, neel), /^slug: /m);
  rejectedWith(await org.project.add({ name: "Nobody" }, { actor: "nobody" } as Ctx), /actor/);
});

test("project.tree nests projects with their sections and prunes archived ones unless asked", async () => {
  const root = okRecord(await org.project.add({ name: "Tree Root" }, neel));
  const kid = okRecord(await org.project.add({ name: "Tree Kid", parent: root.id }, neel));
  const archived = okRecord(await org.project.add({ name: "Tree Archived", parent: root.id }, neel));
  okRecord(await org.project.archive(archived.id, neel));
  const s2 = okRecord(await org.section.add({ project: root.id, name: "Later" }, neel));
  const s1 = okRecord(await org.section.add({ project: root.id, name: "Now" }, neel));
  for (const r of await org.section.reorder([s1.id, s2.id], neel)) okRecord(r);
  const archivedSection = okRecord(await org.section.add({ project: root.id, name: "Old" }, neel));
  okRecord(await org.section.archive(archivedSection.id, neel));

  const tree = await org.project.tree();
  assert.equal(tree[0]!.project.system, true, "the Inbox comes first");
  const node = tree.find((n) => n.project.id === root.id)!;
  assert.deepEqual(node.sections.map((s) => s.name), ["Now", "Later"]);
  assert.deepEqual(node.children.map((c) => c.project.id), [kid.id]);
  assert.deepEqual(node.children[0]!.children, []);

  const full = await org.project.tree({ includeArchived: true });
  const fullNode = full.find((n) => n.project.id === root.id)!;
  assert.deepEqual(fullNode.sections.map((s) => s.name), ["Now", "Later", "Old"]);
  assert.deepEqual(fullNode.children.map((c) => c.project.id).sort(), [kid.id, archived.id].sort());
});

test("project.update changes fields, reports unchanged, honors ifVersion, and protects the Inbox", async () => {
  const p = okRecord(await org.project.add({ name: "Updatable", color: "red" }, neel));
  const later = fixedClock("2026-09-06T13:00:00Z");
  const orgLater = createOrganize(db.store, later);
  const updated = okRecord(await orgLater.project.update(p.id, { name: "Updated", slug: "updated", color: null, layout: "board", labels: ["work", "work"] }, { actor: "neel", reason: "tidy" }));
  assert.equal(updated.name, "Updated");
  assert.equal(updated.slug, "updated");
  assert.equal(updated.color, undefined);
  assert.equal(updated.layout, "board");
  assert.deepEqual(updated.labels, ["work"]);
  assert.equal(updated.version, 2);
  assert.equal(updated.updatedAt, "2026-09-06T13:00:00Z");
  assert.ok(await org.label.get("work"), "labels named on a project are registered");
  const entries = await history("project", p.id);
  assert.deepEqual(entries[1]!.patch, {
    name: { from: "Updatable", to: "Updated" },
    slug: { from: "updatable", to: "updated" },
    color: { from: "red", to: null },
    layout: { from: "list", to: "board" },
    labels: { from: [], to: ["work"] },
  });

  const same = await org.project.update("updated", { name: "Updated" }, neel);
  assert.equal(same.ok && same.outcome, "unchanged");
  assert.equal((await history("project", p.id)).length, 2, "unchanged logs nothing");

  const stale = rejectedWith(await org.project.update(p.id, { name: "Stale" }, { actor: "neel", ifVersion: 1 }), /version: expected 1, current is 2/);
  assert.equal(stale.record?.name, "Updated");
  okRecord(await org.project.update(p.id, { color: "blue" }, { actor: "neel", ifVersion: 2 }));

  rejectedWith(await org.project.update("inbox", { name: "Not Inbox" }, neel), /Inbox cannot be renamed/);
  rejectedWith(await org.project.update("inbox", { slug: "in" }, neel), /Inbox keeps its slug/);
  okRecord(await org.project.update("inbox", { color: "grey" }, neel), "the Inbox can take a color");
  okRecord(await org.project.add({ name: "Taken" }, neel));
  rejectedWith(await org.project.update(p.id, { slug: "taken" }, neel), /already used by a sibling/);
  rejectedWith(await org.project.update("p_nothere001", { name: "x" }, neel), /no project "p_nothere001"/);
  rejectedWith(await org.project.update(p.id, { layout: "grid" } as never, neel), /^layout: /m);
});

test("project.move re-parents without cycles, keeps the Inbox put, and refuses slug clashes", async () => {
  const a = okRecord(await org.project.add({ name: "Move A" }, neel));
  const b = okRecord(await org.project.add({ name: "Move B", parent: a.id }, neel));
  const c = okRecord(await org.project.add({ name: "Move C", parent: b.id }, neel));
  const d = okRecord(await org.project.add({ name: "Move D" }, neel));

  rejectedWith(await org.project.move(a.id, c.id, neel), /cannot move under its own sub-project/);
  rejectedWith(await org.project.move(a.id, a.id, neel), /cannot be its own parent/);
  rejectedWith(await org.project.move("inbox", d.id, neel), /Inbox cannot be moved/);
  rejectedWith(await org.project.move(a.id, "inbox", neel), /Inbox cannot have sub-projects/);
  rejectedWith(await org.project.move(a.id, "p_nothere001", neel), /parent: no project/);
  const same = await org.project.move(b.id, a.id, neel);
  assert.equal(same.ok && same.outcome, "unchanged");

  const moved = okRecord(await org.project.move(`move-a/move-b`, d.id, neel));
  assert.equal(moved.parentId, d.id);
  assert.equal(moved.order, 0);
  assert.deepEqual(await org.project.get("move-d/move-b/move-c"), c, "the subtree moves with it");
  const toRoot = okRecord(await org.project.move(c.id, null, neel));
  assert.equal(toRoot.parentId, null);
  assert.ok(toRoot.order > d.order, "last among the roots");

  okRecord(await org.project.add({ name: "Move B" }, neel));
  rejectedWith(await org.project.move(b.id, null, neel), /already used by a project under the new parent/);
});

test("project.reorder assigns 0..n-1 to siblings and rejects mixed scopes, unknown ids, and ifVersion", async () => {
  const parent = okRecord(await org.project.add({ name: "Reorder Parent" }, neel));
  const x = okRecord(await org.project.add({ name: "RX", parent: parent.id }, neel));
  const y = okRecord(await org.project.add({ name: "RY", parent: parent.id }, neel));
  const z = okRecord(await org.project.add({ name: "RZ", parent: parent.id }, neel));
  const receipts = await org.project.reorder([z.id, x.id, y.id], { actor: "neel", key: "reorder-1" });
  assert.deepEqual(receipts.map((r) => r.ok && [r.outcome, r.record.order]), [["updated", 0], ["updated", 1], ["updated", 2]]);
  assert.deepEqual((await org.project.tree()).find((n) => n.project.id === parent.id)!.children.map((n) => n.project.id), [z.id, x.id, y.id]);
  assert.equal((await history("project", z.id))[1]!.key, `reorder-1${ITEM_KEY_SEPARATOR}0`, "per-item keys derive from the caller's");
  const again = await org.project.reorder([z.id, x.id, y.id], { actor: "neel", key: "reorder-1" });
  assert.deepEqual(again, receipts, "a retry returns the stored receipts");
  const noop = await org.project.reorder([z.id, x.id, y.id], neel);
  assert.deepEqual(noop.map((r) => r.ok && r.outcome), ["unchanged", "unchanged", "unchanged"]);

  const mixed = await org.project.reorder([x.id, parent.id], neel);
  assert.equal(mixed.length, 2);
  for (const r of mixed) rejectedWith(r, /must share the same parent/);
  for (const r of await org.project.reorder([x.id, "p_nothere001"], neel)) rejectedWith(r, /p_nothere001: no project/);
  for (const r of await org.project.reorder([x.id, x.id], neel)) rejectedWith(r, /duplicates/);
  for (const r of await org.project.reorder([x.id], { actor: "neel", ifVersion: 1 })) rejectedWith(r, /ifVersion: not supported/);
  assert.deepEqual(await org.project.reorder([], neel), []);
});

test("project.archive and unarchive flip the flag, never on the Inbox", async () => {
  const p = okRecord(await org.project.add({ name: "Archivable" }, neel));
  assert.equal(okRecord(await org.project.archive("archivable", neel)).archived, true);
  const twice = await org.project.archive(p.id, neel);
  assert.equal(twice.ok && twice.outcome, "unchanged");
  assert.equal(okRecord(await org.project.unarchive(p.id, neel)).archived, false);
  rejectedWith(await org.project.archive("inbox", neel), /Inbox cannot be archived/);
  rejectedWith(await org.project.archive("p_nothere001", neel), /no project/);
});

test("project.delete: empty projects go straight to the trash with their sections; contents need a choice", async () => {
  const p = okRecord(await org.project.add({ name: "Empty Delete" }, neel));
  const s = okRecord(await org.section.add({ project: p.id, name: "Only section" }, neel));
  const deleted = okRecord(await org.project.delete("empty-delete", { actor: "neel", reason: "done with it" }));
  assert.equal(deleted.deletedAt, now);
  assert.equal((await org.section.get(s.id))?.deletedAt, now);
  assert.equal((await history("section", s.id))[1]!.op, "project.delete");
  assert.equal(await org.project.get("empty-delete"), null, "a deleted project is not resolvable by path");
  assert.equal((await org.project.get(p.id))?.deletedAt, now, "but is by id");
  rejectedWith(await org.project.delete(p.id, neel), /is deleted; restore it first/);
  rejectedWith(await org.project.delete("inbox", neel), /Inbox cannot be deleted/);

  const parent = okRecord(await org.project.add({ name: "Full Delete" }, neel));
  const child = okRecord(await org.project.add({ name: "Full Child", parent: parent.id }, neel));
  await putTasks(task("t_fulldel001", parent.id), task("t_fulldel002", child.id));
  const needs = rejectedWith(await org.project.delete(parent.id, neel), /has 2 tasks and 1 sub-project/);
  assert.deepEqual(needs.needs?.field, "contents");
  assert.deepEqual(needs.needs?.options, ["delete", "inbox"]);
  assert.equal(needs.id, parent.id);
  assert.equal(needs.record?.id, parent.id);
  assert.equal((await org.project.get(parent.id))?.deletedAt, null, "nothing changed");
  rejectedWith(await org.project.delete(parent.id, neel, { contents: "purge" as never }), /contents: expected "delete" or "inbox"/);
});

test("project.delete with contents 'delete' soft-deletes the subtree, each with its own log entry", async () => {
  const parent = okRecord(await org.project.add({ name: "Cascade Delete" }, neel));
  const child = okRecord(await org.project.add({ name: "Cascade Child", parent: parent.id }, neel));
  const grandchild = okRecord(await org.project.add({ name: "Cascade Grandchild", parent: child.id }, neel));
  const section = okRecord(await org.section.add({ project: child.id, name: "Cascade Section" }, neel));
  await putTasks(
    task("t_cascade001", parent.id),
    task("t_cascade002", child.id, { sectionId: section.id }),
    task("t_cascade003", grandchild.id, { status: "done" }),
    task("t_cascade004", grandchild.id, { deletedAt: "2026-09-01T00:00:00Z" }),
  );
  const receipt = await org.project.delete(parent.id, { actor: "codex", reason: "cleanup", key: "cascade-delete" }, { contents: "delete" });
  assert.equal(okRecord(receipt).deletedAt, now);
  for (const id of [child.id, grandchild.id]) assert.equal((await org.project.get(id))?.deletedAt, now, id);
  assert.equal((await org.section.get(section.id))?.deletedAt, now);
  for (const id of ["t_cascade001", "t_cascade002", "t_cascade003"]) {
    const t = await getTask(id);
    assert.equal(t?.deletedAt, now, id);
    assert.equal(t?.version, 2);
    const entries = await history("task", id);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0]!.patch, { deletedAt: { from: null, to: now } });
    assert.equal(entries[0]!.op, "project.delete");
    assert.equal(entries[0]!.actor, "codex");
    assert.equal(entries[0]!.reason, "cleanup");
    assert.equal(entries[0]!.key, null, "cascaded entries carry no key");
  }
  assert.equal((await getTask("t_cascade004"))?.version, 1, "already deleted tasks are untouched");
  assert.equal((await history("project", parent.id))[1]!.key, "cascade-delete");
  assert.deepEqual(await org.project.delete(parent.id, { actor: "codex", key: "cascade-delete" }, { contents: "delete" }), receipt, "retry with the key");
});

test("project.delete with contents 'inbox' moves every task to the Inbox with no section and deletes the empty shells", async () => {
  const inbox = (await org.project.get("inbox"))!;
  await putTasks(task("t_inboxhas01", inbox.id, { order: 4 }));
  const parent = okRecord(await org.project.add({ name: "To Inbox" }, neel));
  const child = okRecord(await org.project.add({ name: "To Inbox Child", parent: parent.id }, neel));
  const section = okRecord(await org.section.add({ project: parent.id, name: "Sectioned" }, neel));
  await putTasks(
    task("t_toinbox001", parent.id, { sectionId: section.id, order: 1 }),
    task("t_toinbox002", parent.id, { sectionId: section.id, order: 0 }),
    task("t_toinbox003", child.id, { parentId: "t_toinbox002" }),
  );
  okRecord(await org.project.delete(parent.id, neel, { contents: "inbox" }));
  const moved = await Promise.all(["t_toinbox001", "t_toinbox002", "t_toinbox003"].map(getTask));
  for (const t of moved) {
    assert.equal(t?.projectId, inbox.id);
    assert.equal(t?.sectionId, undefined);
    assert.equal(t?.deletedAt, null);
  }
  assert.equal(moved[1]?.order, 5, "after the Inbox's existing tasks, in the old order");
  assert.equal(moved[0]?.order, 6);
  assert.equal(moved[2]?.parentId, "t_toinbox002", "sub-tasks keep their parent");
  assert.equal(moved[2]?.order, 0, "orders are per parent scope");
  assert.deepEqual((await history("task", "t_toinbox001"))[0]!.patch, {
    projectId: { from: parent.id, to: inbox.id },
    sectionId: { from: section.id, to: null },
    order: { from: 1, to: 6 },
  });
  assert.equal((await org.project.get(child.id))?.deletedAt, now);
  assert.equal((await org.section.get(section.id))?.deletedAt, now);
  assert.equal((await org.project.get(parent.id))?.deletedAt, now);
});

test("project.restore brings a project back, to the top level when its parent is gone, with a free slug", async () => {
  const parent = okRecord(await org.project.add({ name: "Restore Parent" }, neel));
  const child = okRecord(await org.project.add({ name: "Restore Child", parent: parent.id }, neel));
  okRecord(await org.project.delete(parent.id, neel, { contents: "delete" }));
  const notDeleted = await org.project.restore((await org.project.get("inbox"))!.id, neel);
  assert.equal(notDeleted.ok && notDeleted.outcome, "unchanged");

  okRecord(await org.project.add({ name: "Restore Child" }, neel), "a root project took the slug meanwhile");
  const restoredChild = okRecord(await org.project.restore(child.id, neel));
  assert.equal(restoredChild.deletedAt, null);
  assert.equal(restoredChild.parentId, null, "its parent is still deleted");
  assert.equal(restoredChild.slug, "restore-child-2");
  assert.equal(restoredChild.version, 3);

  const restoredParent = okRecord(await org.project.restore(parent.id, neel));
  assert.equal(restoredParent.deletedAt, null);
  assert.equal(restoredParent.slug, "restore-parent");
  assert.equal(restoredParent.order, parent.order, "the order is kept when the parent is unchanged");
  rejectedWith(await org.project.restore("p_nothere001", neel), /no project/);
  rejectedWith(await org.project.restore("not-an-id", neel), /no project "not-an-id"/);

  const entries = await org.project.history(parent.id);
  assert.deepEqual(entries.map((e) => e.op), ["project.add", "project.delete", "project.restore"]);
});

// ------------------------------------------------------------------ sections

test("section.add, get, list, update, reorder, archive, and resolveSection", async () => {
  const p = okRecord(await org.project.add({ name: "Sectioned Project" }, neel));
  const a = okRecord(await org.section.add({ project: "sectioned-project", name: "Alpha" }, { actor: "codex" }));
  const b = okRecord(await org.section.add({ project: p.id, name: " Beta " }, neel));
  assert.equal(a.projectId, p.id);
  assert.equal(a.order, 0);
  assert.equal(b.order, 1);
  assert.equal(b.name, "Beta");
  assert.equal(a.origin.actor, "codex");
  rejectedWith(await org.section.add({ project: p.id, name: "alpha" }, neel), /already exists in that project/);
  rejectedWith(await org.section.add({ project: "nowhere", name: "x" }, neel), /no project "nowhere"/);
  rejectedWith(await org.section.add({ project: p.id, name: "" }, neel), /^name: /m);

  assert.deepEqual(await org.section.get(a.id), a);
  assert.equal(await org.section.get("s_nothere001"), null);
  assert.equal(await org.section.get("junk"), null);
  assert.deepEqual((await org.section.list(p.id)).map((s) => s.id), [a.id, b.id]);
  await assert.rejects(org.section.list("nowhere"), /no project "nowhere"/);

  await db.store.read(async (tx) => {
    assert.deepEqual(await resolveSection(tx, p.id, a.id), a);
    assert.deepEqual(await resolveSection(tx, p.id, "beta"), b, "names match case-insensitively");
    assert.deepEqual(await resolveSection(tx, p.id, "Beta"), b);
    assert.equal(await resolveSection(tx, "p_otherproj1", a.id), null, "an id must belong to the project");
    assert.equal(await resolveSection(tx, p.id, "gamma"), null);
  });

  const renamed = okRecord(await org.section.update(a.id, { name: "Alpha Prime" }, neel));
  assert.equal(renamed.name, "Alpha Prime");
  assert.equal(renamed.version, 2);
  const same = await org.section.update(a.id, { name: "Alpha Prime" }, neel);
  assert.equal(same.ok && same.outcome, "unchanged");
  rejectedWith(await org.section.update(a.id, { name: "BETA" }, neel), /already exists/);
  rejectedWith(await org.section.update(a.id, { name: "x" }, { actor: "neel", ifVersion: 1 }), /version: expected 1, current is 2/);
  rejectedWith(await org.section.update("s_nothere001", { name: "x" }, neel), /no section/);

  const reordered = await org.section.reorder([b.id, a.id], neel);
  assert.deepEqual(reordered.map((r) => r.ok && r.record.order), [0, 1]);
  assert.deepEqual((await org.section.list(p.id)).map((s) => s.id), [b.id, a.id]);
  const other = okRecord(await org.project.add({ name: "Other Sectioned" }, neel));
  const foreign = okRecord(await org.section.add({ project: other.id, name: "Foreign" }, neel));
  for (const r of await org.section.reorder([a.id, foreign.id], neel)) rejectedWith(r, /must share the same project/);

  assert.equal(okRecord(await org.section.archive(a.id, neel)).archived, true);
  assert.equal(okRecord(await org.section.unarchive(a.id, neel)).archived, false);
  assert.equal((await org.section.list(p.id)).length, 2, "list includes archived sections");
});

test("section.delete needs a choice when it holds tasks, then deletes or unsections them; restore needs a live project", async () => {
  const p = okRecord(await org.project.add({ name: "Section Delete" }, neel));
  const s = okRecord(await org.section.add({ project: p.id, name: "Doomed" }, neel));
  const keep = okRecord(await org.section.add({ project: p.id, name: "Kept" }, neel));
  await putTasks(
    task("t_secdel0001", p.id, { sectionId: s.id, order: 1 }),
    task("t_secdel0002", p.id, { sectionId: s.id, order: 0 }),
    task("t_secdel0003", p.id, { order: 7 }),
    task("t_secdel0004", p.id, { sectionId: keep.id }),
  );
  const needs = rejectedWith(await org.section.delete(s.id, neel), /has 2 tasks/);
  assert.deepEqual(needs.needs, { field: "tasks", options: ["delete", "unsection"], message: needs.issues[0] });
  rejectedWith(await org.section.delete(s.id, neel, { tasks: "move" as never }), /tasks: expected "delete" or "unsection"/);

  okRecord(await org.section.delete(s.id, neel, { tasks: "unsection" }));
  assert.equal((await org.section.get(s.id))?.deletedAt, now);
  const t2 = await getTask("t_secdel0002");
  const t1 = await getTask("t_secdel0001");
  assert.equal(t2?.sectionId, undefined);
  assert.equal(t2?.order, 8, "after the project's unsectioned tasks, keeping the old order");
  assert.equal(t1?.order, 9);
  assert.equal((await history("task", "t_secdel0001"))[0]!.op, "section.delete");
  assert.equal((await getTask("t_secdel0004"))?.version, 1, "tasks in other sections are untouched");

  okRecord(await org.section.delete(keep.id, neel, { tasks: "delete" }));
  assert.equal((await getTask("t_secdel0004"))?.deletedAt, now);

  const empty = okRecord(await org.section.add({ project: p.id, name: "Empty" }, neel));
  okRecord(await org.section.delete(empty.id, neel), "no tasks, no question");
  rejectedWith(await org.section.delete(empty.id, neel), /is deleted; restore it first/);

  okRecord(await org.section.add({ project: p.id, name: "Doomed" }, neel), "the name is free again");
  const restored = okRecord(await org.section.restore(s.id, neel));
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.name, "Doomed 2");
  const alreadyLive = await org.section.restore(s.id, neel);
  assert.equal(alreadyLive.ok && alreadyLive.outcome, "unchanged");

  okRecord(await org.project.delete(p.id, neel, { contents: "delete" }));
  rejectedWith(await org.section.restore(keep.id, neel), /is deleted; restore it first/);
  rejectedWith(await org.section.restore("s_nothere001", neel), /no section/);
});

// ------------------------------------------------------------------ labels

test("label.add, get, list, reorder, and ensureLabels", async () => {
  const fitness = okRecord(await org.label.add({ name: "fitness", color: "orange" }, { actor: "codex", evidence: ["vault:Areas/Health.md"] }));
  assert.equal(fitness.color, "orange");
  assert.deepEqual(fitness.origin, { actor: "codex", at: now, evidence: ["vault:Areas/Health.md"] });
  rejectedWith(await org.label.add({ name: "fitness" }, neel), /label "fitness" already exists/);
  rejectedWith(await org.label.add({ name: "Not A Slug" }, neel), /^name: /m);
  assert.deepEqual(await org.label.get("fitness"), fitness);
  assert.deepEqual(await org.label.get(fitness.id), fitness);
  assert.equal(await org.label.get("nope"), null);

  const finance = okRecord(await org.label.add({ name: "finance" }, neel));
  assert.ok(finance.order > fitness.order);
  const ids = (await org.label.list()).map((l) => l.id);
  assert.ok(ids.indexOf(fitness.id) < ids.indexOf(finance.id));
  const receipts = await org.label.reorder([finance.id, fitness.id], neel);
  assert.deepEqual(receipts.map((r) => r.ok && r.record.order), [0, 1]);
  const listed = (await org.label.list()).map((l) => l.id);
  assert.ok(listed.indexOf(finance.id) < listed.indexOf(fitness.id));

  const ensured = await db.store.transaction((tx) => ensureLabels(tx, clock, { actor: "codex", key: "ignored" }, ["fitness", "garden", "garden"]));
  assert.deepEqual(ensured.issues, []);
  assert.deepEqual(ensured.created.map((l) => l.name), ["garden"]);
  assert.equal((await org.label.get("garden"))?.origin.actor, "codex");
});

test("label.update renames the label on every task and project carrying it, deleted ones included, each logged", async () => {
  const label = okRecord(await org.label.add({ name: "helth" }, neel));
  okRecord(await org.label.add({ name: "wellbeing" }, neel));
  const p = okRecord(await org.project.add({ name: "Labelled Project", labels: ["helth"] }, neel));
  const untouched = okRecord(await org.project.add({ name: "Unlabelled Project", labels: ["wellbeing"] }, neel));
  await putTasks(
    task("t_rename0001", p.id, { labels: ["helth", "urgent"] }),
    task("t_rename0002", p.id, { labels: ["urgent"] }),
    task("t_rename0003", p.id, { labels: ["helth"], deletedAt: "2026-09-01T00:00:00Z" }),
    task("t_rename0004", p.id, { labels: ["helth", "healthy"] }),
  );
  rejectedWith(await org.label.update("helth", { name: "wellbeing" }, neel), /label "wellbeing" already exists/);
  const renamed = okRecord(await org.label.update("helth", { name: "healthy", color: "green" }, { actor: "neel", reason: "typo", key: "rename-1" }));
  assert.equal(renamed.name, "healthy");
  assert.equal(renamed.color, "green");
  assert.equal(renamed.version, 2);
  assert.deepEqual((await getTask("t_rename0001"))?.labels, ["healthy", "urgent"]);
  assert.deepEqual((await getTask("t_rename0003"))?.labels, ["healthy"], "deleted tasks are rewritten too");
  assert.deepEqual((await getTask("t_rename0004"))?.labels, ["healthy"], "a task that already carried the new name is deduplicated");
  assert.equal((await getTask("t_rename0002"))?.version, 1);
  assert.deepEqual((await org.project.get(p.id))?.labels, ["healthy"]);
  assert.equal((await org.project.get(untouched.id))?.version, 1);
  const entry = (await history("task", "t_rename0001"))[0]!;
  assert.deepEqual(entry.patch, { labels: { from: ["helth", "urgent"], to: ["healthy", "urgent"] } });
  assert.equal(entry.op, "label.update");
  assert.equal(entry.reason, "typo");
  assert.equal(entry.key, null);
  assert.equal((await history("project", p.id)).length, 2);
  assert.equal((await history("label", label.id))[1]!.key, "rename-1");
  assert.equal(await org.label.get("helth"), null);
  assert.deepEqual(await org.label.get("healthy"), renamed);

  const same = await org.label.update(label.id, { name: "healthy" }, neel);
  assert.equal(same.ok && same.outcome, "unchanged");
  assert.equal(okRecord(await org.label.update(label.id, { color: null }, neel)).color, undefined);
  rejectedWith(await org.label.update("l_nothere001", { color: "x" }, neel), /no label/);
  rejectedWith(await org.label.update(label.id, { name: "Bad Name" }, neel), /^name: /m);
});

test("label.delete is refused while a non-deleted task or project carries it; restore refuses a taken name", async () => {
  const label = okRecord(await org.label.add({ name: "used" }, neel));
  const p = okRecord(await org.project.add({ name: "Uses Label", labels: ["used"] }, neel));
  await putTasks(task("t_uselabel01", p.id, { labels: ["used"], status: "done" }), task("t_uselabel02", p.id, { labels: ["used"], deletedAt: now }));
  const refused = rejectedWith(await org.label.delete("used", neel), /used by 1 task and 1 project/);
  assert.equal(refused.record?.id, label.id);
  okRecord(await org.project.update(p.id, { labels: [] }, neel));
  rejectedWith(await org.label.delete(label.id, neel), /used by 1 task and 0 projects/);
  await putTasks(task("t_uselabel01", p.id, { labels: [] }));
  const deleted = okRecord(await org.label.delete("used", neel));
  assert.equal(deleted.deletedAt, now);
  assert.equal(await org.label.get("used"), null);
  assert.equal((await org.label.get(label.id))?.deletedAt, now);
  assert.ok(!(await org.label.list()).some((l) => l.id === label.id));
  rejectedWith(await org.label.delete(label.id, neel), /is deleted; restore it first/);

  okRecord(await org.label.add({ name: "used" }, neel), "the name is free again");
  rejectedWith(await org.label.restore(label.id, neel), /label "used" already exists/);
  okRecord(await org.label.delete("used", neel));
  const restored = okRecord(await org.label.restore(label.id, neel));
  assert.equal(restored.deletedAt, null);
  assert.deepEqual(await org.label.get("used"), restored);
  rejectedWith(await org.label.restore("l_nothere001", neel), /no label/);
});

// ------------------------------------------------------------------ filters

test("filter.add, get, list, update, reorder, delete, restore", async () => {
  const f = okRecord(await org.filter.add({ name: "Health today", query: "today & @health" }, neel));
  assert.equal(f.query, "today & @health");
  rejectedWith(await org.filter.add({ name: "health TODAY", query: "today" }, neel), /filter "health TODAY" already exists/);
  rejectedWith(await org.filter.add({ name: "Broken", query: "due: someday" }, neel), /^query: /m);
  assert.deepEqual(await org.filter.get("health today"), f);
  assert.deepEqual(await org.filter.get(f.id), f);
  assert.equal(await org.filter.get("missing"), null);

  const g = okRecord(await org.filter.add({ name: "Overdue", query: "overdue" }, neel));
  assert.deepEqual((await org.filter.list()).map((x) => x.id).filter((id) => [f.id, g.id].includes(id)), [f.id, g.id]);
  await org.filter.reorder([g.id, f.id], neel);
  assert.deepEqual((await org.filter.list()).map((x) => x.id).filter((id) => [f.id, g.id].includes(id)), [g.id, f.id]);

  const updated = okRecord(await org.filter.update(f.id, { name: "Health now", query: "(today | overdue) & @health" }, neel));
  assert.equal(updated.name, "Health now");
  assert.equal(updated.version, 3, "created, reordered, updated");
  rejectedWith(await org.filter.update(f.id, { query: "bogus term" }, neel), /^query: /m);
  rejectedWith(await org.filter.update(f.id, { name: "overdue" }, neel), /already exists/);
  const same = await org.filter.update(f.id, {}, neel);
  assert.equal(same.ok && same.outcome, "unchanged");

  okRecord(await org.filter.delete("health now", neel));
  assert.equal(await org.filter.get("health now"), null);
  rejectedWith(await org.filter.delete(f.id, neel), /is deleted/);
  okRecord(await org.filter.add({ name: "Health now", query: "today" }, neel));
  const restored = okRecord(await org.filter.restore(f.id, neel));
  assert.equal(restored.name, "Health now 2");
  assert.equal(restored.deletedAt, null);
  rejectedWith(await org.filter.restore("f_nothere001", neel), /no filter/);
});

test("filter.run evaluates a saved filter or an ad hoc query over open tasks with effective labels and project paths", async () => {
  okRecord(await org.label.add({ name: "money" }, neel));
  const root = okRecord(await org.project.add({ name: "Run Root", labels: ["money"] }, neel));
  const child = okRecord(await org.project.add({ name: "Run Child", parent: root.id }, neel));
  await putTasks(
    task("t_run0000001", root.id, { due: { date: "2026-09-06" }, priority: 1 }),
    task("t_run0000002", child.id, { due: { date: "2026-09-05" } }),
    task("t_run0000003", child.id, { due: { date: "2026-09-06" }, status: "done" }),
    task("t_run0000004", child.id, { labels: ["rush"], deletedAt: now }),
    task("t_run0000005", root.id, { labels: ["rush"], status: "proposed" }),
  );
  okRecord(await org.filter.add({ name: "Money due", query: "@money & (today | overdue)" }, neel));
  assert.deepEqual((await org.filter.run("money due")).map((t) => t.id), ["t_run0000002", "t_run0000001"]);
  assert.deepEqual((await org.filter.run("##run-root & @money")).map((t) => t.id), ["t_run0000002", "t_run0000001", "t_run0000005"]);
  assert.deepEqual((await org.filter.run("#run-root/run-child")).map((t) => t.id), ["t_run0000002"], "open only by default");
  assert.deepEqual((await org.filter.run("#run-root/run-child & done")).map((t) => t.id), ["t_run0000003"], "a status term lifts the default");
  assert.deepEqual((await org.filter.run(`#${child.id} & all`)).map((t) => t.id), ["t_run0000002", "t_run0000003"], "deleted tasks never appear");
  assert.deepEqual((await org.filter.run("@rush")).map((t) => t.id), ["t_run0000005"]);
  await assert.rejects(org.filter.run("nonsense term"), /neither a saved filter nor a valid query/);
});

test("project.add creates the Inbox only once the input has passed, so a rejection on an empty database writes nothing", async () => {
  const fresh = await createTestDb();
  try {
    const o = createOrganize(fresh.store, clock);
    rejectedWith(await o.project.add({ name: "Kid", parent: "nope/nowhere" }, neel), /parent: no project "nope\/nowhere"/);
    rejectedWith(await o.project.add({ name: "Inbox" }, neel), /slug: "inbox" is already used by a sibling project/);
    assert.deepEqual(await fresh.store.read((tx) => tx.all("project", { includeDeleted: true })), [], "no Inbox row");
    assert.deepEqual(await fresh.store.read((tx) => tx.allLog()), []);
    const health = okRecord(await o.project.add({ name: "Health" }, neel));
    assert.equal(health.order, 1, "the Inbox is created first and holds order 0");
    assert.equal((await fresh.store.read((tx) => tx.all("project"))).length, 2);
  } finally {
    await fresh.drop();
  }
});
