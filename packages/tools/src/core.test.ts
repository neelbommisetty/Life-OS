import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Ctx, Label, Task } from "./contract.ts";
import { applyIn, bump, checkVersion, diff, duplicate, fail, mutate, newId, nowIso, okMutation, rejected } from "./core.ts";
import { createTestDb, fixedClock, type TestDb } from "./db/testing.ts";
import type { Tx } from "./store.ts";

const clock = fixedClock("2026-09-06T12:00:00.789Z");
const now = "2026-09-06T12:00:00Z";
const neel: Ctx = { actor: "neel" };

const label = (id: string, extra: Partial<Label> = {}): Label => ({
  id,
  name: "health",
  order: 0,
  origin: { actor: "neel", at: now, evidence: [] },
  external: [],
  version: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...extra,
});

/** Work that creates a label, counting how often it actually runs. */
function creator(id: string, extra: Partial<Label> = {}) {
  const calls = { n: 0 };
  const work = async (_tx: Tx, _ctx: Ctx, at: string) => {
    calls.n++;
    return okMutation("created", null, label(id, { createdAt: at, updatedAt: at, ...extra }));
  };
  return { calls, work };
}

/** Work that patches an existing label, bumping it. */
const updater = (id: string, patch: Partial<Label>) => async (tx: Tx, ctx: Ctx, at: string) => {
  const before = await tx.get("label", id);
  if (!before) return fail<Label>([`${id}: not found`]);
  const mismatch = checkVersion(before, ctx);
  if (mismatch) return mismatch;
  return okMutation("updated", before, bump({ ...before, ...patch }, at));
};

let db: TestDb;
before(async () => {
  db = await createTestDb();
});
after(() => db.drop());

test("newId, nowIso, bump, and the receipt helpers", () => {
  for (const [kind, prefix] of [["task", "t"], ["project", "p"], ["section", "s"], ["label", "l"], ["filter", "f"]] as const) {
    assert.match(newId(kind), new RegExp(`^${prefix}_[a-z0-9]{10}$`));
  }
  assert.equal(new Set(Array.from({ length: 200 }, () => newId("task"))).size, 200);
  assert.equal(nowIso(clock), now, "milliseconds are stripped");
  assert.deepEqual(bump({ version: 3, updatedAt: "x", name: "a" }, now), { version: 4, updatedAt: now, name: "a" });

  assert.deepEqual(rejected(["bad"]), { ok: false, outcome: "rejected", issues: ["bad"] });
  const needs = { field: "subtasks", options: ["complete", "leave"], message: "Open sub-tasks" };
  assert.deepEqual(rejected(["q"], { id: "t_1", needs }), { ok: false, outcome: "rejected", issues: ["q"], id: "t_1", needs });
  assert.deepEqual(fail<Label>(["nope"]), { before: null, after: null, receipt: { ok: false, outcome: "rejected", issues: ["nope"] } });
  const rec = label("l_helpers001");
  assert.deepEqual(okMutation("created", null, rec), { before: null, after: rec, receipt: { ok: true, outcome: "created", id: rec.id, version: 1, record: rec, issues: [] } });
  assert.deepEqual(duplicate([rec]).receipt, { ok: false, outcome: "duplicate", candidates: [rec], issues: ["Similar open tasks exist; pass allowDuplicate to add anyway"] });
  assert.equal(checkVersion(rec, neel), null);
  assert.equal(checkVersion(rec, { actor: "neel", ifVersion: 1 }), null);
  const mismatch = checkVersion(rec, { actor: "neel", ifVersion: 2 });
  assert.deepEqual(mismatch?.receipt, { ok: false, outcome: "rejected", issues: ["version: expected 2, current is 1"], id: rec.id, record: rec });
});

test("diff ignores version and updatedAt, reads absent as null, and compares structurally", () => {
  const before = label("l_diff000001", { color: "green" });
  const after = bump({ ...before, name: "fitness", color: undefined, external: [{ provider: "todoist", id: "1" }] }, "2026-09-07T00:00:00Z");
  assert.deepEqual(diff(before, after), {
    name: { from: "health", to: "fitness" },
    color: { from: "green", to: null },
    external: { from: [], to: [{ provider: "todoist", id: "1" }] },
  });
  assert.deepEqual(diff(before, { ...before, version: 9, updatedAt: "later" }), {});
  assert.deepEqual(diff(before, { ...before, origin: { actor: "neel", at: now, evidence: [] } }), {}, "equal nested objects are not changes");
  const created = diff(null, label("l_diff000002"));
  assert.deepEqual(Object.keys(created).sort(), ["createdAt", "deletedAt", "external", "id", "name", "order", "origin"]);
  assert.deepEqual(created.name, { from: null, to: "health" });
});

test("mutate rejects an invalid ctx before running work", async () => {
  const { calls, work } = creator("l_badctx0001");
  for (const ctx of [{ actor: "nobody" }, { actor: "neel", extra: true }, null, "neel", { actor: "neel", ifVersion: 0 }]) {
    const receipt = await mutate(db.store, clock, "label", "label.add", ctx, work);
    assert.equal(receipt.ok, false);
    assert.equal(receipt.outcome, "rejected");
    assert.ok(receipt.issues.length > 0, JSON.stringify(ctx));
  }
  assert.equal(calls.n, 0);
  assert.equal(await db.store.read((tx) => tx.get("label", "l_badctx0001")), null);
});

test("mutate creates, logs a full patch, and stores the receipt under the key", async () => {
  const { calls, work } = creator("l_create0001");
  const ctx = { actor: "codex", reason: "Neel asked", evidence: ["msg:123"], key: "create-1" };
  const receipt = await mutate(db.store, clock, "label", "label.add", ctx, work);
  assert.equal(calls.n, 1);
  assert.deepEqual(receipt, { ok: true, outcome: "created", id: "l_create0001", version: 1, record: label("l_create0001"), issues: [] });

  const history = await db.store.read((tx) => tx.history("label", "l_create0001"));
  assert.equal(history.length, 1);
  const { seq, ...logged } = history[0]!;
  assert.equal(typeof seq, "number");
  assert.deepEqual(logged, {
    at: now,
    actor: "codex",
    op: "label.add",
    recordKind: "label",
    recordId: "l_create0001",
    patch: diff(null, label("l_create0001")),
    reason: "Neel asked",
    evidence: ["msg:123"],
    key: "create-1",
  });
  assert.deepEqual(await db.store.read((tx) => tx.getReceipt("create-1")), receipt);
});

test("a repeated key returns the stored receipt without re-running work", async () => {
  const { calls, work } = creator("l_idem000001");
  const ctx = { actor: "neel", key: "idem-1" };
  const first = await mutate(db.store, clock, "label", "label.add", ctx, work);
  const again = await mutate(db.store, clock, "label", "label.add", ctx, work);
  assert.equal(calls.n, 1);
  assert.deepEqual(again, first);
  assert.equal((await db.store.read((tx) => tx.history("label", "l_idem000001"))).length, 1, "applied once");

  // A different key for the same work runs it again (the caller asked for a second thing).
  const other = await mutate(db.store, clock, "label", "label.add", { actor: "neel", key: "idem-2" }, work);
  assert.equal(calls.n, 2);
  assert.equal(other.ok, true);
});

test("an update logs only the fields that changed, never version or updatedAt", async () => {
  await mutate(db.store, clock, "label", "label.add", neel, creator("l_update0001").work);
  const later = fixedClock("2026-09-06T13:00:00Z");
  const receipt = await mutate(db.store, later, "label", "label.update", { actor: "neel", reason: "color it" }, updater("l_update0001", { color: "green" }));
  assert.equal(receipt.ok, true);
  if (!receipt.ok) return;
  assert.equal(receipt.outcome, "updated");
  assert.equal(receipt.version, 2);
  assert.equal(receipt.record.updatedAt, "2026-09-06T13:00:00Z");
  assert.equal(receipt.record.createdAt, now);

  const history = await db.store.read((tx) => tx.history("label", "l_update0001"));
  assert.equal(history.length, 2);
  assert.deepEqual(history[1]!.patch, { color: { from: null, to: "green" } });
  assert.equal(history[1]!.at, "2026-09-06T13:00:00Z");
  assert.equal(history[1]!.reason, "color it");
  assert.deepEqual(await db.store.read((tx) => tx.get("label", "l_update0001")), receipt.record);
});

test("unchanged persists nothing, logs nothing, and stores no receipt", async () => {
  await mutate(db.store, clock, "label", "label.add", neel, creator("l_same000001").work);
  const stored = await db.store.read((tx) => tx.get("label", "l_same000001"));
  let runs = 0;
  const noop = async (tx: Tx) => {
    runs++;
    const before = (await tx.get("label", "l_same000001"))!;
    return okMutation("unchanged", before, before);
  };
  const receipt = await mutate(db.store, fixedClock("2026-09-06T14:00:00Z"), "label", "label.update", { actor: "neel", key: "same-1" }, noop);
  assert.deepEqual(receipt, { ok: true, outcome: "unchanged", id: "l_same000001", version: 1, record: stored, issues: [] });
  assert.deepEqual(await db.store.read((tx) => tx.get("label", "l_same000001")), stored);
  assert.equal((await db.store.read((tx) => tx.history("label", "l_same000001"))).length, 1);
  assert.equal(await db.store.read((tx) => tx.getReceipt("same-1")), null);
  await mutate(db.store, clock, "label", "label.update", { actor: "neel", key: "same-1" }, noop);
  assert.equal(runs, 2, "with nothing stored, the key does not short-circuit");
});

test("a record that fails its schema is rejected and nothing is written", async () => {
  const { work } = creator("l_invalid0001", { name: "Not A Slug" });
  const receipt = await mutate(db.store, clock, "label", "label.add", { actor: "neel", key: "invalid-1" }, work);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.outcome, "rejected");
  assert.match(receipt.issues.join("\n"), /^name: /m);
  if (receipt.outcome === "rejected") assert.equal(receipt.id, "l_invalid0001");
  assert.equal(await db.store.read((tx) => tx.get("label", "l_invalid0001")), null);
  assert.deepEqual(await db.store.read((tx) => tx.history("label", "l_invalid0001")), []);
  assert.equal(await db.store.read((tx) => tx.getReceipt("invalid-1")), null, "rejected receipts are never stored");

  // A rejection from work itself is passed through and not stored either.
  const refused = await mutate(db.store, clock, "label", "label.update", { actor: "neel", key: "refused-1" }, updater("l_nothere001", {}));
  assert.deepEqual(refused, { ok: false, outcome: "rejected", issues: ["l_nothere001: not found"] });
  assert.equal(await db.store.read((tx) => tx.getReceipt("refused-1")), null);
});

test("the persisted record is the schema's normalized form", async () => {
  const messy: Task = {
    id: "t_normal0001",
    title: "  Book the dentist  ",
    notes: "",
    projectId: "p_abcdefghij",
    order: 0,
    status: "accepted",
    executor: "neel",
    due: { date: "2026-10-21" },
    deadline: null,
    labels: [],
    comments: [],
    occurrences: [],
    origin: { actor: "neel", at: now, evidence: [] },
    external: [],
    completedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const receipt = await mutate(db.store, clock, "task", "task.add", neel, async () => okMutation("created", null, messy));
  assert.equal(receipt.ok, true);
  if (!receipt.ok) return;
  assert.equal(receipt.record.title, "Book the dentist");
  assert.equal((await db.store.read((tx) => tx.get("task", "t_normal0001")))?.title, "Book the dentist");
  const [entry] = await db.store.read((tx) => tx.history("task", "t_normal0001"));
  assert.deepEqual(entry!.patch.title, { from: null, to: "Book the dentist" });
});

test("applyIn works inside an open transaction, honors ifVersion, and a throw rolls the batch back", async () => {
  await mutate(db.store, clock, "label", "label.add", neel, creator("l_batch00001").work);
  const receipts = await db.store.transaction(async (tx) => [
    await applyIn(tx, clock, "label", "label.update", { actor: "neel", ifVersion: 1 }, updater("l_batch00001", { color: "red" })),
    await applyIn(tx, clock, "label", "label.update", { actor: "neel", ifVersion: 1 }, updater("l_batch00001", { color: "blue" })),
    await applyIn(tx, clock, "label", "label.update", { actor: "nobody" } as Ctx, updater("l_batch00001", { color: "blue" })),
  ]);
  assert.equal(receipts[0]!.ok, true);
  assert.equal(receipts[1]!.ok, false);
  assert.match(receipts[1]!.issues[0]!, /version: expected 1, current is 2/);
  if (receipts[1]!.outcome === "rejected") assert.equal(receipts[1]!.record?.color, "red");
  assert.equal(receipts[2]!.ok, false);
  assert.match(receipts[2]!.issues[0]!, /actor/);
  assert.equal((await db.store.read((tx) => tx.get("label", "l_batch00001")))?.color, "red");

  await assert.rejects(
    db.store.transaction(async (tx) => {
      await applyIn(tx, clock, "label", "label.update", neel, updater("l_batch00001", { color: "purple" }));
      throw new Error("atomic: abort");
    }),
    /atomic/,
  );
  assert.equal((await db.store.read((tx) => tx.get("label", "l_batch00001")))?.color, "red");
  assert.equal((await db.store.read((tx) => tx.history("label", "l_batch00001"))).length, 2);
});
