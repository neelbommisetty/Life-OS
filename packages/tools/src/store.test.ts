import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import type { Event, Label, LogEntry, Task } from "./contract.ts";
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

// ------------------------------------------------------------------ eventsInRange

const CAL1 = "c_range00001";
const CAL2 = "c_range00002";
const timed = (start: string, end: string): Pick<Event, "start" | "end"> => ({
  start: { at: start, timezone: "America/Los_Angeles" },
  end: { at: end, timezone: "America/Los_Angeles" },
});
const allDay = (start: string, end: string): Pick<Event, "start" | "end"> => ({ start: { date: start }, end: { date: end } });

const event = (id: string, extra: Partial<Event> = {}): Event => ({
  id,
  calendarId: CAL1,
  accountId: "a_range00001",
  title: `Event ${id}`,
  notes: null,
  location: null,
  ...timed("2026-09-10T16:00:00Z", "2026-09-10T17:00:00Z"),
  repeat: null,
  masterId: null,
  originalStart: null,
  status: "confirmed",
  busy: true,
  organizer: null,
  attendees: [],
  myResponse: null,
  conferencing: null,
  reminders: null,
  origin,
  external: { provider: "google", id: `g-${id}`, etag: "1", iCalUID: `${id}@google.com`, updatedAt: now },
  version: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...extra,
});

const rule = { rrule: "RRULE:FREQ=WEEKLY;BYDAY=TH", exdates: [] };

test("eventsInRange returns overlapping rows, every master with a rule and its exceptions, never deleted rows", async () => {
  const from = "2026-09-10T00:00:00Z";
  const to = "2026-09-11T00:00:00Z";
  await db.store.transaction(async (tx) => {
    // Timed rows against the window [from, to).
    await tx.put("event", event("e_rangein001"));
    await tx.put("event", event("e_rangeafter", timed("2026-09-12T16:00:00Z", "2026-09-12T17:00:00Z")));
    await tx.put("event", event("e_rangestrad", timed("2026-09-09T23:00:00Z", "2026-09-10T01:00:00Z")));
    await tx.put("event", event("e_rangeendat", timed("2026-09-09T22:00:00Z", "2026-09-10T00:00:00Z")));
    await tx.put("event", event("e_rangestart", timed("2026-09-11T00:00:00Z", "2026-09-11T01:00:00Z")));
    await tx.put("event", event("e_rangespans", timed("2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z")));
    await tx.put("event", event("e_rangedelet", { deletedAt: now }));
    // A master with a rule far outside the window, and its exception row further still.
    await tx.put("event", event("e_rangemastr", { ...timed("2025-01-02T17:00:00Z", "2025-01-02T18:00:00Z"), repeat: rule }));
    await tx.put("event", event("e_rangeexcep", {
      ...timed("2027-05-06T18:00:00Z", "2027-05-06T19:00:00Z"),
      masterId: "e_rangemastr",
      originalStart: { at: "2027-05-06T17:00:00Z", timezone: "America/Los_Angeles" },
    }));
    // A deleted master: neither it nor its out-of-window exception row comes back, but an exception row overlapping the window on its own does.
    await tx.put("event", event("e_rangedmast", { ...timed("2025-01-02T17:00:00Z", "2025-01-02T18:00:00Z"), repeat: rule, deletedAt: now }));
    await tx.put("event", event("e_rangedexc1", {
      ...timed("2027-05-06T18:00:00Z", "2027-05-06T19:00:00Z"),
      masterId: "e_rangedmast",
      originalStart: { at: "2027-05-06T17:00:00Z", timezone: "America/Los_Angeles" },
    }));
    await tx.put("event", event("e_rangedexc2", {
      ...timed("2026-09-10T18:00:00Z", "2026-09-10T19:00:00Z"),
      masterId: "e_rangedmast",
      originalStart: { at: "2026-09-10T17:00:00Z", timezone: "America/Los_Angeles" },
    }));
    // Floating rows carry their wall clock spelled as UTC, up to a day away from the instant it resolves to in a display zone
    // the store does not know: a day of slack each way, and the expansion trims. `e_rangedexc3` is an orphaned floating exception row.
    await tx.put("event", event("e_rangeflin1", { start: { at: "2026-09-11T02:00:00Z", timezone: null }, end: { at: "2026-09-11T03:00:00Z", timezone: null } }));
    await tx.put("event", event("e_rangeflin2", { start: { at: "2026-09-09T22:00:00Z", timezone: null }, end: { at: "2026-09-09T23:00:00Z", timezone: null } }));
    await tx.put("event", event("e_rangeflout", { start: { at: "2026-09-12T01:00:00Z", timezone: null }, end: { at: "2026-09-12T02:00:00Z", timezone: null } }));
    await tx.put("event", event("e_rangedexc3", {
      start: { at: "2026-09-11T02:00:00Z", timezone: null },
      end: { at: "2026-09-11T03:00:00Z", timezone: null },
      masterId: "e_rangedmast",
      originalStart: { at: "2026-09-11T01:00:00Z", timezone: null },
    }));
    // All-day rows: matched by date with a day of slack after `to`.
    await tx.put("event", event("e_rangeaday1", { ...allDay("2026-09-10", "2026-09-11"), busy: false }));
    await tx.put("event", event("e_rangeaday2", { ...allDay("2026-09-01", "2026-09-02"), busy: false }));
    await tx.put("event", event("e_rangeaday3", { ...allDay("2026-09-12", "2026-09-13"), busy: false }));
    await tx.put("event", event("e_rangeaday4", { ...allDay("2026-09-13", "2026-09-14"), busy: false }));
    await tx.put("event", event("e_rangeaday5", { ...allDay("2026-09-09", "2026-09-10"), busy: false }));
    // Another calendar.
    await tx.put("event", event("e_rangeother", { calendarId: CAL2 }));
    await tx.put("event", event("e_rangeomast", { calendarId: CAL2, ...timed("2025-01-02T17:00:00Z", "2025-01-02T18:00:00Z"), repeat: rule }));
  });

  const one = await db.store.read((tx) => tx.eventsInRange([CAL1], from, to));
  assert.deepEqual(one.map((e) => e.id), [
    "e_rangemastr", // 2025-01-02T17:00:00Z
    "e_rangespans", // 2026-09-01T00:00:00Z
    "e_rangeaday5", // 2026-09-09
    "e_rangeflin2", // 2026-09-09T22:00:00Z floating
    "e_rangestrad", // 2026-09-09T23:00:00Z
    "e_rangeaday1", // 2026-09-10
    "e_rangein001", // 2026-09-10T16:00:00Z
    "e_rangedexc2", // 2026-09-10T18:00:00Z
    "e_rangedexc3", // 2026-09-11T02:00:00Z floating
    "e_rangeflin1", // 2026-09-11T02:00:00Z floating
    "e_rangeaday3", // 2026-09-12
    "e_rangeexcep", // 2027-05-06T18:00:00Z
  ], "ordered by start key then id");
  const ids = new Set(one.map((e) => e.id));
  assert.ok(ids.has("e_rangein001"), "inside the window");
  assert.ok(ids.has("e_rangestrad"), "straddles the start");
  assert.ok(ids.has("e_rangespans"), "spans the whole window");
  assert.ok(!ids.has("e_rangeendat"), "ending exactly at from does not overlap");
  assert.ok(!ids.has("e_rangestart"), "starting exactly at to does not overlap");
  assert.ok(!ids.has("e_rangeafter"), "after the window");
  assert.ok(!ids.has("e_rangedelet"), "deleted rows are never returned");
  assert.ok(ids.has("e_rangemastr"), "a master with a rule comes regardless of the window");
  assert.ok(ids.has("e_rangeexcep"), "and its exception rows with it");
  assert.ok(!ids.has("e_rangedmast"), "a deleted master is excluded");
  assert.ok(!ids.has("e_rangedexc1"), "an orphaned exception row outside the window is excluded");
  assert.ok(ids.has("e_rangedexc2"), "an orphaned exception row inside the window earns its place");
  assert.ok(ids.has("e_rangeaday1"), "all-day on the day");
  assert.ok(ids.has("e_rangeaday5"), "all-day ending on the day of from may still overlap in a western zone");
  assert.ok(!ids.has("e_rangeaday2"), "all-day well before");
  assert.ok(ids.has("e_rangeaday3"), "all-day starting the day after to is kept as slack for eastern zones");
  assert.ok(!ids.has("e_rangeaday4"), "all-day two days after to is out");
  assert.ok(!ids.has("e_rangeother") && !ids.has("e_rangeomast"), "other calendars are not asked for");
  assert.ok(ids.has("e_rangeflin1"), "a floating row two hours past to may still fall inside the window in an eastern display zone");
  assert.ok(ids.has("e_rangeflin2"), "a floating row ending an hour before from may still fall inside it in a western one");
  assert.ok(!ids.has("e_rangeflout"), "a floating row more than a day past to cannot");
  assert.ok(ids.has("e_rangedexc3"), "an orphaned floating exception row gets the same slack");

  const both = await db.store.read((tx) => tx.eventsInRange([CAL1, CAL2], from, to));
  const bothIds = new Set(both.map((e) => e.id));
  assert.ok(bothIds.has("e_rangeother") && bothIds.has("e_rangeomast"), "the second calendar's rows and master arrive when asked for");
  assert.equal(both.length, one.length + 2);

  const eastern = await db.store.read((tx) => tx.eventsInRange([CAL1], "2026-09-12T10:00:00Z", "2026-09-13T00:00:00Z"));
  assert.ok(eastern.some((e) => e.id === "e_rangeflout") && !eastern.some((e) => e.id === "e_rangeflin1"), "the slack is a day, not open-ended");

  assert.deepEqual(await db.store.read((tx) => tx.eventsInRange([], from, to)), [], "no calendars, no rows");
  assert.deepEqual(await db.store.read((tx) => tx.eventsInRange(["c_nosuchcal1"], from, to)), []);

  const later = await db.store.read((tx) => tx.eventsInRange([CAL1], "2027-05-06T00:00:00Z", "2027-05-07T00:00:00Z"));
  assert.deepEqual(later.map((e) => e.id).sort(), ["e_rangedexc1", "e_rangeexcep", "e_rangemastr"], "an exception row overlaps on its own too");

  assert.deepEqual(one.find((e) => e.id === "e_rangein001"), event("e_rangein001"), "rows come back whole");
});
