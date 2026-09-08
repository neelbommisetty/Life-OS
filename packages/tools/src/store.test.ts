import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import type { Label, LogEntry, Task } from "./contract.ts";
import { createTestDb, type TestDb } from "./db/testing.ts";
import { withSavepoint, type Tx } from "./store.ts";

const now = "2026-09-06T12:00:00Z";
const origin = { actor: "neel", at: now, evidence: [] };

const label = (id: string, extra: Partial<Label> = {}): Label => ({
  id,
  name: "health",
  order: 0,
  origin,
  external: [],
  version: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...extra,
});

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: "Schedule six-month dental cleaning",
  notes: "",
  projectId: "p_abcdefghij",
  order: 0,
  status: "accepted",
  executor: "neel",
  due: { date: "2026-10-21", time: "09:00", timezone: "America/Los_Angeles" },
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
  ...extra,
});

const entry = (recordId: string, extra: Partial<Omit<LogEntry, "seq">> = {}): Omit<LogEntry, "seq"> => ({
  at: now,
  actor: "neel",
  op: "label.add",
  recordKind: "label",
  recordId,
  patch: { name: { from: null, to: "health" } },
  reason: null,
  evidence: [],
  key: null,
  ...extra,
});

let db: TestDb;
before(async () => {
  db = await createTestDb();
});
after(() => db.drop());

test("put and get round-trip a record exactly, and put upserts by id", async () => {
  const original = task("t_roundtrip01");
  await db.store.transaction((tx) => tx.put("task", original));
  assert.deepEqual(await db.store.read((tx) => tx.get("task", "t_roundtrip01")), original);
  assert.equal(await db.store.read((tx) => tx.get("task", "t_missing0000")), null);

  const changed = { ...original, title: "Book the dentist", version: 2, updatedAt: "2026-09-06T13:00:00Z" };
  await db.store.transaction((tx) => tx.put("task", changed));
  assert.deepEqual(await db.store.read((tx) => tx.get("task", "t_roundtrip01")), changed);
  const columns = await db.pool.query<{ version: number; updated_at: Date; deleted_at: Date | null }>(
    "select version, updated_at, deleted_at from tasks where id = $1",
    ["t_roundtrip01"],
  );
  assert.equal(columns.rows[0]!.version, 2);
  assert.equal(columns.rows[0]!.updated_at.toISOString(), "2026-09-06T13:00:00.000Z");
  assert.equal(columns.rows[0]!.deleted_at, null);
});

test("all excludes deleted records unless asked, orders by updated_at then id, and get still sees them", async () => {
  await db.store.transaction(async (tx) => {
    await tx.put("label", label("l_order000b", { updatedAt: "2026-09-06T12:00:00Z" }));
    await tx.put("label", label("l_order000a", { updatedAt: "2026-09-06T12:00:00Z" }));
    await tx.put("label", label("l_order000c", { updatedAt: "2026-09-06T11:00:00Z" }));
    await tx.put("label", label("l_deleted00", { updatedAt: "2026-09-06T10:00:00Z", deletedAt: "2026-09-06T10:00:00Z" }));
  });
  const live = await db.store.read((tx) => tx.all("label"));
  assert.deepEqual(live.map((l) => l.id), ["l_order000c", "l_order000a", "l_order000b"]);
  const everything = await db.store.read((tx) => tx.all("label", { includeDeleted: true }));
  assert.deepEqual(everything.map((l) => l.id), ["l_deleted00", "l_order000c", "l_order000a", "l_order000b"]);
  const deleted = await db.store.read((tx) => tx.get("label", "l_deleted00"));
  assert.equal(deleted?.deletedAt, "2026-09-06T10:00:00Z");
  const mirrored = await db.pool.query<{ deleted_at: Date }>("select deleted_at from labels where id = 'l_deleted00'");
  assert.equal(mirrored.rows[0]!.deleted_at.toISOString(), "2026-09-06T10:00:00.000Z");
});

test("the log is append-only with increasing seq, and history is ordered per record", async () => {
  const seqs = await db.store.transaction(async (tx) => [
    await tx.appendLog(entry("l_history001")),
    await tx.appendLog(entry("l_history002", { at: "2026-09-06T12:01:00Z" })),
    await tx.appendLog(entry("l_history001", { at: "2026-09-06T12:02:00Z", op: "label.update", actor: "codex", reason: "renamed", evidence: ["vault:Areas/Health.md"], key: "k-1", patch: { color: { from: null, to: "green" } } })),
  ]);
  assert.ok(seqs[0]! < seqs[1]! && seqs[1]! < seqs[2]!, `seqs increase: ${seqs.join(",")}`);

  const history = await db.store.read((tx) => tx.history("label", "l_history001"));
  assert.deepEqual(history.map((e) => e.seq), [seqs[0], seqs[2]]);
  assert.deepEqual(history[1], {
    seq: seqs[2],
    at: "2026-09-06T12:02:00Z",
    actor: "codex",
    op: "label.update",
    recordKind: "label",
    recordId: "l_history001",
    patch: { color: { from: null, to: "green" } },
    reason: "renamed",
    evidence: ["vault:Areas/Health.md"],
    key: "k-1",
  });
  assert.deepEqual(await db.store.read((tx) => tx.history("task", "l_history001")), [], "history is per kind");

  const all = await db.store.read((tx) => tx.allLog());
  const ours = all.filter((e) => e.recordId.startsWith("l_history"));
  assert.deepEqual(ours.map((e) => e.seq), seqs);
  assert.ok(all.every((e, i) => i === 0 || all[i - 1]!.seq < e.seq), "allLog is ordered by seq");
});

test("receipts round-trip by key", async () => {
  const receipt = { ok: true, outcome: "created", id: "l_receipt001", version: 1, record: label("l_receipt001"), issues: [] };
  assert.equal(await db.store.read((tx) => tx.getReceipt("missing")), null);
  await db.store.transaction((tx) => tx.putReceipt("key-1", receipt, now));
  assert.deepEqual(await db.store.read((tx) => tx.getReceipt("key-1")), receipt);
  await db.store.transaction((tx) => tx.putReceipt("key-1", { ...receipt, version: 2 }, now));
  assert.deepEqual(await db.store.read((tx) => tx.getReceipt("key-1")), { ...receipt, version: 2 });
  const stored = await db.pool.query<{ at: Date }>("select at from receipts where key = 'key-1'");
  assert.equal(stored.rows[0]!.at.toISOString(), "2026-09-06T12:00:00.000Z");
});

test("a transaction rolls back everything when work throws, and rethrows", async () => {
  await assert.rejects(
    db.store.transaction(async (tx) => {
      await tx.put("label", label("l_rollback01"));
      await tx.appendLog(entry("l_rollback01"));
      await tx.putReceipt("rollback-key", { ok: true }, now);
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(await db.store.read((tx) => tx.get("label", "l_rollback01")), null);
  assert.deepEqual(await db.store.read((tx) => tx.history("label", "l_rollback01")), []);
  assert.equal(await db.store.read((tx) => tx.getReceipt("rollback-key")), null);
  // The pool is healthy afterwards.
  await db.store.transaction((tx) => tx.put("label", label("l_afterroll1")));
  assert.equal((await db.store.read((tx) => tx.get("label", "l_afterroll1")))?.id, "l_afterroll1");
});

test("two concurrent transactions serialize: the second runs after the first commits", async () => {
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });

  const first = db.store.transaction(async (tx) => {
    events.push("first:start");
    firstStarted();
    await tx.put("label", label("l_serial0001"));
    await gate;
    events.push("first:end");
  });
  await started;
  const second = db.store.transaction(async (tx) => {
    events.push("second:start");
    const seen = await tx.get("label", "l_serial0001");
    events.push(seen ? "second:sees-first" : "second:blind");
  });
  await sleep(150);
  assert.deepEqual(events, ["first:start"], "the second transaction waits on the advisory lock");

  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:sees-first"]);
});

test("reads take no lock and run while a write transaction is open", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writer = db.store.transaction(async (tx) => {
    await tx.put("label", label("l_readlock01"));
    await gate;
  });
  const seen = await Promise.race([
    db.store.read((tx) => tx.get("label", "l_readlock01")).then(() => "read-ran"),
    sleep(500).then(() => "read-blocked"),
  ]);
  release();
  await writer;
  assert.equal(seen, "read-ran");
});

test("read sees one snapshot: a writer's commit between its queries is invisible until the next read, and a read cannot write", async () => {
  const seen = await db.store.read(async (tx) => {
    const first = await tx.get("label", "l_snapshot01");
    await db.store.transaction((writer) => writer.put("label", label("l_snapshot01")));
    const second = await tx.get("label", "l_snapshot01");
    const listed = (await tx.all("label")).some((l) => l.id === "l_snapshot01");
    return { first, second, listed };
  });
  assert.deepEqual(seen, { first: null, second: null, listed: false }, "every query in the read saw the snapshot it started with");
  assert.equal((await db.store.read((tx) => tx.get("label", "l_snapshot01")))?.id, "l_snapshot01", "the next read sees the commit");

  await assert.rejects(
    db.store.read((tx) => tx.put("label", label("l_readonly01"))),
    (error: unknown) => {
      // Drizzle wraps the driver's error; Postgres refuses the write with SQLSTATE 25006.
      const cause = (error as { cause?: unknown }).cause;
      assert.ok(cause instanceof Error, `a wrapped driver error: ${String(error)}`);
      assert.match(cause.message, /read-only transaction/);
      assert.equal((cause as { code?: string }).code, "25006");
      return true;
    },
  );
  assert.equal(await db.store.read((tx) => tx.get("label", "l_readonly01")), null);
  await assert.rejects(
    db.store.read(async () => {
      throw new Error("read failed");
    }),
    /read failed/,
  );
  // The pool is healthy afterwards.
  await db.store.transaction((tx) => tx.put("label", label("l_afterread1")));
  assert.equal((await db.store.read((tx) => tx.get("label", "l_afterread1")))?.id, "l_afterread1");
});

test("withSavepoint undoes only the step that threw and keeps the transaction usable, nesting included", async () => {
  await db.store.transaction(async (tx) => {
    await tx.put("label", label("l_savept0001"));
    await assert.rejects(
      withSavepoint(tx, async () => {
        await tx.put("label", label("l_savept0002"));
        await tx.appendLog(entry("l_savept0002"));
        await tx.putReceipt("savept-key", { ok: true }, now);
        throw new Error("undo this step");
      }),
      /undo this step/,
    );
    assert.equal(await tx.get("label", "l_savept0002"), null, "rolled back to the savepoint");
    assert.equal((await tx.get("label", "l_savept0001"))?.id, "l_savept0001", "earlier work in the transaction stands");
    assert.equal(await withSavepoint(tx, async () => {
      await tx.put("label", label("l_savept0003"));
      return "released";
    }), "released");
    await withSavepoint(tx, async () => {
      await tx.put("label", label("l_savept0004"));
      await assert.rejects(
        withSavepoint(tx, async () => {
          await tx.put("label", label("l_savept0005"));
          throw new Error("inner");
        }),
        /inner/,
      );
      assert.equal(await tx.get("label", "l_savept0005"), null, "the inner savepoint undid only its own write");
      assert.equal((await tx.get("label", "l_savept0004"))?.id, "l_savept0004");
    });
  });
  const ids = (await db.store.read((tx) => tx.all("label"))).map((l) => l.id).filter((id) => id.startsWith("l_savept")).sort();
  assert.deepEqual(ids, ["l_savept0001", "l_savept0003", "l_savept0004"]);
  assert.deepEqual(await db.store.read((tx) => tx.history("label", "l_savept0002")), [], "the log entry went with it");
  assert.equal(await db.store.read((tx) => tx.getReceipt("savept-key")), null, "and the receipt");
  await assert.rejects(withSavepoint({} as Tx, async () => 1), /no Postgres client/);
});
