import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Account, Calendar, Ctx, Event, Receipt } from "../contract.ts";
import { mutate, newId, okMutation, type Clock } from "../core.ts";
import { createTestDb, fixedClock, type TestDb } from "../db/testing.ts";
import { FakeAdapter, ProviderUnavailable, type CalendarAdapter, type ProviderCalendar, type SeedEvent } from "./adapter.ts";
import { historyStart, isStale, refreshIfStale, syncAccount, type SyncReport } from "./sync.ts";

const NOW = "2026-09-09T12:00:00Z";
const SINCE = "2025-09-09T12:00:00Z";
const clock = fixedClock(NOW);
const neel: Ctx = { actor: "neel" };

const personal: ProviderCalendar = { id: "neel@gmail.com", name: "Personal", color: "#0b8043", timezone: "America/Los_Angeles", writable: true, primary: true, hidden: false };
const holidays: ProviderCalendar = { id: "holidays@group.v.calendar.google.com", name: "Holidays", color: null, timezone: "UTC", writable: false, primary: false, hidden: true };
const work: ProviderCalendar = { id: "work@example.com", name: "Work", color: "#4285f4", timezone: "America/Los_Angeles", writable: true, primary: false, hidden: false };

const timed = (day: string, hour: number, id?: string, extra: Partial<SeedEvent> = {}): SeedEvent => ({
  ...(id ? { id } : {}),
  title: `Event ${id ?? day}`,
  start: { at: `${day}T${String(hour).padStart(2, "0")}:00:00Z`, timezone: "America/Los_Angeles" },
  end: { at: `${day}T${String(hour + 1).padStart(2, "0")}:00:00Z`, timezone: "America/Los_Angeles" },
  ...extra,
});

let db: TestDb;
before(async () => {
  db = await createTestDb();
});
after(() => db.drop());

function okRecord<T>(receipt: Receipt<T>, label = "receipt"): T {
  assert.equal(receipt.ok, true, `${label}: ${JSON.stringify(receipt)}`);
  if (!receipt.ok) throw new Error("unreachable");
  return receipt.record;
}

async function addAccount(identity: string, status: Account["status"] = "connected"): Promise<Account> {
  const id = newId("account");
  return okRecord(
    await mutate(db.store, clock, "account", "account.add", neel, async (_tx, _c, now) =>
      okMutation("created", null, { id, provider: "google", identity, label: null, primary: true, status, scopes: [], syncedAt: null, version: 1, createdAt: now, updatedAt: now, deletedAt: null }),
    ),
  );
}

const calendarsOf = (accountId: string) =>
  db.store.read(async (tx) => (await tx.all("calendar", { includeDeleted: true })).filter((c) => c.accountId === accountId).sort((a, b) => a.order - b.order));
const eventsOf = (calendarId: string) =>
  db.store.read(async (tx) => (await tx.all("event", { includeDeleted: true })).filter((e) => e.calendarId === calendarId));
const getEvent = (id: string) => db.store.read((tx) => tx.get("event", id));
const getCalendar = (id: string) => db.store.read((tx) => tx.get("calendar", id));
const getAccount = (id: string) => db.store.read((tx) => tx.get("account", id));
const logSize = () => db.store.read(async (tx) => (await tx.allLog()).length);
const byExternal = (events: Event[], externalId: string): Event => {
  const found = events.find((e) => e.external.id === externalId);
  assert.ok(found, `no row for provider id ${externalId}`);
  return found;
};
const entry = (report: SyncReport, calendarId: string) => {
  const found = report.calendars.find((c) => c.calendarId === calendarId);
  assert.ok(found, `no report entry for ${calendarId}: ${JSON.stringify(report)}`);
  return found;
};

/** A row written locally, the way a write-through or an older sync would have left it. */
async function putLocalEvent(calendar: Calendar, id: string, externalId: string, start: Event["start"], end: Event["end"]): Promise<Event> {
  return okRecord(
    await mutate(db.store, clock, "event", "event.add", neel, async (_tx, _c, now) =>
      okMutation("created", null, {
        id,
        calendarId: calendar.id,
        accountId: calendar.accountId,
        title: `Local ${id}`,
        notes: null,
        location: null,
        start,
        end,
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
        origin: { actor: "neel", at: now, evidence: [] },
        external: { provider: "google", id: externalId, etag: "etag-local", iCalUID: `${externalId}@google.com`, updatedAt: now },
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    ),
  );
}

/** What CalendarOps.update would do: Neel's fields on the calendar, logged under his actor. */
async function neelUpdates(calendarId: string, patch: Partial<Pick<Calendar, "labels" | "hidden" | "color" | "order">>): Promise<Calendar> {
  return okRecord(
    await mutate(db.store, clock, "calendar", "calendar.update", neel, async (tx, _c, now) => {
      const current = await tx.get("calendar", calendarId);
      if (!current) throw new Error("no calendar");
      return okMutation("updated", current, { ...current, ...patch, version: current.version + 1, updatedAt: now });
    }),
  );
}

/** The fake behind an adapter that throws `error()` (when not null) on syncPage for one calendar. */
function failingOn(fake: FakeAdapter, calendarExternalId: string, error: () => Error | null): CalendarAdapter {
  return {
    provider: "google",
    connect: (opts) => fake.connect(opts),
    listCalendars: (accountId) => fake.listCalendars(accountId),
    syncPage: (accountId, calendar, cursor, since) => {
      const failure = calendar === calendarExternalId ? error() : null;
      return failure ? Promise.reject(failure) : fake.syncPage(accountId, calendar, cursor, since);
    },
    create: (a, c, e, l) => fake.create(a, c, e, l),
    update: (a, c, p, patch, etag) => fake.update(a, c, p, patch, etag),
    delete: (a, c, p) => fake.delete(a, c, p),
    respond: (a, c, p, r) => fake.respond(a, c, p, r),
    instanceId: (m, o) => fake.instanceId(m, o),
  };
}

test("historyStart and isStale", () => {
  assert.equal(historyStart(NOW, 12), SINCE);
  assert.equal(historyStart("2026-03-31T00:00:00Z", 1), "2026-03-03T00:00:00Z", "JavaScript month arithmetic rolls over, which is fine for a lower bound");
  const now = new Date(NOW);
  assert.equal(isStale(null, now, 300), true);
  assert.equal(isStale("2026-09-09T11:55:01Z", now, 300), false, "299 seconds old");
  assert.equal(isStale("2026-09-09T11:55:00Z", now, 300), false, "exactly the threshold is not older than it");
  assert.equal(isStale("2026-09-09T11:54:59Z", now, 300), true);
});

test("a first sync adds the calendars, pulls the events page by page with the cursor stored per page, and stamps the account", async () => {
  const account = await addAccount("first@example.com");
  const fake = new FakeAdapter({ clock, pageSize: 2 });
  fake.seed(account.id, personal, [timed("2026-09-10", 16, "p1"), timed("2026-09-11", 16, "p2"), timed("2026-09-12", 16, "p3"), timed("2026-09-13", 16, "p4"), timed("2026-09-14", 16, "p5")]);
  fake.seed(account.id, holidays, [{ id: "xmas", title: "Christmas", start: { date: "2026-12-25" }, end: { date: "2026-12-26" } }]);

  const report = await syncAccount(db.store, clock, fake, account.id);
  const calendars = await calendarsOf(account.id);
  assert.equal(calendars.length, 2);
  const [cal, hol] = calendars as [Calendar, Calendar];
  assert.deepEqual(
    { name: cal.name, color: cal.color, timezone: cal.timezone, labels: cal.labels, writable: cal.writable, hidden: cal.hidden, primaryOfAccount: cal.primaryOfAccount, order: cal.order, externalId: cal.external.id, syncedAt: cal.syncedAt, syncError: cal.syncError },
    { name: "Personal", color: "#0b8043", timezone: "America/Los_Angeles", labels: [], writable: true, hidden: false, primaryOfAccount: true, order: 0, externalId: personal.id, syncedAt: NOW, syncError: null },
  );
  assert.deepEqual({ hidden: hol.hidden, writable: hol.writable, order: hol.order, syncedAt: hol.syncedAt }, { hidden: true, writable: false, order: 1, syncedAt: NOW }, "hidden defaults to the provider's flag");
  assert.match(cal.id, /^c_[a-z0-9]{10}$/);
  assert.deepEqual(report, {
    accountId: account.id,
    calendars: [
      { calendarId: cal.id, outcome: "synced", created: 5, updated: 0, deleted: 0 },
      { calendarId: hol.id, outcome: "synced", created: 1, updated: 0, deleted: 0 },
    ],
  });

  const calls = fake.callsTo("syncPage").filter((call) => call.args[1] === personal.id);
  assert.equal(calls.length, 3, "five events in pages of two");
  assert.deepEqual(calls[0]!.args, [account.id, personal.id, null, SINCE], "a full sync from twelve months back");
  assert.match(String(calls[1]!.args[2]), /^page:full:/, "the second page continues from the first page's cursor");
  assert.match(String(cal.external.syncToken), new RegExp(`^sync:${personal.id.replace(".", "\\.")}:`), "the done page's cursor is the one stored");

  const history = await db.store.read((tx) => tx.history("calendar", cal.id));
  assert.deepEqual(history.map((e) => [e.op, e.actor]), Array.from({ length: 4 }, () => ["calendar.sync", "import:google"]), "one create, then one entry per page");
  assert.deepEqual(history.slice(1, 3).map((e) => Object.keys(e.patch)), [["external"], ["external"]], "an intermediate page stores only its cursor");
  assert.match(String((history[1]!.patch.external!.to as Calendar["external"]).syncToken), /^page:full:/);
  assert.deepEqual(Object.keys(history[3]!.patch).sort(), ["external", "syncedAt"], "the last page stores the sync cursor and the sync time");

  const events = await eventsOf(cal.id);
  assert.equal(events.length, 5);
  for (const event of events) {
    assert.match(event.id, /^e_[a-z0-9]{10}$/, "ids are ours, never the provider's");
    assert.deepEqual({ accountId: event.accountId, actor: event.origin.actor, masterId: event.masterId, deletedAt: event.deletedAt }, { accountId: account.id, actor: "import:google", masterId: null, deletedAt: null });
    assert.equal(event.external.etag, fake.event(account.id, event.external.id)!.external.etag);
  }
  const eventLog = await db.store.read((tx) => tx.history("event", byExternal(events, "p1").id));
  assert.deepEqual(eventLog.map((e) => [e.op, e.actor, e.patch.title?.to]), [["event.sync", "import:google", "Event p1"]]);
  assert.equal((await getAccount(account.id))!.syncedAt, NOW);
});

test("an incremental sync applies created, updated, and deleted items; equal etags write nothing, on an incremental or a full pass", async () => {
  const account = await addAccount("incremental@example.com");
  const fake = new FakeAdapter({ clock });
  fake.seed(account.id, personal, [timed("2026-09-10", 16, "p1"), timed("2026-09-11", 16, "p2")]);
  await syncAccount(db.store, clock, fake, account.id);
  const [cal] = (await calendarsOf(account.id)) as [Calendar];
  const token = cal.external.syncToken;
  assert.ok(token);

  const before = await logSize();
  const quiet = await syncAccount(db.store, clock, fake, account.id);
  assert.deepEqual(quiet.calendars, [{ calendarId: cal.id, outcome: "unchanged", created: 0, updated: 0, deleted: 0 }]);
  assert.equal(await logSize(), before, "a quiet sync writes nothing");
  assert.equal(fake.callsTo("syncPage").at(-1)!.args[2], token, "the stored cursor is what the provider was asked to continue from");

  const full = await syncAccount(db.store, clock, fake, account.id, { full: true });
  assert.equal(full.calendars[0]!.outcome, "unchanged");
  assert.equal(fake.callsTo("syncPage").at(-1)!.args[2], null, "full discards the cursor");
  assert.equal(await logSize(), before, "a full pass over an identical copy writes nothing: every etag matched");

  fake.change(account.id, "p1", { title: "Moved on the phone", location: "Room 4" });
  const created = await fake.create(account.id, personal.id, { title: "Dentist", notes: null, location: null, start: { at: "2026-09-15T16:00:00Z", timezone: "America/Los_Angeles" }, end: { at: "2026-09-15T17:00:00Z", timezone: "America/Los_Angeles" }, repeat: null, busy: true, status: "confirmed" }, "e_lifeid0001");
  await fake.delete(account.id, personal.id, "p2");

  const report = await syncAccount(db.store, clock, fake, account.id);
  assert.deepEqual(report.calendars, [{ calendarId: cal.id, outcome: "synced", created: 1, updated: 1, deleted: 1 }]);
  const events = await eventsOf(cal.id);
  assert.equal(events.length, 3);
  const p1 = byExternal(events, "p1");
  assert.deepEqual({ title: p1.title, location: p1.location, version: p1.version, etag: p1.external.etag }, { title: "Moved on the phone", location: "Room 4", version: 2, etag: fake.event(account.id, "p1")!.external.etag });
  const p1Log = await db.store.read((tx) => tx.history("event", p1.id));
  assert.deepEqual(p1Log.at(-1)!.patch.title, { from: "Event p1", to: "Moved on the phone" }, "the log shows what the provider changed");
  assert.equal(p1Log.at(-1)!.actor, "import:google");
  const dentist = byExternal(events, created.external.id);
  assert.equal(dentist.id, "e_lifeid0001", "an item carrying a free lifeId takes it");
  const p2 = byExternal(events, "p2");
  assert.deepEqual({ deletedAt: p2.deletedAt, status: p2.status, title: p2.title }, { deletedAt: NOW, status: "confirmed", title: "Event p2" }, "a provider deletion is a soft delete with the status left alone");

  const again = await syncAccount(db.store, clock, fake, account.id);
  assert.equal(again.calendars[0]!.outcome, "unchanged");
});

test("exception rows link to their master even when they arrive first, and a deleted master takes its exceptions with it", async () => {
  const account = await addAccount("repeat@example.com");
  const fake = new FakeAdapter({ clock, pageSize: 1 });
  const master: SeedEvent = { id: "m1", title: "Standup", start: { at: "2026-09-07T16:00:00Z", timezone: "America/Los_Angeles" }, end: { at: "2026-09-07T16:15:00Z", timezone: "America/Los_Angeles" }, repeat: { rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO", exdates: [] } };
  const exception: SeedEvent = { id: "m1_20260914T160000Z", title: "Standup (moved)", start: { at: "2026-09-14T17:00:00Z", timezone: "America/Los_Angeles" }, end: { at: "2026-09-14T17:15:00Z", timezone: "America/Los_Angeles" }, providerMasterId: "m1", originalStart: { at: "2026-09-14T16:00:00Z", timezone: "America/Los_Angeles" } };
  const stray: SeedEvent = { id: "ghost_20260901T160000Z", title: "Orphan", start: { at: "2026-09-01T16:00:00Z", timezone: "UTC" }, end: { at: "2026-09-01T17:00:00Z", timezone: "UTC" }, providerMasterId: "ghost", originalStart: { at: "2026-09-01T16:00:00Z", timezone: "UTC" } };
  // The exception is seeded first, so with pages of one it arrives a page before its master.
  fake.seed(account.id, personal, [exception, master, stray]);

  const report = await syncAccount(db.store, clock, fake, account.id);
  const [cal] = (await calendarsOf(account.id)) as [Calendar];
  assert.deepEqual(report.calendars, [{ calendarId: cal.id, outcome: "synced", created: 3, updated: 0, deleted: 0 }]);
  const events = await eventsOf(cal.id);
  const masterRow = byExternal(events, "m1");
  const exceptionRow = byExternal(events, "m1_20260914T160000Z");
  assert.deepEqual({ masterId: exceptionRow.masterId, originalStart: exceptionRow.originalStart, repeat: exceptionRow.repeat }, { masterId: masterRow.id, originalStart: { at: "2026-09-14T16:00:00Z", timezone: "America/Los_Angeles" }, repeat: null });
  assert.deepEqual({ masterId: masterRow.masterId, rule: masterRow.repeat?.rrule }, { masterId: null, rule: "RRULE:FREQ=WEEKLY;BYDAY=MO" });
  const orphan = byExternal(events, "ghost_20260901T160000Z");
  assert.deepEqual({ masterId: orphan.masterId, originalStart: orphan.originalStart, title: orphan.title }, { masterId: null, originalStart: null, title: "Orphan" }, "an exception whose master never arrives is kept as a plain event rather than dropped");

  // The provider forgets the master alone (no cascade on its side): ours deletes the exception rows with it.
  fake.change(account.id, "m1", { deleted: true });
  const gone = await syncAccount(db.store, clock, fake, account.id);
  assert.deepEqual(gone.calendars, [{ calendarId: cal.id, outcome: "synced", created: 0, updated: 0, deleted: 2 }]);
  assert.equal((await getEvent(masterRow.id))!.deletedAt, NOW);
  assert.equal((await getEvent(exceptionRow.id))!.deletedAt, NOW);
  assert.equal((await getEvent(orphan.id))!.deletedAt, null);
});

test("matching: lifeId finds the row before the provider id does, a free lifeId is taken, a malformed one is ignored", async () => {
  const account = await addAccount("matching@example.com");
  const fake = new FakeAdapter({ clock });
  fake.seed(account.id, personal, []);
  await syncAccount(db.store, clock, fake, account.id);
  const [cal] = (await calendarsOf(account.id)) as [Calendar];
  await putLocalEvent(cal, "e_local00000", "old-provider-id", { at: "2026-09-10T16:00:00Z", timezone: "UTC" }, { at: "2026-09-10T17:00:00Z", timezone: "UTC" });

  fake.seed(account.id, personal, [
    timed("2026-09-10", 16, "new-provider-id", { lifeId: "e_local00000", title: "Recreated after a failed local write" }),
    timed("2026-09-11", 16, "free", { lifeId: "e_freeid0001" }),
    timed("2026-09-12", 16, "junk", { lifeId: "not-an-id" }),
  ]);
  const report = await syncAccount(db.store, clock, fake, account.id);
  assert.deepEqual(report.calendars, [{ calendarId: cal.id, outcome: "synced", created: 2, updated: 1, deleted: 0 }]);
  const events = await eventsOf(cal.id);
  assert.equal(events.length, 3, "the lifeId item met its own row instead of creating a second one");
  const relinked = byExternal(events, "new-provider-id");
  assert.deepEqual({ id: relinked.id, title: relinked.title, version: relinked.version }, { id: "e_local00000", title: "Recreated after a failed local write", version: 2 });
  assert.equal(byExternal(events, "free").id, "e_freeid0001");
  assert.match(byExternal(events, "junk").id, /^e_[a-z0-9]{10}$/);
  assert.notEqual(byExternal(events, "junk").id, "not-an-id");
});

test("an expired cursor starts a full listing over and prunes unmentioned rows after since; older rows and a full pass behave the same way", async () => {
  const account = await addAccount("expired@example.com");
  const fake = new FakeAdapter({ clock });
  fake.seed(account.id, personal, [timed("2026-09-10", 16, "keep"), timed("2026-09-11", 16, "vanished"), timed("2026-09-12", 16, "later")]);
  await syncAccount(db.store, clock, fake, account.id);
  const [cal] = (await calendarsOf(account.id)) as [Calendar];
  const staleAfter = await putLocalEvent(cal, "e_stale00000", "never-synced", { at: "2026-09-20T16:00:00Z", timezone: "UTC" }, { at: "2026-09-20T17:00:00Z", timezone: "UTC" });
  const staleBefore = await putLocalEvent(cal, "e_ancient001", "ancient", { at: "2025-01-01T16:00:00Z", timezone: "UTC" }, { at: "2025-01-01T17:00:00Z", timezone: "UTC" });
  const vanished = byExternal(await eventsOf(cal.id), "vanished");
  fake.remove(account.id, "vanished");
  fake.expireCursors(account.id, personal.id);

  const report = await syncAccount(db.store, clock, fake, account.id);
  assert.deepEqual(report.calendars, [{ calendarId: cal.id, outcome: "resynced", created: 0, updated: 0, deleted: 2 }]);
  const calls = fake.callsTo("syncPage").slice(-2);
  assert.deepEqual(calls.map((call) => call.args[2] === null), [false, true], "the expired cursor was tried, then dropped");
  assert.equal((await getEvent(vanished.id))!.deletedAt, NOW, "a row the full listing did not mention is gone");
  assert.equal((await getEvent(staleAfter.id))!.deletedAt, NOW, "so is a local row after since the provider never had");
  assert.equal((await getEvent(staleBefore.id))!.deletedAt, null, "a row before since is outside the listing and stays");
  assert.equal((await getEvent(byExternal(await eventsOf(cal.id), "keep").id))!.deletedAt, null);
  const fresh = await getCalendar(cal.id);
  assert.match(String(fresh!.external.syncToken), /^sync:/, "a new cursor is stored");
  assert.equal(fresh!.syncError, null);

  fake.remove(account.id, "later");
  const full = await syncAccount(db.store, clock, fake, account.id, { full: true });
  assert.deepEqual(full.calendars, [{ calendarId: cal.id, outcome: "synced", created: 0, updated: 0, deleted: 1 }], "a full pass is a listing too, so it prunes the same way");
});

test("the calendar list: added, renamed and re-permissioned, removed with its events, and restored when listed again", async () => {
  const account = await addAccount("calendars@example.com");
  const fake = new FakeAdapter({ clock });
  fake.seed(account.id, personal, [timed("2026-09-10", 16, "p1")]);
  await syncAccount(db.store, clock, fake, account.id);

  fake.seed(account.id, work, [timed("2026-09-10", 18, "w1"), timed("2026-09-11", 18, "w2")]);
  const added = await syncAccount(db.store, clock, fake, account.id);
  const [cal, wrk] = (await calendarsOf(account.id)) as [Calendar, Calendar];
  assert.deepEqual({ name: wrk.name, order: wrk.order, external: wrk.external.id }, { name: "Work", order: 1, external: work.id });
  assert.deepEqual(entry(added, wrk.id), { calendarId: wrk.id, outcome: "synced", created: 2, updated: 0, deleted: 0 });
  assert.equal(entry(added, cal.id).outcome, "unchanged");

  fake.changeCalendar(account.id, personal.id, { name: "Personal (Neel)", writable: false, color: "#ff0000" });
  await syncAccount(db.store, clock, fake, account.id);
  const renamed = (await getCalendar(cal.id))!;
  assert.deepEqual({ name: renamed.name, writable: renamed.writable, color: renamed.color, version: renamed.version }, { name: "Personal (Neel)", writable: false, color: "#ff0000", version: cal.version + 1 });
  const history = await db.store.read((tx) => tx.history("calendar", cal.id));
  assert.deepEqual(history.at(-1)!.patch.name, { from: "Personal", to: "Personal (Neel)" });
  assert.equal(history.at(-1)!.op, "calendar.sync");

  fake.removeCalendar(account.id, work.id);
  const removed = await syncAccount(db.store, clock, fake, account.id);
  assert.deepEqual(entry(removed, wrk.id), { calendarId: wrk.id, outcome: "synced", created: 0, updated: 0, deleted: 2 });
  assert.equal((await getCalendar(wrk.id))!.deletedAt, NOW);
  assert.deepEqual((await eventsOf(wrk.id)).map((e) => e.deletedAt), [NOW, NOW], "its events went with it");

  fake.seed(account.id, work, [timed("2026-09-10", 18, "w1")]);
  const back = await syncAccount(db.store, clock, fake, account.id);
  const restored = (await getCalendar(wrk.id))!;
  assert.equal(restored.deletedAt, null, "the same row comes back");
  assert.equal((await calendarsOf(account.id)).length, 2, "no second row for the same provider calendar");
  assert.equal(entry(back, wrk.id).outcome, "synced");
  const w1 = byExternal(await eventsOf(wrk.id), "w1");
  assert.equal(w1.deletedAt, null, "a full listing restored the event the provider still has");
  assert.equal(byExternal(await eventsOf(wrk.id), "w2").deletedAt, NOW, "the one it no longer has stays deleted");
});

test("labels, hidden, color, and order set by Neel survive sync; the provider's hidden flag is followed until then", async () => {
  const account = await addAccount("ours@example.com");
  const fake = new FakeAdapter({ clock });
  fake.seed(account.id, personal, []);
  fake.seed(account.id, holidays, []);
  await syncAccount(db.store, clock, fake, account.id);
  const [cal, hol] = (await calendarsOf(account.id)) as [Calendar, Calendar];
  await neelUpdates(cal.id, { labels: ["health", "family"], hidden: true, color: "#123456", order: 7 });

  fake.changeCalendar(account.id, personal.id, { hidden: false, color: "#0b8043", name: "Personal 2" });
  fake.changeCalendar(account.id, holidays.id, { hidden: false });
  await syncAccount(db.store, clock, fake, account.id);
  const ours = (await getCalendar(cal.id))!;
  assert.deepEqual({ labels: ours.labels, hidden: ours.hidden, color: ours.color, order: ours.order, name: ours.name }, { labels: ["health", "family"], hidden: true, color: "#123456", order: 7, name: "Personal 2" }, "ours stay, the provider's name still lands");
  assert.equal((await getCalendar(hol.id))!.hidden, false, "never set by Neel, so the provider's flag is followed");

  const again = await syncAccount(db.store, clock, fake, account.id);
  assert.deepEqual(again.calendars.map((c) => c.outcome), ["unchanged", "unchanged"]);
});

test("failures are per calendar: the error lands on the calendar and in the report while the others sync; a failed calendar list fails them all", async () => {
  const account = await addAccount("failures@example.com");
  const fake = new FakeAdapter({ clock });
  fake.seed(account.id, personal, [timed("2026-09-10", 16, "p1")]);
  fake.seed(account.id, holidays, [{ id: "xmas", title: "Christmas", start: { date: "2026-12-25" }, end: { date: "2026-12-26" } }]);
  let failure: Error | null = new ProviderUnavailable("Google is rate limiting", 403);
  const adapter = failingOn(fake, holidays.id, () => failure);

  const report = await syncAccount(db.store, clock, adapter, account.id);
  const [cal, hol] = (await calendarsOf(account.id)) as [Calendar, Calendar];
  assert.deepEqual(entry(report, cal.id), { calendarId: cal.id, outcome: "synced", created: 1, updated: 0, deleted: 0 });
  assert.deepEqual(entry(report, hol.id), { calendarId: hol.id, outcome: "failed", created: 0, updated: 0, deleted: 0, error: "ProviderUnavailable: Google is rate limiting" });
  const failed = (await getCalendar(hol.id))!;
  assert.deepEqual({ syncError: failed.syncError, syncedAt: failed.syncedAt, token: failed.external.syncToken }, { syncError: "ProviderUnavailable: Google is rate limiting", syncedAt: null, token: null });
  assert.equal((await eventsOf(hol.id)).length, 0);
  assert.equal((await getAccount(account.id))!.syncedAt, NOW, "one calendar synced, so the account did");

  failure = null;
  const recovered = await syncAccount(db.store, clock, adapter, account.id);
  assert.deepEqual(entry(recovered, hol.id), { calendarId: hol.id, outcome: "synced", created: 1, updated: 0, deleted: 0 });
  assert.deepEqual({ syncError: (await getCalendar(hol.id))!.syncError, syncedAt: (await getCalendar(hol.id))!.syncedAt }, { syncError: null, syncedAt: NOW }, "a good sync clears the error");

  const later = fixedClock("2026-09-09T13:00:00Z");
  fake.failNext(new ProviderUnavailable("service unavailable", 503));
  const listFailed = await syncAccount(db.store, later, adapter, account.id);
  assert.deepEqual(listFailed.calendars.map((c) => [c.calendarId, c.outcome, c.error]), [
    [cal.id, "failed", "ProviderUnavailable: service unavailable"],
    [hol.id, "failed", "ProviderUnavailable: service unavailable"],
  ]);
  assert.equal((await getCalendar(cal.id))!.syncError, "ProviderUnavailable: service unavailable");
  assert.equal((await getAccount(account.id))!.syncedAt, NOW, "nothing synced, so the account's time did not move");
  assert.equal(fake.callsTo("syncPage").filter((call) => call.args[0] === account.id).length, 3, "no page was asked for once the list failed");

  await assert.rejects(syncAccount(db.store, clock, fake, "a_nosuchacct"), /no account a_nosuchacct/);
});

test("refreshIfStale syncs only copies older than maxAgeSeconds or never synced, skips accounts that are not connected, and reports every failure", async () => {
  // The schema is shared with the tests above: their connected accounts would count as stale too, so disconnect them.
  await db.store.transaction(async (tx) => {
    for (const existing of await tx.all("account")) {
      await tx.put("account", { ...existing, status: "disconnected" });
    }
  });
  const account = await addAccount("stale@example.com");
  const other = await addAccount("reauth@example.com");
  const fake = new FakeAdapter({ clock });
  fake.seed(account.id, personal, [timed("2026-09-10", 16, "p1")]);
  fake.seed(account.id, holidays, []);
  fake.seed(other.id, work, [timed("2026-09-10", 18, "w1")]);
  await syncAccount(db.store, clock, fake, account.id);
  await syncAccount(db.store, clock, fake, other.id);
  const [cal, hol] = (await calendarsOf(account.id)) as [Calendar, Calendar];
  const [wrk] = (await calendarsOf(other.id)) as [Calendar];
  okRecord(
    await mutate(db.store, clock, "account", "account.update", neel, async (tx, _c, now) => {
      const current = (await tx.get("account", other.id))!;
      return okMutation("updated", current, { ...current, status: "needs_reauth", version: current.version + 1, updatedAt: now });
    }),
  );
  const adapters = { google: fake };
  const pagesBefore = () => fake.callsTo("syncPage").length;

  let pages = pagesBefore();
  assert.deepEqual(await refreshIfStale(db.store, fixedClock("2026-09-09T12:04:00Z"), adapters, { maxAgeSeconds: 300 }), { refreshed: [], failed: [] }, "four minutes old is fresh");
  assert.equal(pagesBefore(), pages, "and nothing was asked of the provider");

  fake.seed(account.id, work, []);
  await syncAccount(db.store, clock, fake, account.id, { calendarIds: [] }); // reconcile the list only: the new calendar lands unsynced
  const [, , wrk2] = (await calendarsOf(account.id)) as [Calendar, Calendar, Calendar];
  assert.equal(wrk2.syncedAt, null);
  const fresh = await refreshIfStale(db.store, fixedClock("2026-09-09T12:04:00Z"), adapters, { maxAgeSeconds: 300 });
  assert.deepEqual(fresh, { refreshed: [wrk2.id], failed: [] }, "never synced counts as stale; the fresh ones are left alone");

  const at = fixedClock("2026-09-09T12:06:00Z");
  fake.change(account.id, "p1", { title: "Changed" });
  pages = pagesBefore();
  const all = await refreshIfStale(db.store, at, adapters, { maxAgeSeconds: 300 });
  assert.deepEqual(all, { refreshed: [cal.id, hol.id], failed: [] }, "six minutes old is stale; the account needing reauth is skipped; the calendar synced at 12:04 is not stale yet");
  assert.equal(pagesBefore() - pages, 2);
  assert.equal(byExternal(await eventsOf(cal.id), "p1").title, "Changed");
  assert.equal((await getCalendar(cal.id))!.syncedAt, "2026-09-09T12:06:00Z");
  assert.equal((await getCalendar(wrk.id))!.syncedAt, NOW, "the disconnected account's copy was left alone");

  const only = await refreshIfStale(db.store, fixedClock("2026-09-09T12:20:00Z"), adapters, { maxAgeSeconds: 300, calendarIds: [hol.id] });
  assert.deepEqual(only, { refreshed: [hol.id], failed: [] }, "named calendars only");

  const failing = failingOn(fake, personal.id, () => new ProviderUnavailable("down", 503));
  const failed = await refreshIfStale(db.store, fixedClock("2026-09-09T12:30:00Z"), { google: failing }, { maxAgeSeconds: 300 });
  assert.deepEqual(failed, { refreshed: [hol.id, wrk2.id], failed: [{ calendarId: cal.id, error: "ProviderUnavailable: down" }] });
  assert.equal((await getCalendar(cal.id))!.syncError, "ProviderUnavailable: down");

  const none = await refreshIfStale(db.store, fixedClock("2026-09-09T12:40:00Z"), {}, { maxAgeSeconds: 300 });
  assert.deepEqual(none, { refreshed: [], failed: [cal.id, hol.id, wrk2.id].map((calendarId) => ({ calendarId, error: "No google adapter is configured" })) });
});
