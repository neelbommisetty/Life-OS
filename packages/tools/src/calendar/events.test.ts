import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Account, Calendar, Ctx, Event, EventWrite, Receipt } from "../contract.ts";
import { bump, mutate, newId, okMutation } from "../core.ts";
import { createTestDb, fixedClock, type TestDb } from "../db/testing.ts";
import { FakeAdapter, ProviderRejected, ProviderUnavailable, type CalendarAdapter, type ProviderCalendar, type SeedEvent } from "./adapter.ts";
import { createEvents, keyedEventId, type EventOps, type EventReceipt } from "./events.ts";
import { occurrenceRef, type Occurrence } from "./expand.ts";
import { NeedsReauth } from "./google/oauth.ts";
import { syncAccount } from "./sync.ts";

const NOW = "2026-09-09T12:00:00Z";
const LA = "America/Los_Angeles";
const clock = fixedClock(NOW, LA);
const neel: Ctx = { actor: "neel" };

const personal: ProviderCalendar = { id: "neel@example.com", name: "Personal", color: "#0b8043", timezone: LA, writable: true, primary: true, hidden: false };
const side: ProviderCalendar = { id: "side@group.calendar.google.com", name: "Side", color: null, timezone: LA, writable: true, primary: false, hidden: false };
const holidays: ProviderCalendar = { id: "holidays@group.v.calendar.google.com", name: "Holidays", color: null, timezone: "UTC", writable: false, primary: false, hidden: true };
const workMain: ProviderCalendar = { id: "work@example.com", name: "Work", color: "#4285f4", timezone: LA, writable: true, primary: true, hidden: false };
const workPersonal: ProviderCalendar = { id: "personal-at-work@example.com", name: "Personal", color: null, timezone: LA, writable: true, primary: false, hidden: false };

const at = (iso: string): { at: string; timezone: string } => ({ at: iso, timezone: LA });

/** An invitation from someone else, with Neel as an attendee who has not answered. */
const invitation: SeedEvent = {
  id: "inv1",
  title: "Design review",
  notes: "Agenda: the calendar cut",
  location: "Room 1",
  start: at("2026-09-17T17:00:00Z"),
  end: at("2026-09-17T18:00:00Z"),
  organizer: { email: "boss@example.com", name: "Boss", self: false },
  attendees: [
    { email: "boss@example.com", name: "Boss", response: "accepted", self: false, optional: false },
    { email: "neel@example.com", name: null, response: "needsAction", self: true, optional: false },
  ],
  myResponse: "needsAction",
  conferencing: { kind: "meet", url: "https://meet.google.com/abc-defg-hij" },
  reminders: [{ method: "popup", minutes: 10 }],
};

/** An event Neel organises with guests. */
const ownMeeting: SeedEvent = {
  id: "own1",
  title: "Team lunch",
  start: at("2026-09-18T19:00:00Z"),
  end: at("2026-09-18T20:00:00Z"),
  organizer: { email: "neel@example.com", name: null, self: true },
  attendees: [
    { email: "neel@example.com", name: null, response: "accepted", self: true, optional: false },
    { email: "sam@example.com", name: "Sam", response: "needsAction", self: false, optional: false },
  ],
  myResponse: "accepted",
};

let db: TestDb;
let fake: FakeAdapter;
let ops: EventOps;
let home: Account;
let work: Account;
let personalCal: Calendar;
let sideCal: Calendar;
let holidaysCal: Calendar;
let workCal: Calendar;

before(async () => {
  db = await createTestDb();
  fake = new FakeAdapter({ clock });
  home = await addAccount("neel@example.com", true);
  work = await addAccount("work@example.com", false);
  fake.link(home.id, "neel@example.com");
  fake.link(work.id, "work@example.com");
  fake.seed(home.id, personal, [invitation, ownMeeting]);
  fake.seed(home.id, side);
  fake.seed(home.id, holidays, [{ id: "h1", title: "Labor Day", start: { date: "2026-09-07" }, end: { date: "2026-09-08" } }]);
  fake.seed(work.id, workMain);
  fake.seed(work.id, workPersonal);
  await syncAccount(db.store, clock, fake, home.id);
  await syncAccount(db.store, clock, fake, work.id);
  personalCal = await calendarNamed(home.id, "Personal");
  sideCal = await calendarNamed(home.id, "Side");
  holidaysCal = await calendarNamed(home.id, "Holidays");
  workCal = await calendarNamed(work.id, "Work");
  ops = createEvents(db.store, clock, { google: fake });
});
after(() => db.drop());

// ------------------------------------------------------------------ helpers

async function addAccount(identity: string, primary: boolean): Promise<Account> {
  const id = newId("account");
  return okRecord(
    await mutate(db.store, clock, "account", "account.add", neel, async (_tx, _c, now) =>
      okMutation("created", null, { id, provider: "google", identity, label: null, primary, status: "connected", scopes: [], syncedAt: null, version: 1, createdAt: now, updatedAt: now, deletedAt: null }),
    ),
  );
}

function okRecord<R extends Receipt<unknown>>(receipt: R, label = "receipt"): Extract<R, { ok: true }>["record"] {
  assert.equal(receipt.ok, true, `${label}: ${JSON.stringify(receipt)}`);
  if (!receipt.ok) throw new Error("unreachable");
  return (receipt as Extract<R, { ok: true }>).record;
}

function rejectedOf(receipt: EventReceipt): Extract<EventReceipt, { outcome: "rejected" }> {
  assert.equal(receipt.ok, false, `expected a rejection: ${JSON.stringify(receipt)}`);
  assert.equal(receipt.outcome, "rejected");
  if (receipt.ok || receipt.outcome !== "rejected") throw new Error("unreachable");
  return receipt;
}

function rejectedIssues(receipt: EventReceipt): string[] {
  return rejectedOf(receipt).issues;
}

const getEvent = async (id: string): Promise<Event> => {
  const row = await db.store.read((tx) => tx.get("event", id));
  assert.ok(row, `no event row ${id}`);
  return row;
};
const allEvents = () => db.store.read((tx) => tx.all("event", { includeDeleted: true }));
const eventCount = async () => (await allEvents()).length;
const logSize = () => db.store.read(async (tx) => (await tx.allLog()).length);
const historyOf = (id: string) => db.store.read((tx) => tx.history("event", id));
const calendarNamed = async (accountId: string, name: string): Promise<Calendar> => {
  const found = (await db.store.read((tx) => tx.all("calendar"))).find((c) => c.accountId === accountId && c.name === name);
  assert.ok(found, `no calendar ${name} under ${accountId}`);
  return found;
};
const byExternal = async (externalId: string): Promise<Event> => {
  const found = (await allEvents()).find((e) => e.external.id === externalId);
  assert.ok(found, `no row for provider id ${externalId}`);
  return found;
};
const exceptionsOf = async (masterId: string): Promise<Event[]> => (await allEvents()).filter((e) => e.masterId === masterId);
const providerEvent = (externalId: string, accountId = home.id) => {
  const found = fake.event(accountId, externalId);
  assert.ok(found, `the provider has no event ${externalId}`);
  return found;
};
const lastCall = (method: Parameters<FakeAdapter["callsTo"]>[0]) => {
  const call = fake.callsTo(method).at(-1);
  assert.ok(call, `no ${method} call recorded`);
  return call;
};
const startsOf = (list: Occurrence[]): string[] => list.map((o) => ("at" in o.start ? o.start.at : o.start.date));

/** The fake behind an adapter whose `method` fails with `error()` instead of reaching the fake; everything else passes through. */
function failing(inner: FakeAdapter, method: "create" | "update" | "delete" | "instances", error: () => Error): CalendarAdapter {
  return {
    provider: "google",
    connect: (opts) => inner.connect(opts),
    listCalendars: (accountId) => inner.listCalendars(accountId),
    syncPage: (accountId, calendar, cursor, since) => inner.syncPage(accountId, calendar, cursor, since),
    create: (accountId, calendar, event, lifeId) => (method === "create" ? Promise.reject(error()) : inner.create(accountId, calendar, event, lifeId)),
    update: (accountId, calendar, providerId, patch, etag) => (method === "update" ? Promise.reject(error()) : inner.update(accountId, calendar, providerId, patch, etag)),
    delete: (accountId, calendar, providerId) => (method === "delete" ? Promise.reject(error()) : inner.delete(accountId, calendar, providerId)),
    respond: (accountId, calendar, providerId, response) => inner.respond(accountId, calendar, providerId, response),
    move: (accountId, from, to, providerId) => inner.move(accountId, from, to, providerId),
    instances: (accountId, calendar, masterId) => (method === "instances" ? Promise.reject(error()) : inner.instances(accountId, calendar, masterId)),
    instanceId: (masterId, originalStart) => inner.instanceId(masterId, originalStart),
  };
}

const accountStatus = async (id: string): Promise<Account["status"]> => {
  const account = await db.store.read((tx) => tx.get("account", id));
  assert.ok(account, `no account ${id}`);
  return account.status;
};

// ------------------------------------------------------------------ add

let dentist: Event;
let allDay: Event;

test("add writes through: the readback is stored, the receipt carries external, and the default calendar is the primary account's main one", async () => {
  const receipt = await ops.add({ title: "Dentist", start: at("2026-09-15T16:00:00Z"), notes: "Bring the insurance card" }, neel);
  dentist = okRecord(receipt);
  assert.equal(receipt.outcome, "created");
  assert.match(dentist.id, /^e_[a-z0-9]{10}$/);
  assert.equal(receipt.id, dentist.id);
  assert.equal(receipt.version, 1);
  assert.deepEqual(
    { calendarId: dentist.calendarId, accountId: dentist.accountId, title: dentist.title, notes: dentist.notes, start: dentist.start, end: dentist.end, status: dentist.status, busy: dentist.busy, repeat: dentist.repeat, masterId: dentist.masterId, originalStart: dentist.originalStart, deletedAt: dentist.deletedAt },
    { calendarId: personalCal.id, accountId: home.id, title: "Dentist", notes: "Bring the insurance card", start: at("2026-09-15T16:00:00Z"), end: at("2026-09-15T17:00:00Z"), status: "confirmed", busy: true, repeat: null, masterId: null, originalStart: null, deletedAt: null },
    "the end defaults to an hour later and the calendar to the primary account's main one",
  );
  assert.deepEqual(dentist.origin, { actor: "neel", at: NOW, evidence: [] });

  // What the provider handed back is what the row holds.
  const provided = providerEvent(dentist.external.id);
  assert.deepEqual(dentist.external, provided.external);
  assert.equal(dentist.external.provider, "google");
  assert.ok(dentist.external.etag.length > 0);
  assert.deepEqual(dentist.organizer, { email: "neel@example.com", name: null, self: true });
  assert.equal(provided.lifeId, dentist.id, "the Life-OS id is stamped on the provider event");
  const created = lastCall("create");
  assert.deepEqual([created.args[0], created.args[1], created.args[3]], [home.id, personal.id, dentist.id]);
  assert.deepEqual((created.args[2] as EventWrite).end, at("2026-09-15T17:00:00Z"));

  // The row in the database is the record on the receipt, and the log has one entry under Neel.
  assert.deepEqual(await getEvent(dentist.id), dentist);
  const history = await historyOf(dentist.id);
  assert.deepEqual(history.map((e) => [e.op, e.actor, e.recordKind]), [["event.add", "neel", "event"]]);
  assert.equal(history[0]!.patch.title?.to, "Dentist");

  // A sync afterwards finds the etag it already has and writes nothing for it.
  await syncAccount(db.store, clock, fake, home.id);
  assert.equal((await historyOf(dentist.id)).length, 1);
  assert.equal((await getEvent(dentist.id)).version, 1);
});

test("add takes an all-day span, a duration, an explicit end, and a calendar by id, <identity>/<name>, or unique name", async () => {
  allDay = okRecord(await ops.add({ title: "Offsite", start: { date: "2026-09-20" } }, neel));
  assert.deepEqual({ start: allDay.start, end: allDay.end, busy: allDay.busy }, { start: { date: "2026-09-20" }, end: { date: "2026-09-21" }, busy: false }, "an all-day event defaults to one day and free");

  const twoDays = okRecord(await ops.add({ title: "Retreat", start: { date: "2026-10-02" }, duration: 2, calendar: sideCal.id }, neel));
  assert.deepEqual({ end: twoDays.end, calendarId: twoDays.calendarId }, { end: { date: "2026-10-04" }, calendarId: sideCal.id });

  const ninety = okRecord(await ops.add({ title: "Workshop", start: at("2026-09-23T16:00:00Z"), duration: 90, calendar: "neel@example.com/Side" }, neel));
  assert.deepEqual({ end: ninety.end, calendarId: ninety.calendarId }, { end: at("2026-09-23T17:30:00Z"), calendarId: sideCal.id });

  const named = okRecord(await ops.add({ title: "Standup prep", start: at("2026-09-23T15:00:00Z"), end: at("2026-09-23T15:20:00Z"), calendar: "Side", busy: false }, neel));
  assert.deepEqual({ end: named.end, calendarId: named.calendarId, busy: named.busy }, { end: at("2026-09-23T15:20:00Z"), calendarId: sideCal.id, busy: false });

  const other = okRecord(await ops.add({ title: "Work thing", start: at("2026-09-24T16:00:00Z"), calendar: "work@example.com/Work" }, neel));
  assert.deepEqual({ calendarId: other.calendarId, accountId: other.accountId }, { calendarId: workCal.id, accountId: work.id });
  assert.equal(providerEvent(other.external.id, work.id).lifeId, other.id);
});

test("add rejects an unknown, ambiguous, or read-only calendar and an unsound When before calling the provider", async () => {
  const creates = fake.callsTo("create").length;
  const events = await eventCount();

  assert.match(rejectedIssues(await ops.add({ title: "x", start: at("2026-09-15T16:00:00Z"), calendar: "Nope" }, neel))[0]!, /^calendar: no calendar "Nope"/);
  assert.match(rejectedIssues(await ops.add({ title: "x", start: at("2026-09-15T16:00:00Z"), calendar: "Personal" }, neel))[0]!, /names 2 calendars/, "Personal exists in both accounts");
  assert.match(rejectedIssues(await ops.add({ title: "x", start: at("2026-09-15T16:00:00Z"), calendar: "Holidays" }, neel))[0]!, /read-only/);
  assert.match(rejectedIssues(await ops.add({ title: "x", start: at("2026-09-15T16:00:00Z"), calendar: holidaysCal.id }, neel))[0]!, /read-only/);

  assert.match(rejectedIssues(await ops.add({ title: "x", start: at("2026-09-15T16:00:00Z"), end: at("2026-09-15T15:00:00Z") }, neel))[0]!, /^end: End must be after start/);
  assert.match(rejectedIssues(await ops.add({ title: "x", start: at("2026-09-15T16:00:00Z"), end: { date: "2026-09-16" } }, neel))[0]!, /^end: Start and end must both be timed or both be dates/);
  assert.match(rejectedIssues(await ops.add({ title: "x", start: { date: "2026-09-15" }, end: { date: "2026-09-15" } }, neel))[0]!, /^end: End date must be after the start date/);
  assert.match(rejectedIssues(await ops.add({ title: "x", start: { at: "2026-09-15T16:00:00Z", timezone: "Mars/Olympus" } }, neel))[0]!, /^start\.timezone: Unknown timezone/);
  assert.match(rejectedIssues(await ops.add({ title: "x", start: at("2026-09-15T16:00:00Z"), end: at("2026-09-15T17:00:00Z"), duration: 30 }, neel))[0]!, /^duration: Give end or duration, not both/);
  assert.match(rejectedIssues(await ops.add({ title: "x", start: at("2026-09-15T16:00:00Z"), repeat: "every monday" }, neel))[0]!, /^repeat: Not an RRULE/);
  assert.match(rejectedIssues(await ops.add({ title: "x", start: at("2026-09-15T16:00:00Z") }, { actor: "someone" }))[0]!, /^actor:/);

  assert.equal(fake.callsTo("create").length, creates, "no provider call for invalid input");
  assert.equal(await eventCount(), events);
});

test("ProviderUnavailable is rejected with provider_unavailable and leaves no row and no log; ProviderRejected carries the provider's message", async () => {
  const events = await eventCount();
  const log = await logSize();

  fake.failNext(new ProviderUnavailable("Google is not reachable", 503));
  const down = await ops.add({ title: "Lost", start: at("2026-09-16T16:00:00Z") }, { actor: "neel", key: "lost-1" });
  assert.deepEqual(rejectedIssues(down), ["provider_unavailable: Google is not reachable"]);
  assert.equal(down.partial, undefined);
  assert.equal(await eventCount(), events, "nothing stored");
  assert.equal(await logSize(), log, "nothing logged");
  assert.equal(await db.store.read((tx) => tx.getReceipt("lost-1")), null, "a rejection is never stored under the key");

  fake.failNext(new ProviderRejected("Invalid time range", 400));
  const refused = await ops.add({ title: "Refused", start: at("2026-09-16T16:00:00Z") }, neel);
  assert.deepEqual(rejectedIssues(refused), ["provider_rejected: Invalid time range"]);
  assert.equal(await eventCount(), events);
  assert.equal(await logSize(), log);

  // The same on an update: the row keeps its version and the log grows by nothing.
  fake.failNext(new ProviderUnavailable("timeout", 504));
  const stuck = rejectedOf(await ops.update(dentist.id, { title: "Dentist (moved)" }, neel));
  assert.equal(stuck.issues[0], "provider_unavailable: timeout");
  assert.equal(stuck.id, dentist.id);
  assert.equal(stuck.record?.title, "Dentist");
  assert.deepEqual(await getEvent(dentist.id), dentist);
  assert.equal(await logSize(), log);
});

test("a credential the provider no longer accepts rejects the write with needs_reauth, stores nothing for the event, and marks the account until it is reconnected", async () => {
  const events = await eventCount();
  const log = await logSize();
  assert.equal(await accountStatus(home.id), "connected");

  fake.failNext(new NeedsReauth(home.id));
  const receipt = rejectedOf(await ops.update(dentist.id, { title: "Dentist (revoked)" }, neel));
  assert.deepEqual(receipt.issues, [`needs_reauth: Google access for ${home.id} needs to be granted again`]);
  assert.deepEqual({ id: receipt.id, version: receipt.record?.version, partial: receipt.partial }, { id: dentist.id, version: dentist.version, partial: undefined });
  assert.deepEqual(await getEvent(dentist.id), dentist, "the row is untouched");
  assert.equal(await eventCount(), events);
  assert.equal(await accountStatus(home.id), "needs_reauth", "the account is marked");
  assert.equal(await logSize(), log + 1, "the account's status is the only write");
  const entry = (await db.store.read((tx) => tx.history("account", home.id))).at(-1)!;
  assert.deepEqual({ op: entry.op, actor: entry.actor, status: entry.patch.status }, { op: "account.sync", actor: "import:google", status: { from: "connected", to: "needs_reauth" } }, "the same account.sync write sync makes");

  // Until it is reconnected, writes on its calendars are refused before any provider call, and the primary account's default calendar is out of reach.
  const calls = fake.calls.length;
  assert.match(rejectedIssues(await ops.add({ title: "Blocked", start: at("2026-09-16T16:00:00Z") }, neel))[0]!, /^account: "neel@example.com" is needs_reauth; run life account add google/);
  assert.match(rejectedIssues(await ops.update(dentist.id, { title: "Blocked" }, neel))[0]!, /is needs_reauth/);
  assert.equal(fake.calls.length, calls, "no provider call while the account needs reauth");
  assert.equal(await logSize(), log + 1);

  // A second dead credential on an account already marked writes nothing more.
  await mutate(db.store, clock, "account", "account.update", neel, async (tx, _c, now) => {
    const current = (await tx.get("account", home.id))!;
    return okMutation("updated", current, bump({ ...current, status: "connected" }, now));
  });
  assert.equal(await accountStatus(home.id), "connected");
});

test("the key-derived id makes a retry meet its own row: a replay returns the receipt, a row synced back is unchanged", async () => {
  assert.match(keyedEventId("retry-1"), /^e_[a-z0-9]{10}$/);
  assert.equal(keyedEventId("retry-1"), keyedEventId("retry-1"));
  assert.notEqual(keyedEventId("retry-1"), keyedEventId("retry-2"));

  // A keyed add creates under the derived id; the same call again replays the stored receipt without a second provider call.
  const first = await ops.add({ title: "Keyed", start: at("2026-09-16T18:00:00Z") }, { actor: "neel", key: "add-keyed-1" });
  const created = okRecord(first);
  assert.equal(created.id, keyedEventId("add-keyed-1"));
  const creates = fake.callsTo("create").length;
  const again = await ops.add({ title: "Keyed", start: at("2026-09-16T18:00:00Z") }, { actor: "neel", key: "add-keyed-1" });
  assert.deepEqual(again, first);
  assert.equal(fake.callsTo("create").length, creates);

  // The provider took the create but the local write never landed: sync brings the event back under its lifeId, and the retry meets it.
  const id = keyedEventId("add-keyed-2");
  const write: EventWrite = { title: "Landed at Google only", notes: null, location: null, start: at("2026-09-16T20:00:00Z"), end: at("2026-09-16T21:00:00Z"), repeat: null, busy: true, status: "confirmed" };
  await fake.create(home.id, personal.id, write, id);
  await syncAccount(db.store, clock, fake, home.id);
  const synced = await getEvent(id);
  assert.equal(synced.origin.actor, "import:google");
  const before = { creates: fake.callsTo("create").length, log: await logSize() };
  const retry = await ops.add({ title: "Landed at Google only", start: at("2026-09-16T20:00:00Z") }, { actor: "neel", key: "add-keyed-2" });
  assert.equal(retry.outcome, "unchanged");
  assert.equal(retry.id, id);
  assert.deepEqual(okRecord(retry), synced);
  assert.equal(fake.callsTo("create").length, before.creates, "no second create");
  assert.equal(await logSize(), before.log, "unchanged logs nothing");
  assert.equal(await db.store.read((tx) => tx.getReceipt("add-keyed-2")), null, "unchanged stores no receipt under the key");
});

// ------------------------------------------------------------------ get and list

let standup: Event;

test("get returns a row by id or one occurrence by ref; list expands the window through eventsInRange, sorted by start", async () => {
  standup = okRecord(await ops.add({ title: "Standup", start: at("2026-09-14T16:00:00Z"), duration: 15, repeat: "RRULE:FREQ=WEEKLY;BYDAY=MO" }, neel));
  assert.deepEqual(standup.repeat, { rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO", exdates: [] });

  assert.deepEqual(await ops.get(standup.id), standup);
  const second = await ops.get(occurrenceRef(standup.id, "2026-09-21T16:00:00Z"));
  assert.ok(second && "occurrenceId" in second, "an occurrence ref returns an occurrence");
  assert.deepEqual(
    { occurrenceId: second.occurrenceId, start: second.start, end: second.end, originalStart: second.originalStart, master: second.master, id: second.id },
    { occurrenceId: `${standup.id}@2026-09-21T16:00:00Z`, start: at("2026-09-21T16:00:00Z"), end: at("2026-09-21T16:15:00Z"), originalStart: at("2026-09-21T16:00:00Z"), master: true, id: standup.id },
  );
  assert.equal(await ops.get(occurrenceRef(standup.id, "2026-09-22T16:00:00Z")), null, "not a slot of the rule");
  assert.equal(await ops.get("e_0000000000"), null);
  assert.equal(await ops.get("not an id"), null);

  const week = await ops.list({ from: "2026-09-14", to: "2026-09-20" });
  assert.deepEqual(
    week.map((o) => [o.occurrenceId, o.title]),
    [
      [`${standup.id}@2026-09-14T16:00:00Z`, "Standup"],
      [`${dentist.id}@2026-09-15T16:00:00Z`, "Dentist"],
      [`${keyedEventId("add-keyed-1")}@2026-09-16T18:00:00Z`, "Keyed"],
      [`${keyedEventId("add-keyed-2")}@2026-09-16T20:00:00Z`, "Landed at Google only"],
      [`${(await byExternal("inv1")).id}@2026-09-17T17:00:00Z`, "Design review"],
      [`${(await byExternal("own1")).id}@2026-09-18T19:00:00Z`, "Team lunch"],
      [`${allDay.id}@2026-09-20`, "Offsite"],
    ],
    "dates bound whole days in the display zone; hidden calendars are left out",
  );

  const month = await ops.list({ from: "2026-09-14T00:00:00Z", to: "2026-10-12T00:00:00Z", calendars: [personalCal.id] });
  assert.deepEqual(startsOf(month.filter((o) => o.id === standup.id)), ["2026-09-14T16:00:00Z", "2026-09-21T16:00:00Z", "2026-09-28T16:00:00Z", "2026-10-05T16:00:00Z"]);
  assert.ok(month.every((o) => o.calendarId === personalCal.id));

  const sideOnly = await ops.list({ from: "2026-09-01", to: "2026-10-31", calendars: ["Side"] });
  assert.deepEqual(sideOnly.map((o) => o.title), ["Standup prep", "Workshop", "Retreat"]);

  const hidden = await ops.list({ from: "2026-09-07", to: "2026-09-07", includeHidden: true });
  assert.deepEqual(hidden.map((o) => o.title), ["Labor Day"]);
  assert.deepEqual(await ops.list({ from: "2026-09-07", to: "2026-09-07" }), [], "an empty window is an empty list, not a failure");

  await assert.rejects(ops.list({ from: "2026-09-20", to: "2026-09-14" }), /to: must be after from/);
  await assert.rejects(ops.list({ from: "soon", to: "2026-09-14" }), /from: not a date or instant/);
  await assert.rejects(ops.list({ from: "2026-09-14", to: "2026-09-20", calendars: ["Nope"] }), /no calendar "Nope"/);
});

// ------------------------------------------------------------------ scopes

test("an update on a repeating event without a scope is a needs rejection that changes nothing", async () => {
  const updates = fake.callsTo("update").length;
  const log = await logSize();

  const receipt = rejectedOf(await ops.update(standup.id, { title: "Daily" }, neel));
  assert.deepEqual({ field: receipt.needs?.field, options: receipt.needs?.options }, { field: "scope", options: ["this", "following", "all"] });
  assert.equal(typeof receipt.needs?.message, "string");
  assert.deepEqual(receipt.issues, [receipt.needs!.message]);
  assert.equal(receipt.id, standup.id);
  assert.equal(receipt.record?.version, standup.version);

  const onOccurrence = rejectedOf(await ops.reschedule(occurrenceRef(standup.id, "2026-09-21T16:00:00Z"), { start: at("2026-09-21T17:00:00Z") }, neel));
  assert.equal(onOccurrence.needs?.field, "scope");

  assert.match(rejectedIssues(await ops.update(standup.id, { title: "Daily" }, neel, { scope: "this" }))[0]!, /needs an occurrence ref/);
  assert.match(rejectedIssues(await ops.update(standup.id, { title: "Daily" }, neel, { scope: "weekly" as "this" }))[0]!, /^scope:/);

  const single = okRecord(await ops.update(dentist.id, { location: "Suite 4" }, neel, { scope: "all" }));
  assert.equal(single.location, "Suite 4", "a single event takes any scope without complaint");
  dentist = single;

  assert.equal(fake.callsTo("update").length, updates + 1);
  assert.equal(await logSize(), log + 1);
  assert.deepEqual(await getEvent(standup.id), standup);
});

let movedStandup: Event;

test("scope this patches the provider instance and yields an exception row that stands in for the slot", async () => {
  const ref = occurrenceRef(standup.id, "2026-09-21T16:00:00Z");
  const receipt = await ops.reschedule(ref, { start: at("2026-09-21T17:00:00Z") }, neel, { scope: "this" });
  movedStandup = okRecord(receipt);
  assert.equal(receipt.outcome, "created");
  assert.notEqual(movedStandup.id, standup.id);
  assert.deepEqual(
    { masterId: movedStandup.masterId, originalStart: movedStandup.originalStart, start: movedStandup.start, end: movedStandup.end, repeat: movedStandup.repeat, title: movedStandup.title, calendarId: movedStandup.calendarId },
    { masterId: standup.id, originalStart: at("2026-09-21T16:00:00Z"), start: at("2026-09-21T17:00:00Z"), end: at("2026-09-21T17:15:00Z"), repeat: null, title: "Standup", calendarId: personalCal.id },
    "the duration is kept and the row points at its master and original slot",
  );
  const instanceId = fake.instanceId(standup.external.id, at("2026-09-21T16:00:00Z"));
  assert.equal(movedStandup.external.id, instanceId);
  assert.equal(lastCall("update").args[2], instanceId, "the provider instance was patched, not the master");
  assert.deepEqual(await getEvent(standup.id), standup, "the master is untouched");

  const day = await ops.list({ from: "2026-09-21", to: "2026-09-21" });
  const standups = day.filter((o) => o.masterId === standup.id || o.id === standup.id);
  assert.equal(standups.length, 1, "the exception replaces the slot");
  assert.deepEqual({ occurrenceId: standups[0]!.occurrenceId, id: standups[0]!.id, start: standups[0]!.start, master: standups[0]!.master }, { occurrenceId: ref, id: movedStandup.id, start: at("2026-09-21T17:00:00Z"), master: false });

  // The same ref again patches the exception row itself; the bare row id works too and still asks for a scope.
  const retitled = await ops.update(ref, { title: "Standup (late)" }, neel, { scope: "this" });
  assert.equal(retitled.outcome, "updated");
  assert.equal(retitled.id, movedStandup.id);
  assert.equal(okRecord(retitled).title, "Standup (late)");
  assert.equal(lastCall("update").args[2], instanceId);
  assert.equal(rejectedOf(await ops.update(movedStandup.id, { notes: "x" }, neel)).needs?.field, "scope");
  movedStandup = okRecord(await ops.update(movedStandup.id, { notes: "Moved for the dentist" }, neel, { scope: "this" }));
  assert.equal(movedStandup.notes, "Moved for the dentist");
  assert.match(rejectedIssues(await ops.update(ref, { repeat: "RRULE:FREQ=DAILY" }, neel, { scope: "this" }))[0]!, /^repeat:/, "an occurrence cannot carry a rule");

  assert.deepEqual((await historyOf(movedStandup.id)).map((e) => e.op), ["event.reschedule", "event.update", "event.update"]);
});

test("scope all shifts the whole series by the same delta and keeps the exception rows in step", async () => {
  const yoga = okRecord(await ops.add({ title: "Yoga", start: at("2026-09-15T13:00:00Z"), repeat: "RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=6" }, neel));
  const noted = okRecord(await ops.update(occurrenceRef(yoga.id, "2026-09-22T13:00:00Z"), { notes: "Bring the mat" }, neel, { scope: "this" }));
  assert.equal(noted.masterId, yoga.id);

  const receipt = await ops.reschedule(occurrenceRef(yoga.id, "2026-09-29T13:00:00Z"), { start: at("2026-09-29T14:00:00Z") }, neel, { scope: "all" });
  const shifted = okRecord(receipt);
  assert.equal(receipt.outcome, "updated");
  assert.equal(shifted.id, yoga.id, "the master is the record");
  assert.deepEqual({ start: shifted.start, end: shifted.end, rule: shifted.repeat?.rrule }, { start: at("2026-09-15T14:00:00Z"), end: at("2026-09-15T15:00:00Z"), rule: "RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=6" });
  assert.equal(lastCall("update").args[2], yoga.external.id, "the master was patched at the provider");

  // The exception rows are what the provider handed back, not a local shift: Google re-keys them from the new start.
  assert.deepEqual(lastCall("instances").args, [home.id, personal.id, yoga.external.id], "the occurrences were read back through the provider");
  const exception = await getEvent(noted.id);
  assert.deepEqual({ originalStart: exception.originalStart, start: exception.start, end: exception.end, notes: exception.notes }, { originalStart: at("2026-09-22T14:00:00Z"), start: at("2026-09-22T14:00:00Z"), end: at("2026-09-22T15:00:00Z"), notes: "Bring the mat" });
  assert.equal(exception.external.id, fake.instanceId(yoga.external.id, at("2026-09-22T14:00:00Z")), "the row names the provider's new instance id");
  assert.notEqual(exception.external.id, noted.external.id);
  assert.deepEqual(exception.external, providerEvent(exception.external.id).external, "etag and all, from the readback");
  assert.equal(fake.event(home.id, noted.external.id), null, "the provider no longer has the old instance");
  assert.equal(exception.version, noted.version + 1);
  assert.deepEqual((await historyOf(noted.id)).map((e) => e.op), ["event.update", "event.reschedule"]);

  const all = (await ops.list({ from: "2026-09-15", to: "2026-10-31" })).filter((o) => o.id === yoga.id || o.masterId === yoga.id);
  assert.deepEqual(startsOf(all), ["2026-09-15T14:00:00Z", "2026-09-22T14:00:00Z", "2026-09-29T14:00:00Z", "2026-10-06T14:00:00Z", "2026-10-13T14:00:00Z", "2026-10-20T14:00:00Z"]);
  assert.equal(all[1]!.id, noted.id, "the exception still stands in for its slot");

  // The copy has converged: a sync afterwards finds every etag it already has and no instance it lacks a row for.
  const histories = [(await historyOf(yoga.id)).length, (await historyOf(noted.id)).length];
  await syncAccount(db.store, clock, fake, home.id);
  assert.deepEqual([(await historyOf(yoga.id)).length, (await historyOf(noted.id)).length], histories, "nothing to reconcile after the readback");
  assert.equal((await exceptionsOf(yoga.id)).length, 1, "and no second row for the re-keyed instance");

  const retitled = okRecord(await ops.update(yoga.id, { title: "Yoga flow" }, neel, { scope: "all" }));
  assert.equal(retitled.title, "Yoga flow");
  assert.equal(retitled.version, 3);
  assert.equal(fake.callsTo("instances").length, 1, "a change that leaves the occurrences alone does not read them back");

  // Dropping the rule drops the exception rows at the provider, and the readback puts them in the trash.
  const single = okRecord(await ops.update(yoga.id, { repeat: null }, neel, { scope: "all" }));
  assert.equal(single.repeat, null);
  assert.equal(providerEvent(exception.external.id).deleted, true, "the provider deleted the instance with the rule");
  assert.equal((await getEvent(noted.id)).deletedAt, NOW, "and the row followed");
  assert.equal(fake.callsTo("instances").length, 2);
});

test("an all-scope time change whose readback fails is rejected with partial and stores nothing; one the provider forgot an occurrence on trashes that row and warns", async () => {
  const piano = okRecord(await ops.add({ title: "Piano", start: at("2026-09-16T01:00:00Z"), duration: 30, repeat: "RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=4" }, neel));
  const room = okRecord(await ops.update(occurrenceRef(piano.id, "2026-09-23T01:00:00Z"), { location: "Room B" }, neel, { scope: "this" }));
  const events = await eventCount();
  const log = await logSize();

  const flaky = createEvents(db.store, clock, { google: failing(fake, "instances", () => new ProviderUnavailable("timeout", 504)) });
  const receipt = rejectedOf(await flaky.reschedule(piano.id, { start: at("2026-09-16T02:00:00Z") }, neel, { scope: "all" }));
  assert.equal(receipt.partial, true);
  assert.equal(receipt.issues[0], "provider_unavailable: timeout");
  assert.ok(receipt.issues.some((issue) => issue.startsWith("partial:") && issue.includes(piano.id)), JSON.stringify(receipt.issues));
  assert.deepEqual(await getEvent(piano.id), piano, "the local master is untouched");
  assert.deepEqual(await getEvent(room.id), room);
  assert.equal(await eventCount(), events);
  assert.equal(await logSize(), log);
  assert.deepEqual(providerEvent(piano.external.id).start, at("2026-09-16T02:00:00Z"), "the provider already holds the change");

  // The provider now holds the series an hour later and the exception re-keyed; forget that exception provider-side, then change the series again.
  const rekeyed = fake.instanceId(piano.external.id, at("2026-09-23T02:00:00Z"));
  assert.ok(fake.event(home.id, rekeyed), "the provider re-keyed the exception when the master moved");
  fake.remove(home.id, rekeyed);
  const synced = await syncAccount(db.store, clock, fake, home.id);
  assert.ok(synced.calendars.every((c) => c.outcome !== "failed"));
  const shiftedReceipt = await ops.reschedule(piano.id, { start: at("2026-09-16T03:00:00Z") }, neel, { scope: "all" });
  const shifted = okRecord(shiftedReceipt);
  assert.deepEqual({ start: shifted.start, partial: shiftedReceipt.partial }, { start: at("2026-09-16T03:00:00Z"), partial: undefined });
  assert.equal(shiftedReceipt.warnings?.length, 1);
  assert.ok(shiftedReceipt.warnings![0]!.includes(room.id) && shiftedReceipt.warnings![0]!.includes("2026-09-23T01:00:00Z"), `the warning names the row and its slot: ${shiftedReceipt.warnings![0]}`);
  const dropped = await getEvent(room.id);
  assert.equal(dropped.deletedAt, NOW, "a row the provider no longer lists goes to the trash");
  assert.equal((await historyOf(room.id)).at(-1)!.op, "event.reschedule");
  const occurrences = (await ops.list({ from: "2026-09-15", to: "2026-10-15" })).filter((o) => o.id === piano.id || o.masterId === piano.id);
  assert.deepEqual(startsOf(occurrences), ["2026-09-16T03:00:00Z", "2026-09-23T03:00:00Z", "2026-09-30T03:00:00Z", "2026-10-07T03:00:00Z"], "the rule lays the slot out again");
});

test("scope following splits the series: a new id continues from the occurrence, the truncated original is named in warnings", async () => {
  const review = okRecord(await ops.add({ title: "Review", start: at("2026-09-16T20:00:00Z"), duration: 30, repeat: "RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=8" }, neel));
  const later = okRecord(await ops.update(occurrenceRef(review.id, "2026-10-14T20:00:00Z"), { location: "Room 9" }, neel, { scope: "this" }));
  const calls = fake.calls.length;

  const receipt = await ops.update(occurrenceRef(review.id, "2026-10-07T20:00:00Z"), { title: "Review v2", location: "Room 2" }, neel, { scope: "following" });
  const next = okRecord(receipt);
  assert.equal(receipt.outcome, "created");
  assert.notEqual(next.id, review.id);
  assert.deepEqual(receipt.issues, []);
  assert.equal(receipt.partial, undefined);
  assert.equal(receipt.warnings?.length, 1);
  assert.ok(receipt.warnings![0]!.includes(review.id), `warnings name the truncated original: ${receipt.warnings![0]}`);
  assert.deepEqual(
    { title: next.title, location: next.location, start: next.start, end: next.end, rule: next.repeat?.rrule, masterId: next.masterId, calendarId: next.calendarId },
    { title: "Review v2", location: "Room 2", start: at("2026-10-07T20:00:00Z"), end: at("2026-10-07T20:30:00Z"), rule: "RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=5", masterId: null, calendarId: personalCal.id },
    "the new series starts at the occurrence with what COUNT has left",
  );
  assert.equal(providerEvent(next.external.id).lifeId, next.id);

  const truncated = await getEvent(review.id);
  assert.deepEqual({ rule: truncated.repeat?.rrule, title: truncated.title, version: truncated.version }, { rule: "RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261007T195959Z", title: "Review", version: 2 });
  assert.equal((await getEvent(later.id)).deletedAt, NOW, "an exception after the split goes with the truncated part");

  assert.deepEqual(fake.calls.slice(calls).map((c) => c.method), ["update", "create"], "two provider calls, the truncation first");
  assert.equal(fake.calls[calls]!.args[2], review.external.id);

  const all = (await ops.list({ from: "2026-09-16", to: "2026-11-04" })).filter((o) => [review.id, next.id].includes(o.id));
  assert.deepEqual(
    all.map((o) => [o.id === review.id ? "old" : "new", o.title, o.originalStart]),
    [
      ["old", "Review", at("2026-09-16T20:00:00Z")],
      ["old", "Review", at("2026-09-23T20:00:00Z")],
      ["old", "Review", at("2026-09-30T20:00:00Z")],
      ["new", "Review v2", at("2026-10-07T20:00:00Z")],
      ["new", "Review v2", at("2026-10-14T20:00:00Z")],
      ["new", "Review v2", at("2026-10-21T20:00:00Z")],
      ["new", "Review v2", at("2026-10-28T20:00:00Z")],
      ["new", "Review v2", at("2026-11-04T21:00:00Z")],
    ],
    "eight in all, and the wall clock holds across the DST change",
  );
  const truncation = await historyOf(review.id);
  assert.deepEqual(truncation.map((e) => e.op), ["event.add", "event.update"]);
  assert.deepEqual(Object.keys(truncation[1]!.patch).sort(), ["external", "repeat"], "the truncation logs the new rule and etag on the original");
  assert.deepEqual((await historyOf(next.id)).map((e) => e.op), ["event.update"]);

  // Following from the first occurrence is the whole series.
  const whole = await ops.update(occurrenceRef(next.id, "2026-10-07T20:00:00Z"), { busy: false }, neel, { scope: "following" });
  assert.deepEqual({ outcome: whole.outcome, id: whole.id, warnings: whole.warnings }, { outcome: "updated", id: next.id, warnings: undefined });

  // Splitting a series that already ends with UNTIL keeps that bound on the tail.
  const tail = okRecord(await ops.update(occurrenceRef(truncated.id, "2026-09-30T20:00:00Z"), { title: "Review (last)" }, neel, { scope: "following" }));
  assert.equal(tail.repeat?.rrule, "RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261007T195959Z");
  assert.equal((await getEvent(truncated.id)).repeat?.rrule, "RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20260930T195959Z");
  const tailOccurrences = (await ops.list({ from: "2026-09-16", to: "2026-11-04" })).filter((o) => o.id === tail.id);
  assert.deepEqual(startsOf(tailOccurrences), ["2026-09-30T20:00:00Z"]);
});

test("a following split whose second call fails is rejected with partial and stores nothing; the next sync shows the truncated series", async () => {
  const sprint = okRecord(await ops.add({ title: "Sprint", start: at("2026-09-17T15:00:00Z"), repeat: "RRULE:FREQ=WEEKLY;BYDAY=TH" }, neel));
  const flaky = createEvents(db.store, clock, { google: failing(fake, "create", () => new ProviderUnavailable("timeout", 504)) });
  const events = await eventCount();
  const log = await logSize();

  const receipt = rejectedOf(await flaky.update(occurrenceRef(sprint.id, "2026-10-01T15:00:00Z"), { title: "Sprint 2" }, neel, { scope: "following" }));
  assert.equal(receipt.partial, true);
  assert.equal(receipt.issues[0], "provider_unavailable: timeout");
  assert.ok(receipt.issues.some((issue) => issue.startsWith("partial:") && issue.includes(sprint.id)), JSON.stringify(receipt.issues));
  assert.equal(receipt.id, sprint.id);

  assert.deepEqual(await getEvent(sprint.id), sprint, "the local master is untouched");
  assert.equal(await eventCount(), events);
  assert.equal(await logSize(), log);
  assert.equal(providerEvent(sprint.external.id).repeat?.rrule, "RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261001T145959Z", "the provider already holds the truncation");

  await syncAccount(db.store, clock, fake, home.id);
  const after = await getEvent(sprint.id);
  assert.deepEqual({ rule: after.repeat?.rrule, version: after.version }, { rule: "RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261001T145959Z", version: 2 });
  assert.deepEqual((await historyOf(sprint.id)).at(-1)!.actor, "import:google");

  // A failure on the first call is a plain rejection, not partial.
  const first = rejectedOf(await createEvents(db.store, clock, { google: failing(fake, "update", () => new ProviderRejected("Forbidden", 403)) }).update(occurrenceRef(sprint.id, "2026-09-24T15:00:00Z"), { title: "x" }, neel, { scope: "following" }));
  assert.deepEqual({ partial: first.partial, issues: first.issues }, { partial: undefined, issues: ["provider_rejected: Forbidden"] });
});

// ------------------------------------------------------------------ reschedule, move

test("reschedule keeps the duration when end is omitted, takes a new end when given, and is unchanged for the same time", async () => {
  const moved = okRecord(await ops.reschedule(dentist.id, { start: at("2026-09-16T18:00:00Z") }, neel));
  assert.deepEqual({ start: moved.start, end: moved.end }, { start: at("2026-09-16T18:00:00Z"), end: at("2026-09-16T19:00:00Z") });
  const longer = okRecord(await ops.reschedule(dentist.id, { start: at("2026-09-16T18:00:00Z"), end: at("2026-09-16T19:30:00Z") }, neel));
  assert.deepEqual(longer.end, at("2026-09-16T19:30:00Z"));
  const same = await ops.reschedule(dentist.id, { start: at("2026-09-16T18:00:00Z") }, neel);
  assert.equal(same.outcome, "unchanged");
  assert.deepEqual((await historyOf(dentist.id)).map((e) => e.op), ["event.add", "event.update", "event.reschedule", "event.reschedule"]);

  assert.match(rejectedIssues(await ops.reschedule(dentist.id, { start: { date: "2026-09-16" } }, neel))[0]!, /^end: give end or duration when changing between timed and all-day/);
  assert.match(rejectedIssues(await ops.reschedule(dentist.id, { start: at("2026-09-16T18:00:00Z"), end: at("2026-09-16T17:00:00Z") }, neel))[0]!, /^end: End must be after start/);
  const stale = rejectedOf(await ops.reschedule(dentist.id, { start: at("2026-09-17T18:00:00Z") }, { actor: "neel", ifVersion: 1 }));
  assert.match(stale.issues[0]!, /^version: expected 1, current is 4/);
  assert.equal(stale.record?.version, 4);

  const floating = okRecord(await ops.reschedule(dentist.id, { start: { at: "2026-09-16T18:00:00Z", timezone: null } }, neel));
  assert.deepEqual({ start: floating.start, end: floating.end }, { start: { at: "2026-09-16T18:00:00Z", timezone: null }, end: { at: "2026-09-16T19:30:00Z", timezone: null } }, "a floating start makes a floating end");
  dentist = okRecord(await ops.reschedule(dentist.id, { start: at("2026-09-16T18:00:00Z") }, neel));
});

test("move is a provider move: the provider id, the guests, and the exception rows stay with the event; across accounts it is rejected with a hint", async () => {
  const creates = fake.callsTo("create").length;
  const deletes = fake.callsTo("delete").length;
  const receipt = await ops.move(dentist.id, "Side", neel);
  const moved = okRecord(receipt);
  assert.equal(receipt.outcome, "updated");
  assert.deepEqual(
    { id: moved.id, calendarId: moved.calendarId, accountId: moved.accountId, title: moved.title, start: moved.start, external: moved.external.id },
    { id: dentist.id, calendarId: sideCal.id, accountId: home.id, title: "Dentist", start: dentist.start, external: dentist.external.id },
    "same row, same provider id, new calendar",
  );
  assert.deepEqual(lastCall("move").args, [home.id, personal.id, side.id, dentist.external.id]);
  assert.deepEqual([fake.callsTo("create").length, fake.callsTo("delete").length], [creates, deletes], "no create, no delete: the provider moved it");
  assert.ok(fake.events(home.id, side.id).some((e) => e.external.id === dentist.external.id), "the provider holds it in the destination");
  assert.ok(!fake.events(home.id, personal.id).some((e) => e.external.id === dentist.external.id), "and not in the source");
  assert.deepEqual(moved.external, providerEvent(dentist.external.id).external, "the row holds the readback");
  assert.equal((await ops.move(dentist.id, sideCal.id, neel)).outcome, "unchanged");

  // A meeting with guests keeps its guests, organizer, and identity; a recreate would have lost them.
  const lunch = await byExternal("own1");
  const movedLunch = okRecord(await ops.move(lunch.id, "Side", neel));
  assert.deepEqual(
    { external: movedLunch.external.id, iCalUID: movedLunch.external.iCalUID, attendees: movedLunch.attendees, organizer: movedLunch.organizer, myResponse: movedLunch.myResponse, calendarId: movedLunch.calendarId },
    { external: "own1", iCalUID: lunch.external.iCalUID, attendees: lunch.attendees, organizer: lunch.organizer, myResponse: "accepted", calendarId: sideCal.id },
  );

  // A series takes its exception rows along; they are read back from the destination rather than re-pointed locally.
  const gym = okRecord(await ops.add({ title: "Gym", start: at("2026-11-10T01:00:00Z"), repeat: "RRULE:FREQ=DAILY;COUNT=5" }, neel));
  const late = okRecord(await ops.reschedule(occurrenceRef(gym.id, "2026-11-12T01:00:00Z"), { start: at("2026-11-12T02:00:00Z") }, neel, { scope: "this" }));
  const movedGym = okRecord(await ops.move(gym.id, "Side", neel));
  assert.deepEqual({ external: movedGym.external.id, calendarId: movedGym.calendarId, rule: movedGym.repeat?.rrule }, { external: gym.external.id, calendarId: sideCal.id, rule: "RRULE:FREQ=DAILY;COUNT=5" });
  assert.deepEqual(lastCall("instances").args, [home.id, side.id, gym.external.id], "the exception rows were read back from the destination");
  const movedLate = await getEvent(late.id);
  assert.deepEqual(
    { calendarId: movedLate.calendarId, accountId: movedLate.accountId, external: movedLate.external.id, masterId: movedLate.masterId, start: movedLate.start, deletedAt: movedLate.deletedAt },
    { calendarId: sideCal.id, accountId: home.id, external: late.external.id, masterId: gym.id, start: at("2026-11-12T02:00:00Z"), deletedAt: null },
  );
  assert.deepEqual(movedLate.external, providerEvent(late.external.id).external, "the exception row holds the provider's readback");
  const inSide = (await ops.list({ from: "2026-11-11", to: "2026-11-11", calendars: ["Side"] })).filter((o) => o.id === gym.id || o.masterId === gym.id);
  assert.deepEqual(inSide.map((o) => [o.id, o.start]), [[late.id, at("2026-11-12T02:00:00Z")]], "the moved exception still stands in for its slot");

  const across = rejectedOf(await ops.move(dentist.id, "work@example.com/Work", neel));
  assert.match(across.issues[0]!, /another account/);
  assert.match(across.issues[0]!, /event duplicate .* then event delete/);
  assert.equal((await getEvent(dentist.id)).calendarId, sideCal.id);

  assert.match(rejectedIssues(await ops.move(occurrenceRef(standup.id, "2026-09-28T16:00:00Z"), "Side", neel))[0]!, /not one occurrence/);
  assert.match(rejectedIssues(await ops.move(movedStandup.id, "Side", neel))[0]!, /not one occurrence/);
  assert.match(rejectedIssues(await ops.move(dentist.id, "Holidays", neel))[0]!, /read-only/);
  dentist = moved;
});

// ------------------------------------------------------------------ respond, cancel

test("respond answers only when Neel is an attendee", async () => {
  const invited = await byExternal("inv1");
  assert.equal(invited.myResponse, "needsAction");
  const receipt = await ops.respond(invited.id, "accepted", neel);
  const answered = okRecord(receipt);
  assert.equal(receipt.outcome, "updated");
  assert.equal(answered.myResponse, "accepted");
  assert.equal(answered.attendees.find((a) => a.self)?.response, "accepted");
  assert.deepEqual(lastCall("respond").args, [home.id, personal.id, "inv1", "accepted"]);
  assert.equal(providerEvent("inv1").myResponse, "accepted");
  assert.equal((await ops.respond(invited.id, "accepted", neel)).outcome, "unchanged");
  assert.equal(okRecord(await ops.respond(invited.id, "tentative", { actor: "codex", reason: "Neel said maybe" })).myResponse, "tentative");
  assert.deepEqual((await historyOf(invited.id)).map((e) => [e.op, e.actor]), [["event.sync", "import:google"], ["event.respond", "neel"], ["event.respond", "codex"]]);

  const responds = fake.callsTo("respond").length;
  assert.match(rejectedIssues(await ops.respond(dentist.id, "accepted", neel))[0]!, /^attendees: you are not an attendee/);
  assert.match(rejectedIssues(await ops.respond(invited.id, "maybe" as "accepted", neel))[0]!, /^response:/);
  assert.equal(fake.callsTo("respond").length, responds);
});

test("cancel needs the organizer and a reason; the row stays visible as cancelled, not deleted", async () => {
  const own = await byExternal("own1");
  const invited = await byExternal("inv1");
  assert.deepEqual(rejectedIssues(await ops.cancel(own.id, neel)), ["reason: cancel needs a reason"]);
  assert.match(rejectedIssues(await ops.cancel(invited.id, { actor: "neel", reason: "cannot make it" }))[0]!, /^organizer: only the organizer can cancel/);
  assert.equal((await getEvent(own.id)).status, "confirmed");

  const receipt = await ops.cancel(own.id, { actor: "neel", reason: "Trip moved" });
  const cancelled = okRecord(receipt);
  assert.equal(receipt.outcome, "updated");
  assert.deepEqual({ status: cancelled.status, deletedAt: cancelled.deletedAt, attendees: cancelled.attendees.length }, { status: "cancelled", deletedAt: null, attendees: 2 });
  assert.equal(providerEvent("own1").status, "cancelled");
  assert.deepEqual(lastCall("update").args.slice(2, 4), ["own1", { status: "cancelled" }]);
  const entry = (await historyOf(own.id)).at(-1)!;
  assert.deepEqual({ op: entry.op, reason: entry.reason, status: entry.patch.status }, { op: "event.cancel", reason: "Trip moved", status: { from: "confirmed", to: "cancelled" } });
  assert.equal((await ops.cancel(own.id, { actor: "neel", reason: "again" })).outcome, "unchanged");

  // To the provider a cancelled single event is a deleted one (map.ts reads it so); the next sync must not trash a row already cancelled with the etag it holds.
  assert.equal(providerEvent("own1").deleted, true);
  const report = await syncAccount(db.store, clock, fake, home.id, { calendarIds: [cancelled.calendarId] });
  assert.ok(report.calendars.every((c) => c.outcome !== "failed"), JSON.stringify(report));
  const afterSync = await getEvent(own.id);
  assert.deepEqual({ status: afterSync.status, deletedAt: afterSync.deletedAt, version: afterSync.version }, { status: "cancelled", deletedAt: null, version: cancelled.version }, "a sync leaves the cancelled row as it is");

  const day = await ops.list({ from: "2026-09-18", to: "2026-09-18" });
  assert.deepEqual(day.map((o) => [o.title, o.status]), [["Team lunch", "cancelled"]], "still listed; the views decide what to show");

  // Deleting a cancelled event: the provider already counts it gone (Google answers 410), and the row goes to the trash all the same.
  const trashed = okRecord(await ops.delete(own.id, neel));
  assert.deepEqual({ deletedAt: trashed.deletedAt, status: trashed.status }, { deletedAt: NOW, status: "cancelled" });
  assert.deepEqual(lastCall("delete").args, [home.id, side.id, "own1"], "the provider was asked, and its 410 was taken as done");
  assert.deepEqual(await ops.list({ from: "2026-09-18", to: "2026-09-18" }), []);
  fake.failNext(new ProviderRejected("Forbidden", 403));
  assert.deepEqual(rejectedIssues(await ops.delete(allDay.id, neel)), ["provider_rejected: Forbidden"], "any other refusal still stands");

  // Repeating: the scope rule applies, and cancelling one occurrence is an exception row.
  const series = okRecord(await ops.add({ title: "Office hours", start: at("2026-09-18T22:00:00Z"), repeat: "RRULE:FREQ=WEEKLY;BYDAY=FR" }, neel));
  assert.equal(rejectedOf(await ops.cancel(series.id, { actor: "neel", reason: "x" })).needs?.field, "scope");
  const one = okRecord(await ops.cancel(occurrenceRef(series.id, "2026-09-25T22:00:00Z"), { actor: "neel", reason: "holiday" }, { scope: "this" }));
  assert.deepEqual({ masterId: one.masterId, status: one.status, originalStart: one.originalStart }, { masterId: series.id, status: "cancelled", originalStart: at("2026-09-25T22:00:00Z") });
  assert.equal((await ops.list({ from: "2026-09-25", to: "2026-09-25" })).filter((o) => o.masterId === series.id || o.id === series.id).length, 0);
});

// ------------------------------------------------------------------ delete, restore

test("delete goes through the provider and soft-deletes the row; restore recreates it under the same Life-OS id", async () => {
  const oldExternal = allDay.external.id;
  const receipt = await ops.delete(allDay.id, neel);
  const gone = okRecord(receipt);
  assert.equal(receipt.outcome, "updated");
  assert.deepEqual({ id: gone.id, deletedAt: gone.deletedAt, status: gone.status }, { id: allDay.id, deletedAt: NOW, status: "confirmed" });
  assert.deepEqual(lastCall("delete").args, [home.id, personal.id, oldExternal]);
  assert.equal(providerEvent(oldExternal).deleted, true);
  assert.equal((await ops.get(allDay.id) as Event).deletedAt, NOW, "get returns a deleted row; callers check deletedAt");
  assert.equal((await ops.list({ from: "2026-09-20", to: "2026-09-20" })).length, 0);
  assert.equal((await ops.list({ from: "2026-09-20", to: "2026-09-20", includeDeleted: true })).map((o) => o.id).includes(allDay.id), true);
  assert.equal((await ops.delete(allDay.id, neel)).outcome, "unchanged");
  assert.match(rejectedIssues(await ops.update(allDay.id, { title: "x" }, neel))[0]!, /is deleted; restore it first/);

  const back = await ops.restore(allDay.id, neel);
  const restored = okRecord(back);
  assert.equal(back.outcome, "updated");
  assert.deepEqual({ id: restored.id, deletedAt: restored.deletedAt, title: restored.title, start: restored.start, end: restored.end, calendarId: restored.calendarId }, { id: allDay.id, deletedAt: null, title: "Offsite", start: { date: "2026-09-20" }, end: { date: "2026-09-21" }, calendarId: personalCal.id });
  assert.notEqual(restored.external.id, oldExternal, "a new provider event");
  assert.deepEqual(lastCall("create").args.slice(0, 2).concat([lastCall("create").args[3]]), [home.id, personal.id, allDay.id]);
  assert.equal(providerEvent(restored.external.id).lifeId, allDay.id);
  assert.deepEqual((await ops.list({ from: "2026-09-20", to: "2026-09-20" })).map((o) => o.id), [allDay.id]);
  assert.equal((await ops.restore(allDay.id, neel)).outcome, "unchanged");
  assert.deepEqual((await historyOf(allDay.id)).map((e) => e.op), ["event.add", "event.delete", "event.restore"]);
  allDay = restored;

  // A provider that refuses the delete leaves the row alone.
  fake.failNext(new ProviderUnavailable("down", 503));
  assert.equal(rejectedIssues(await ops.delete(allDay.id, neel))[0], "provider_unavailable: down");
  assert.equal((await getEvent(allDay.id)).deletedAt, null);
});

test("deleting one occurrence is a cancelled exception row; deleting and restoring a series carries its exception rows", async () => {
  const ref = occurrenceRef(standup.id, "2026-09-28T16:00:00Z");
  const receipt = await ops.delete(ref, neel, { scope: "this" });
  const cancelled = okRecord(receipt);
  assert.equal(receipt.outcome, "created");
  assert.deepEqual({ masterId: cancelled.masterId, originalStart: cancelled.originalStart, status: cancelled.status, deletedAt: cancelled.deletedAt, repeat: cancelled.repeat }, { masterId: standup.id, originalStart: at("2026-09-28T16:00:00Z"), status: "cancelled", deletedAt: null, repeat: null });
  const instanceId = fake.instanceId(standup.external.id, at("2026-09-28T16:00:00Z"));
  assert.equal(lastCall("delete").args[2], instanceId);
  assert.equal(providerEvent(instanceId).status, "cancelled");
  assert.equal((await ops.list({ from: "2026-09-28", to: "2026-09-28" })).filter((o) => o.id === standup.id || o.masterId === standup.id).length, 0);
  assert.equal((await ops.delete(ref, neel, { scope: "this" })).outcome, "unchanged");
  assert.equal(rejectedOf(await ops.delete(standup.id, neel)).needs?.field, "scope");

  const whole = okRecord(await ops.delete(standup.id, neel, { scope: "all" }));
  assert.equal(whole.deletedAt, NOW);
  const exceptions = await exceptionsOf(standup.id);
  assert.equal(exceptions.length, 2);
  assert.ok(exceptions.every((e) => e.deletedAt === NOW), "exception rows go with the master");
  assert.equal((await ops.list({ from: "2026-09-14", to: "2026-10-31" })).filter((o) => o.id === standup.id || o.masterId === standup.id).length, 0);
  assert.match(rejectedIssues(await ops.restore(movedStandup.id, neel))[0]!, /restore its series/);

  const oldExternal = standup.external.id;
  const restored = okRecord(await ops.restore(standup.id, neel));
  assert.deepEqual({ id: restored.id, deletedAt: restored.deletedAt, rule: restored.repeat?.rrule }, { id: standup.id, deletedAt: null, rule: "RRULE:FREQ=WEEKLY;BYDAY=MO" });
  assert.notEqual(restored.external.id, oldExternal);
  const again = await exceptionsOf(standup.id);
  assert.ok(again.every((e) => e.deletedAt === null && e.external.id.startsWith(restored.external.id)), "the exception rows are back, re-keyed under the new provider series");
  const moved = again.find((e) => e.id === movedStandup.id)!;
  assert.deepEqual({ start: moved.start, title: moved.title, status: moved.status }, { start: at("2026-09-21T17:00:00Z"), title: "Standup (late)", status: "confirmed" });
  const list = (await ops.list({ from: "2026-09-14", to: "2026-10-05" })).filter((o) => o.id === standup.id || o.masterId === standup.id);
  assert.deepEqual(list.map((o) => [o.originalStart, "at" in o.start ? o.start.at : ""]), [
    [at("2026-09-14T16:00:00Z"), "2026-09-14T16:00:00Z"],
    [at("2026-09-21T16:00:00Z"), "2026-09-21T17:00:00Z"],
    [at("2026-10-05T16:00:00Z"), "2026-10-05T16:00:00Z"],
  ], "the moved occurrence keeps its time and the cancelled one stays gone");
  standup = restored;

  // following on a delete truncates the series without a new one.
  const rest = okRecord(await ops.delete(occurrenceRef(standup.id, "2026-10-12T16:00:00Z"), neel, { scope: "following" }));
  assert.deepEqual({ id: rest.id, rule: rest.repeat?.rrule, deletedAt: rest.deletedAt }, { id: standup.id, rule: "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261012T155959Z", deletedAt: null });
  assert.equal((await ops.list({ from: "2026-10-12", to: "2026-11-30" })).filter((o) => o.id === standup.id).length, 0);
});

// ------------------------------------------------------------------ duplicate and history

test("duplicate copies the event without its people, conferencing, or provider identity", async () => {
  const invited = await byExternal("inv1");
  const receipt = await ops.duplicate(invited.id, neel, { calendar: "Side" });
  const copy = okRecord(receipt);
  assert.equal(receipt.outcome, "created");
  assert.notEqual(copy.id, invited.id);
  assert.deepEqual(
    { title: copy.title, notes: copy.notes, location: copy.location, start: copy.start, end: copy.end, busy: copy.busy, status: copy.status, calendarId: copy.calendarId },
    { title: invited.title, notes: invited.notes, location: invited.location, start: invited.start, end: invited.end, busy: invited.busy, status: invited.status, calendarId: sideCal.id },
  );
  assert.deepEqual({ attendees: copy.attendees, myResponse: copy.myResponse, conferencing: copy.conferencing, organizer: copy.organizer }, { attendees: [], myResponse: null, conferencing: null, organizer: { email: "neel@example.com", name: null, self: true } });
  assert.notEqual(copy.external.id, invited.external.id);
  assert.notEqual(copy.external.iCalUID, invited.external.iCalUID);
  assert.equal(providerEvent(copy.external.id).lifeId, copy.id);
  assert.deepEqual((await historyOf(copy.id)).map((e) => e.op), ["event.duplicate"]);

  const sameCalendar = okRecord(await ops.duplicate(dentist.id, neel));
  assert.equal(sameCalendar.calendarId, dentist.calendarId);

  const occurrence = okRecord(await ops.duplicate(occurrenceRef(standup.id, "2026-10-05T16:00:00Z"), neel));
  assert.deepEqual({ repeat: occurrence.repeat, start: occurrence.start, end: occurrence.end, masterId: occurrence.masterId }, { repeat: null, start: at("2026-10-05T16:00:00Z"), end: at("2026-10-05T16:15:00Z"), masterId: null }, "one occurrence copies as a single event");
  const series = okRecord(await ops.duplicate(standup.id, neel));
  assert.deepEqual(series.repeat, (await getEvent(standup.id)).repeat, "the series copies with its rule");
  assert.equal((await ops.list({ from: "2026-09-14", to: "2026-10-31" })).filter((o) => o.id === series.id).length, 4, "and expands the same way, exdates and exceptions aside");
  assert.match(rejectedIssues(await ops.duplicate(invited.id, neel, { calendar: "Holidays" }))[0]!, /read-only/);
  assert.match(rejectedIssues(await ops.duplicate("e_0000000000", neel))[0]!, /^event: no event/);
});

test("history reads the event's log in order", async () => {
  const history = await ops.history(dentist.id);
  assert.deepEqual(history.map((e) => e.op), ["event.add", "event.update", "event.reschedule", "event.reschedule", "event.reschedule", "event.reschedule", "event.move"]);
  assert.ok(history.every((e) => e.recordId === dentist.id && e.actor === "neel"));
  assert.deepEqual(await ops.history("e_0000000000"), []);
});
