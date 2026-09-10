import { test } from "node:test";
import assert from "node:assert/strict";
import type { EventWrite } from "../contract.ts";
import { fixedClock } from "../db/testing.ts";
import {
  CursorExpired,
  FakeAdapter,
  ProviderRejected,
  ProviderUnavailable,
  type ProviderCalendar,
  type ProviderEvent,
  type SeedEvent,
  type SyncPage,
} from "./adapter.ts";

const ACCOUNT = "a_fakeacct01";
const personal: ProviderCalendar = { id: "neel@gmail.com", name: "Personal", color: "#0b8043", timezone: "America/Los_Angeles", writable: true, primary: true, hidden: false };
const holidays: ProviderCalendar = { id: "holidays@group.v.calendar.google.com", name: "Holidays", color: null, timezone: "UTC", writable: false, primary: false, hidden: true };

const clock = fixedClock("2026-09-09T12:00:00Z");
const timed = (day: string, hour: number, id?: string, extra: Partial<SeedEvent> = {}): SeedEvent => ({
  ...(id ? { id } : {}),
  title: `Event ${id ?? day}`,
  start: { at: `${day}T${String(hour).padStart(2, "0")}:00:00Z`, timezone: "America/Los_Angeles" },
  end: { at: `${day}T${String(hour + 1).padStart(2, "0")}:00:00Z`, timezone: "America/Los_Angeles" },
  ...extra,
});
const write: EventWrite = {
  title: "Dentist",
  notes: "bring the card",
  location: null,
  start: { at: "2026-09-10T16:00:00Z", timezone: "America/Los_Angeles" },
  end: { at: "2026-09-10T17:00:00Z", timezone: "America/Los_Angeles" },
  repeat: null,
  busy: true,
  status: "confirmed",
};

/** Drive syncPage from `cursor` until done; returns every item and the final cursor. */
async function drain(fake: FakeAdapter, calendar: string, cursor: string | null, since = "2026-09-01T00:00:00Z"): Promise<{ items: ProviderEvent[]; cursor: string; pages: SyncPage[] }> {
  const items: ProviderEvent[] = [];
  const pages: SyncPage[] = [];
  let next = cursor;
  for (;;) {
    const page = await fake.syncPage(ACCOUNT, calendar, next, since);
    pages.push(page);
    items.push(...page.items);
    if (page.done) {
      assert.ok(page.nextCursor, "the last page carries the cursor to store");
      return { items, cursor: page.nextCursor, pages };
    }
    assert.ok(page.nextCursor, "a page that is not done names the next one");
    next = page.nextCursor;
  }
}

test("connect returns the identity asked for, shows a URL, and the first unknown account id links to what was seeded under it", async () => {
  const fake = new FakeAdapter({ clock });
  fake.connectAs("work@example.com", ["scope-a"]);
  fake.seed("work@example.com", personal, [timed("2026-09-10", 16, "w1")]);
  const urls: string[] = [];
  const connected = await fake.connect({ open: (url) => urls.push(url) });
  assert.deepEqual(connected, { identity: "work@example.com", scopes: ["scope-a"], credentialId: "fake-credential-1" });
  assert.equal(urls.length, 1);
  assert.match(urls[0]!, /^https:\/\/accounts\.google\.com\//);
  assert.deepEqual(await fake.listCalendars("a_newaccount"), [personal], "the new account id sees the identity's calendars");
  assert.equal(fake.events("a_newaccount").length, 1);
  assert.deepEqual(await fake.listCalendars("a_otheracct1"), [], "a second unknown id is not linked to the same identity");
  assert.deepEqual(fake.calls.map((c) => c.method), ["connect", "listCalendars", "listCalendars"]);

  const second = await fake.connect({ open: () => {} });
  assert.equal(second.identity, "neel@example.com", "the default identity when none was queued");
  assert.equal(second.credentialId, "fake-credential-2");
  fake.link(ACCOUNT, "work@example.com");
  assert.deepEqual(await fake.listCalendars(ACCOUNT), [personal], "link binds an id explicitly");
});

test("a full sync pages in change order, filters by since, and a following incremental sync returns only what changed", async () => {
  const fake = new FakeAdapter({ clock, pageSize: 2 });
  fake.seed(ACCOUNT, personal, [
    timed("2026-09-10", 16, "p1"),
    timed("2026-08-01", 9, "old"),
    timed("2026-09-11", 10, "p2"),
    { id: "master", title: "Standup", start: { at: "2025-01-06T17:00:00Z", timezone: "America/Los_Angeles" }, end: { at: "2025-01-06T17:15:00Z", timezone: "America/Los_Angeles" }, repeat: { rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO", exdates: [] } },
    { id: "trip", title: "Trip", start: { date: "2026-09-20" }, end: { date: "2026-09-23" } },
    { id: "gone", title: "Gone", start: { date: "2026-07-01" }, end: { date: "2026-07-02" }, deleted: true },
  ]);
  fake.seed(ACCOUNT, holidays, [timed("2026-12-25", 0, "xmas")]);

  const full = await drain(fake, personal.id, null);
  assert.deepEqual(full.pages.map((p) => [p.items.length, p.done]), [[2, false], [2, false], [1, true]], "pages of two, the last one done");
  assert.deepEqual(full.items.map((i) => i.external.id), ["p1", "p2", "master", "trip", "gone"], "in change order; the item ending before since is not mentioned, the master and the deleted one are");
  assert.equal(full.items.find((i) => i.external.id === "gone")!.deleted, true);
  assert.equal(full.items.find((i) => i.external.id === "trip")!.busy, false, "all-day seeds default to free");
  assert.ok(!full.items.some((i) => i.external.id === "xmas"), "another calendar's events stay out");
  assert.equal(fake.callsTo("syncPage").length, 3);
  assert.deepEqual(fake.calls[0], { method: "syncPage", args: [ACCOUNT, personal.id, null, "2026-09-01T00:00:00Z"] });

  const quiet = await drain(fake, personal.id, full.cursor);
  assert.deepEqual(quiet.items, [], "nothing changed, nothing returned");
  assert.deepEqual(quiet.pages.map((p) => p.done), [true]);

  fake.change(ACCOUNT, "p1", { title: "Moved" });
  const created = await fake.create(ACCOUNT, personal.id, write, "e_lifeid0001");
  await fake.delete(ACCOUNT, personal.id, "p2");
  fake.change(ACCOUNT, "xmas", { title: "Christmas" });
  const incremental = await drain(fake, personal.id, quiet.cursor);
  assert.deepEqual(incremental.items.map((i) => [i.external.id, i.title, i.deleted]), [
    ["p1", "Moved", false],
    [created.external.id, "Dentist", false],
    ["p2", "Event p2", true],
  ], "changed, created, deleted, in that order; the other calendar's change is not here");
  assert.notEqual(incremental.items[0]!.external.etag, full.items[0]!.external.etag, "a change bumps the etag");
  assert.equal(incremental.items[1]!.lifeId, "e_lifeid0001", "create stamped our id");

  const again = await drain(fake, personal.id, incremental.cursor);
  assert.deepEqual(again.items, [], "the cursor moved past them");
});

test("a change made between pages waits for the next incremental sync, and expired or foreign cursors throw CursorExpired", async () => {
  const fake = new FakeAdapter({ clock, pageSize: 1 });
  fake.seed(ACCOUNT, personal, [timed("2026-09-10", 16, "a"), timed("2026-09-11", 16, "b")]);
  fake.seed(ACCOUNT, holidays, []);
  const first = await fake.syncPage(ACCOUNT, personal.id, null, "2026-09-01T00:00:00Z");
  assert.deepEqual([first.items.length, first.done], [1, false]);
  fake.seed(ACCOUNT, personal, [timed("2026-09-12", 16, "c")]);
  const second = await fake.syncPage(ACCOUNT, personal.id, first.nextCursor, "2026-09-01T00:00:00Z");
  assert.deepEqual([second.items.map((i) => i.external.id), second.done], [["b"], true], "the item added mid-sync is not in this sync");
  const next = await drain(fake, personal.id, second.nextCursor);
  assert.deepEqual(next.items.map((i) => i.external.id), ["c"], "it arrives with the next incremental sync");

  await assert.rejects(fake.syncPage(ACCOUNT, holidays.id, next.cursor, "2026-09-01T00:00:00Z"), CursorExpired, "another calendar's cursor");
  await assert.rejects(fake.syncPage(ACCOUNT, personal.id, "garbage", "2026-09-01T00:00:00Z"), CursorExpired);
  fake.expireCursors(ACCOUNT, personal.id);
  await assert.rejects(fake.syncPage(ACCOUNT, personal.id, next.cursor, "2026-09-01T00:00:00Z"), CursorExpired, "expired by the provider");
  const fresh = await drain(fake, personal.id, null);
  assert.deepEqual(fresh.items.map((i) => i.external.id), ["a", "b", "c"], "a full sync starts over");
  await assert.rejects(fake.syncPage(ACCOUNT, "nope@calendar", null, "2026-09-01T00:00:00Z"), (error: unknown) => error instanceof ProviderRejected && error.status === 404);
});

test("failNext throws the given error on the next call only, and that call is still recorded", async () => {
  const fake = new FakeAdapter({ clock });
  fake.seed(ACCOUNT, personal, []);
  fake.failNext(new ProviderUnavailable("503 backend error", 503));
  await assert.rejects(fake.listCalendars(ACCOUNT), (error: unknown) => error instanceof ProviderUnavailable && error.status === 503 && error.name === "ProviderUnavailable");
  assert.deepEqual(await fake.listCalendars(ACCOUNT), [personal], "the following call works");
  assert.deepEqual(fake.calls.map((c) => c.method), ["listCalendars", "listCalendars"]);

  fake.failNext(new CursorExpired());
  await assert.rejects(fake.syncPage(ACCOUNT, personal.id, "sync:whatever", "2026-09-01T00:00:00Z"), CursorExpired);
  fake.failNext(new ProviderRejected("Invalid time range", 400));
  await assert.rejects(fake.create(ACCOUNT, personal.id, write, "e_lifeid0002"), (error: unknown) => error instanceof ProviderRejected && error.status === 400 && error.message === "Invalid time range");
  assert.deepEqual(fake.events(ACCOUNT), [], "the refused create stored nothing");
  fake.failNext(new ProviderUnavailable("timeout"));
  await assert.rejects(fake.connect({ open: () => {} }), ProviderUnavailable);
  const ok = await fake.create(ACCOUNT, personal.id, write, "e_lifeid0002");
  assert.equal(ok.lifeId, "e_lifeid0002");
});

test("create stamps lifeId and the account's identity as organizer, and refuses read-only or unknown calendars", async () => {
  const fake = new FakeAdapter({ clock });
  fake.link(ACCOUNT, "neel@gmail.com");
  fake.seed(ACCOUNT, personal, []);
  fake.seed(ACCOUNT, holidays, []);
  const created = await fake.create(ACCOUNT, personal.id, write, "e_lifeid0003");
  assert.deepEqual(created, {
    title: "Dentist",
    notes: "bring the card",
    location: null,
    start: write.start,
    end: write.end,
    repeat: null,
    originalStart: null,
    status: "confirmed",
    busy: true,
    organizer: { email: "neel@gmail.com", name: null, self: true },
    attendees: [],
    myResponse: null,
    conferencing: null,
    reminders: null,
    external: { provider: "google", id: created.external.id, etag: created.external.etag, iCalUID: `${created.external.id}@google.com`, updatedAt: "2026-09-09T12:00:00Z" },
    providerMasterId: null,
    deleted: false,
    lifeId: "e_lifeid0003",
  });
  assert.ok(created.external.etag.length > 0);
  assert.deepEqual(fake.event(ACCOUNT, created.external.id), created, "the provider holds it");
  assert.deepEqual(fake.calls.at(-1), { method: "create", args: [ACCOUNT, personal.id, write, "e_lifeid0003"] });
  await assert.rejects(fake.create(ACCOUNT, holidays.id, write, "e_lifeid0004"), (error: unknown) => error instanceof ProviderRejected && error.status === 403 && /read-only/.test(error.message));
  await assert.rejects(fake.create(ACCOUNT, "missing", write, "e_lifeid0004"), (error: unknown) => error instanceof ProviderRejected && error.status === 404);
  await assert.rejects(fake.update(ACCOUNT, holidays.id, "x", { title: "y" }, ""), (error: unknown) => error instanceof ProviderRejected && error.status === 403);
});

test("update checks the etag when given, applies the patch, and bumps the etag; delete marks deleted and a repeat delete is 410", async () => {
  const fake = new FakeAdapter({ clock });
  const [seeded] = fake.seed(ACCOUNT, personal, [timed("2026-09-10", 16, "u1", { notes: "keep", busy: true })]);
  const etag = seeded!.external.etag;
  await assert.rejects(fake.update(ACCOUNT, personal.id, "u1", { title: "Nope" }, "etag-stale"), (error: unknown) => error instanceof ProviderRejected && error.status === 412);
  assert.equal(fake.event(ACCOUNT, "u1")!.title, "Event u1", "a refused update changed nothing");
  const updated = await fake.update(ACCOUNT, personal.id, "u1", { title: "Renamed", location: "Room 4", notes: null, busy: false, status: "tentative" }, etag);
  assert.equal(updated.title, "Renamed");
  assert.equal(updated.location, "Room 4");
  assert.equal(updated.notes, null, "null clears");
  assert.equal(updated.busy, false);
  assert.equal(updated.status, "tentative");
  assert.deepEqual(updated.start, seeded!.start, "fields not in the patch stay");
  assert.notEqual(updated.external.etag, etag, "the etag moved");
  assert.equal(updated.external.id, "u1");
  await assert.rejects(fake.update(ACCOUNT, personal.id, "u1", { title: "Again" }, etag), ProviderRejected, "the old etag no longer matches");
  const unchecked = await fake.update(ACCOUNT, personal.id, "u1", { title: "Again" }, "");
  assert.equal(unchecked.title, "Again", "an empty etag skips the check");
  await assert.rejects(fake.update(ACCOUNT, personal.id, "missing", { title: "x" }, ""), (error: unknown) => error instanceof ProviderRejected && error.status === 404);

  await fake.delete(ACCOUNT, personal.id, "u1");
  assert.equal(fake.event(ACCOUNT, "u1")!.deleted, true);
  assert.equal(fake.event(ACCOUNT, "u1")!.title, "Again", "delete leaves the fields alone");
  await assert.rejects(fake.delete(ACCOUNT, personal.id, "u1"), (error: unknown) => error instanceof ProviderRejected && error.status === 410);
  const sync = await drain(fake, personal.id, null);
  assert.deepEqual(sync.items.map((i) => [i.external.id, i.deleted]), [["u1", true]], "a full sync mentions it as deleted");
  fake.remove(ACCOUNT, "u1");
  assert.deepEqual((await drain(fake, personal.id, null)).items, [], "remove forgets it entirely");
});

test("instanceId builds the provider's occurrence id, and writes to an instance id materialize an exception row", async () => {
  const fake = new FakeAdapter({ clock });
  assert.equal(fake.instanceId("m1", { at: "2026-09-10T16:00:00Z", timezone: "America/Los_Angeles" }), "m1_20260910T160000Z");
  assert.equal(fake.instanceId("m1", { at: "2026-09-10T16:00:00+02:00", timezone: null }), "m1_20260910T140000Z", "in UTC");
  assert.equal(fake.instanceId("m1", { date: "2026-09-10" }), "m1_20260910");
  fake.seed(ACCOUNT, personal, [
    { id: "m1", title: "Standup", start: { at: "2026-09-07T16:00:00Z", timezone: "America/Los_Angeles" }, end: { at: "2026-09-07T16:15:00Z", timezone: "America/Los_Angeles" }, repeat: { rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO", exdates: [] } },
    { id: "single", title: "Once", start: { at: "2026-09-07T18:00:00Z", timezone: null }, end: { at: "2026-09-07T19:00:00Z", timezone: null } },
  ]);
  const before = await drain(fake, personal.id, null);
  const occurrence = { at: "2026-09-14T16:00:00Z", timezone: "America/Los_Angeles" };
  const instance = fake.instanceId("m1", occurrence);
  const moved = await fake.update(ACCOUNT, personal.id, instance, { start: { at: "2026-09-14T17:00:00Z", timezone: "America/Los_Angeles" }, end: { at: "2026-09-14T17:15:00Z", timezone: "America/Los_Angeles" } }, "");
  assert.equal(moved.providerMasterId, "m1");
  assert.deepEqual(moved.originalStart, occurrence);
  assert.equal(moved.repeat, null, "an exception row carries no rule");
  assert.equal(moved.external.id, instance);
  assert.equal(moved.external.iCalUID, "m1@google.com", "same iCalUID as the master");
  assert.deepEqual(moved.start, { at: "2026-09-14T17:00:00Z", timezone: "America/Los_Angeles" });
  assert.equal(fake.event(ACCOUNT, "m1")!.title, "Standup", "the master is untouched");
  const after = await drain(fake, personal.id, before.cursor);
  assert.deepEqual(after.items.map((i) => i.external.id), [instance], "the exception row arrives with the next incremental sync");

  const untouched = fake.instanceId("m1", { at: "2026-09-21T16:00:00Z", timezone: "America/Los_Angeles" });
  const respondedTo = fake.event(ACCOUNT, untouched);
  assert.equal(respondedTo, null, "an instance no one touched is not a row");
  await fake.delete(ACCOUNT, personal.id, untouched);
  const cancelled = fake.event(ACCOUNT, untouched)!;
  assert.equal(cancelled.status, "cancelled", "deleting one occurrence cancels it");
  assert.equal(cancelled.deleted, false);
  assert.deepEqual(cancelled.end, { at: "2026-09-21T16:15:00Z", timezone: "America/Los_Angeles" }, "with the master's duration");
  await assert.rejects(fake.update(ACCOUNT, personal.id, fake.instanceId("single", occurrence), { title: "x" }, ""), (error: unknown) => error instanceof ProviderRejected && error.status === 404, "a single event has no instances");
  await assert.rejects(fake.update(ACCOUNT, personal.id, "m1_notastamp", { title: "x" }, ""), ProviderRejected);

  await fake.delete(ACCOUNT, personal.id, "m1");
  assert.equal(fake.event(ACCOUNT, instance)!.deleted, true, "deleting the master deletes its exception rows");
  assert.equal(fake.event(ACCOUNT, untouched)!.deleted, true);
  assert.equal(fake.event(ACCOUNT, "single")!.deleted, false);

  const [allDay] = fake.seed(ACCOUNT, personal, [{ id: "ad", title: "Retreat", start: { date: "2026-10-01" }, end: { date: "2026-10-03" }, repeat: { rrule: "RRULE:FREQ=MONTHLY", exdates: [] } }]);
  const adInstance = await fake.update(ACCOUNT, personal.id, fake.instanceId("ad", { date: "2026-11-01" }), { title: "Retreat (moved)" }, "");
  assert.deepEqual([adInstance.start, adInstance.end, adInstance.originalStart], [{ date: "2026-11-01" }, { date: "2026-11-03" }, { date: "2026-11-01" }]);
  assert.equal(allDay!.busy, false);
});

test("respond updates the self attendee and refuses when Neel is not invited", async () => {
  const fake = new FakeAdapter({ clock });
  fake.seed(ACCOUNT, personal, [
    timed("2026-09-10", 16, "invite", {
      organizer: { email: "boss@example.com", name: "Boss", self: false },
      attendees: [
        { email: "boss@example.com", name: "Boss", response: "accepted", self: false, optional: false },
        { email: "neel@gmail.com", name: null, response: "needsAction", self: true, optional: false },
      ],
      myResponse: "needsAction",
    }),
    timed("2026-09-10", 18, "own"),
  ]);
  const seededEtag = fake.event(ACCOUNT, "invite")!.external.etag;
  const responded = await fake.respond(ACCOUNT, personal.id, "invite", "tentative");
  assert.equal(responded.myResponse, "tentative");
  assert.deepEqual(responded.attendees.map((a) => a.response), ["accepted", "tentative"]);
  assert.notEqual(responded.external.etag, seededEtag);
  await assert.rejects(fake.respond(ACCOUNT, personal.id, "own", "accepted"), (error: unknown) => error instanceof ProviderRejected && error.status === 400 && /Not an attendee/.test(error.message));
  assert.deepEqual(fake.calls.map((c) => c.method), ["respond", "respond"]);
  assert.deepEqual(fake.calls[0]!.args, [ACCOUNT, personal.id, "invite", "tentative"]);
});

test("calendars can be renamed, re-permissioned, and removed provider-side", async () => {
  const fake = new FakeAdapter({ clock });
  fake.seed(ACCOUNT, personal, [timed("2026-09-10", 16, "p1")]);
  fake.seed(ACCOUNT, holidays, [timed("2026-12-25", 0, "x")]);
  fake.changeCalendar(ACCOUNT, holidays.id, { name: "Public holidays", writable: true });
  assert.deepEqual(await fake.listCalendars(ACCOUNT), [personal, { ...holidays, name: "Public holidays", writable: true }]);
  fake.removeCalendar(ACCOUNT, personal.id);
  assert.deepEqual(await fake.listCalendars(ACCOUNT), [{ ...holidays, name: "Public holidays", writable: true }]);
  assert.equal(fake.event(ACCOUNT, "p1"), null, "its events went with it");
  await assert.rejects(fake.syncPage(ACCOUNT, personal.id, null, "2026-09-01T00:00:00Z"), (error: unknown) => error instanceof ProviderRejected && error.status === 404);
  fake.seed(ACCOUNT, { ...personal, name: "Personal again" }, []);
  assert.equal((await fake.listCalendars(ACCOUNT)).length, 2, "seed upserts by id");
  assert.throws(() => fake.change(ACCOUNT, "p1", { title: "x" }), /no event p1/);
  assert.throws(() => fake.changeCalendar(ACCOUNT, "nope", { name: "x" }), /no calendar nope/);
});
