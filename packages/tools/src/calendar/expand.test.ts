import { test } from "node:test";
import assert from "node:assert/strict";
import type { Event, When } from "../contract.ts";
import { expandEvent, expandEvents, occurrenceRef, parseOccurrenceRef, isOccurrenceRef, type Occurrence } from "./expand.ts";

const LA = "America/Los_Angeles";

let counter = 0;
function event(overrides: Partial<Event> & { start: When; end: When }): Event {
  counter += 1;
  return {
    id: `e_${String(counter).padStart(10, "0")}`,
    calendarId: "c_cal0000001",
    accountId: "a_acct000001",
    title: "Standup",
    notes: null,
    location: null,
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
    origin: { actor: "import:google", at: "2026-09-01T00:00:00Z", evidence: [] },
    external: { provider: "google", id: `g${counter}`, etag: `"${counter}"`, iCalUID: `uid${counter}@google.com`, updatedAt: "2026-09-01T00:00:00Z" },
    version: 1,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

/** A timed master at a wall clock in `zone`, one hour long by default. */
function timed(wallStart: string, rrule: string | null, opts: { zone?: string | null; minutes?: number; exdates?: string[] } = {}): Event {
  const zone = opts.zone === undefined ? LA : opts.zone;
  const startAt = new Date(wallStart + (zone ? "" : "Z"));
  const at = zone ? wallToInstant(wallStart, zone) : startAt.toISOString().replace(/\.\d{3}Z$/, "Z");
  const endAt = new Date(Date.parse(at) + (opts.minutes ?? 60) * 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return event({
    start: { at, timezone: zone },
    end: { at: endAt, timezone: zone },
    repeat: rrule ? { rrule, exdates: opts.exdates ?? [] } : null,
  });
}

function allDay(date: string, rrule: string | null, days = 1): Event {
  const end = new Date(date + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + days);
  return event({ start: { date }, end: { date: end.toISOString().slice(0, 10) }, repeat: rrule ? { rrule, exdates: [] } : null });
}

function exception(master: Event, originalStart: When, overrides: Partial<Event>): Event {
  const { id: _masterId, ...fields } = master;
  return event({ ...fields, ...overrides, repeat: null, masterId: master.id, originalStart, start: overrides.start ?? master.start, end: overrides.end ?? master.end });
}

/** Wall clock in a zone to an instant, kept independent of src/time.ts so the tests check the module against known answers. */
function wallToInstant(wall: string, zone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const guess = Date.parse(wall + "Z");
  const offset = (t: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second)) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const win = (from: string, to: string, timezone = LA) => ({ from, to, timezone });
const starts = (list: Occurrence[]) => list.map((o) => ("at" in o.start ? o.start.at : o.start.date));
/** The wall clock each occurrence starts at: a zoned one read in `zone`, a floating one as spelled (its `at` is the wall clock as UTC). */
const wallStarts = (list: Occurrence[], zone = LA) =>
  list.map((o) => {
    if (!("at" in o.start)) return o.start.date;
    const read = o.start.timezone === null ? "UTC" : zone;
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: read, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(o.start.at)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  });

test("a single event is one occurrence addressed by its own start, and only inside the window", () => {
  const single = timed("2026-09-10T09:00:00", null);
  const [only, ...rest] = expandEvent(single, [], win("2026-09-07T07:00:00Z", "2026-09-14T07:00:00Z"));
  assert.equal(rest.length, 0);
  assert.equal(only!.occurrenceId, `${single.id}@2026-09-10T16:00:00Z`);
  assert.deepEqual(only!.start, { at: "2026-09-10T16:00:00Z", timezone: LA });
  assert.deepEqual(only!.end, { at: "2026-09-10T17:00:00Z", timezone: LA });
  assert.deepEqual(only!.originalStart, { at: "2026-09-10T16:00:00Z", timezone: LA });
  assert.equal(only!.master, true);
  assert.equal(only!.title, "Standup");
  assert.deepEqual(expandEvent(single, [], win("2026-09-11T07:00:00Z", "2026-09-14T07:00:00Z")), []);
  // A window edge: the event overlapping the window start still shows, one ending exactly at the start does not.
  assert.equal(expandEvent(single, [], win("2026-09-10T16:30:00Z", "2026-09-11T00:00:00Z")).length, 1);
  assert.equal(expandEvent(single, [], win("2026-09-10T17:00:00Z", "2026-09-11T00:00:00Z")).length, 0);
});

test("daily", () => {
  const daily = timed("2026-09-01T09:00:00", "FREQ=DAILY");
  const list = expandEvent(daily, [], win("2026-09-07T07:00:00Z", "2026-09-10T07:00:00Z"));
  assert.deepEqual(starts(list), ["2026-09-07T16:00:00Z", "2026-09-08T16:00:00Z", "2026-09-09T16:00:00Z"]);
  assert.deepEqual(list.map((o) => o.occurrenceId), starts(list).map((s) => `${daily.id}@${s}`));
  assert.ok(list.every((o) => o.master && o.id === daily.id && o.repeat !== null));
  assert.deepEqual(list[0]!.end, { at: "2026-09-07T17:00:00Z", timezone: LA });
});

test("weekly by day", () => {
  const weekly = timed("2026-09-01T09:00:00", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR");
  const list = expandEvent(weekly, [], win("2026-09-06T07:00:00Z", "2026-09-13T07:00:00Z"));
  assert.deepEqual(wallStarts(list), ["2026-09-07 09:00", "2026-09-09 09:00", "2026-09-11 09:00"]);
});

test("monthly by day and by position", () => {
  const byDay = timed("2026-01-31T10:00:00", "FREQ=MONTHLY;BYMONTHDAY=31");
  assert.deepEqual(wallStarts(expandEvent(byDay, [], win("2026-01-01T08:00:00Z", "2026-07-01T07:00:00Z"))), ["2026-01-31 10:00", "2026-03-31 10:00", "2026-05-31 10:00"], "months without a 31st are skipped");
  const lastFriday = timed("2026-01-30T10:00:00", "FREQ=MONTHLY;BYDAY=-1FR");
  assert.deepEqual(wallStarts(expandEvent(lastFriday, [], win("2026-01-01T08:00:00Z", "2026-05-01T07:00:00Z"))), ["2026-01-30 10:00", "2026-02-27 10:00", "2026-03-27 10:00", "2026-04-24 10:00"]);
  const secondTuesday = timed("2026-09-08T10:00:00", "FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2");
  assert.deepEqual(wallStarts(expandEvent(secondTuesday, [], win("2026-09-01T07:00:00Z", "2026-12-01T08:00:00Z"))), ["2026-09-08 10:00", "2026-10-13 10:00", "2026-11-10 10:00"]);
});

test("yearly", () => {
  const leap = timed("2024-02-29T09:00:00", "FREQ=YEARLY");
  assert.deepEqual(wallStarts(expandEvent(leap, [], win("2024-01-01T08:00:00Z", "2033-01-01T08:00:00Z"))), ["2024-02-29 09:00", "2028-02-29 09:00", "2032-02-29 09:00"]);
  const birthday = allDay("1994-02-25", "FREQ=YEARLY");
  assert.deepEqual(starts(expandEvent(birthday, [], win("2026-01-01T08:00:00Z", "2028-01-01T08:00:00Z"))), ["2026-02-25", "2027-02-25"]);
});

test("COUNT ends the series", () => {
  const three = timed("2026-09-01T09:00:00", "FREQ=DAILY;COUNT=3");
  assert.deepEqual(wallStarts(expandEvent(three, [], win("2026-08-01T07:00:00Z", "2026-10-01T07:00:00Z"))), ["2026-09-01 09:00", "2026-09-02 09:00", "2026-09-03 09:00"]);
  assert.deepEqual(expandEvent(three, [], win("2026-09-04T07:00:00Z", "2026-10-01T07:00:00Z")), []);
});

test("UNTIL ends the series, in UTC as Google writes it and as a bare date", () => {
  // Google emits the UNTIL as UTC: 2026-09-10 09:00 LA is 16:00Z, so an UNTIL of 15:59:59Z that day excludes the 10th.
  const utc = timed("2026-09-01T09:00:00", "FREQ=DAILY;UNTIL=20260910T155959Z");
  assert.deepEqual(wallStarts(expandEvent(utc, [], win("2026-09-08T07:00:00Z", "2026-09-12T07:00:00Z"))), ["2026-09-08 09:00", "2026-09-09 09:00"]);
  const inclusive = timed("2026-09-01T09:00:00", "FREQ=DAILY;UNTIL=20260910T160000Z");
  assert.deepEqual(wallStarts(expandEvent(inclusive, [], win("2026-09-08T07:00:00Z", "2026-09-12T07:00:00Z"))), ["2026-09-08 09:00", "2026-09-09 09:00", "2026-09-10 09:00"], "an UNTIL equal to an occurrence includes it");
  const bare = timed("2026-09-01T09:00:00", "FREQ=DAILY;UNTIL=20260910");
  assert.deepEqual(wallStarts(expandEvent(bare, [], win("2026-09-08T07:00:00Z", "2026-09-12T07:00:00Z"))), ["2026-09-08 09:00", "2026-09-09 09:00", "2026-09-10 09:00"], "a date-only UNTIL runs to the end of that day");
  const allDayUntil = allDay("2026-09-01", "FREQ=DAILY;UNTIL=20260903");
  assert.deepEqual(starts(expandEvent(allDayUntil, [], win("2026-08-31T07:00:00Z", "2026-09-10T07:00:00Z"))), ["2026-09-01", "2026-09-02", "2026-09-03"]);
});

test("intervals", () => {
  const every3 = timed("2026-09-01T09:00:00", "FREQ=DAILY;INTERVAL=3");
  assert.deepEqual(wallStarts(expandEvent(every3, [], win("2026-09-01T07:00:00Z", "2026-09-11T07:00:00Z"))), ["2026-09-01 09:00", "2026-09-04 09:00", "2026-09-07 09:00", "2026-09-10 09:00"]);
  const biweekly = timed("2026-09-07T09:00:00", "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO");
  assert.deepEqual(wallStarts(expandEvent(biweekly, [], win("2026-09-01T07:00:00Z", "2026-10-06T07:00:00Z"))), ["2026-09-07 09:00", "2026-09-21 09:00", "2026-10-05 09:00"]);
  const quarterly = timed("2026-01-15T09:00:00", "FREQ=MONTHLY;INTERVAL=3");
  assert.deepEqual(wallStarts(expandEvent(quarterly, [], win("2026-01-01T08:00:00Z", "2027-01-01T08:00:00Z"))), ["2026-01-15 09:00", "2026-04-15 09:00", "2026-07-15 09:00", "2026-10-15 09:00"]);
});

test("exdates drop occurrences, whatever spelling the key carries", () => {
  const daily = timed("2026-09-01T09:00:00", "FREQ=DAILY", { exdates: ["2026-09-08T16:00:00Z", "2026-09-09T16:00:00.000Z"] });
  assert.deepEqual(wallStarts(expandEvent(daily, [], win("2026-09-07T07:00:00Z", "2026-09-11T07:00:00Z"))), ["2026-09-07 09:00", "2026-09-10 09:00"]);
  const days = allDay("2026-09-01", "FREQ=DAILY");
  days.repeat!.exdates = ["2026-09-08"];
  assert.deepEqual(starts(expandEvent(days, [], win("2026-09-07T07:00:00Z", "2026-09-10T07:00:00Z"))), ["2026-09-07", "2026-09-09"]);
});

test("exception rows replace their slot, cancelled ones drop it, and moved ones follow their new time", () => {
  const master = timed("2026-09-01T09:00:00", "FREQ=DAILY");
  const slot = (day: string): When => ({ at: `${day}T16:00:00Z`, timezone: LA });
  const moved = exception(master, slot("2026-09-08"), { title: "Standup (moved)", start: { at: "2026-09-08T18:00:00Z", timezone: LA }, end: { at: "2026-09-08T18:30:00Z", timezone: LA } });
  const cancelled = exception(master, slot("2026-09-09"), { status: "cancelled" });
  const movedOut = exception(master, slot("2026-09-10"), { start: { at: "2026-09-20T16:00:00Z", timezone: LA }, end: { at: "2026-09-20T17:00:00Z", timezone: LA } });
  const movedIn = exception(master, slot("2026-09-25"), { title: "Pulled forward", start: { at: "2026-09-11T20:00:00Z", timezone: LA }, end: { at: "2026-09-11T21:00:00Z", timezone: LA } });
  const foreign = exception(event({ ...master, id: "e_othermastr" }), slot("2026-09-07"), { title: "Not mine" });
  const list = expandEvent(master, [moved, cancelled, movedOut, movedIn, foreign], win("2026-09-07T07:00:00Z", "2026-09-12T07:00:00Z"));
  assert.deepEqual(
    list.map((o) => [o.occurrenceId, "at" in o.start ? o.start.at : "", o.title, o.master, o.id === master.id]),
    [
      [`${master.id}@2026-09-07T16:00:00Z`, "2026-09-07T16:00:00Z", "Standup", true, true],
      [`${master.id}@2026-09-08T16:00:00Z`, "2026-09-08T18:00:00Z", "Standup (moved)", false, false],
      [`${master.id}@2026-09-11T16:00:00Z`, "2026-09-11T16:00:00Z", "Standup", true, true],
      [`${master.id}@2026-09-25T16:00:00Z`, "2026-09-11T20:00:00Z", "Pulled forward", false, false],
    ],
  );
  const movedOcc = list[1]!;
  assert.equal(movedOcc.id, moved.id, "an exception occurrence carries the exception row's fields");
  assert.equal(movedOcc.masterId, master.id);
  assert.deepEqual(movedOcc.originalStart, slot("2026-09-08"));
  assert.deepEqual(movedOcc.end, { at: "2026-09-08T18:30:00Z", timezone: LA });
  // The moved-out row shows in the window it moved into, and its slot stays empty there.
  const later = expandEvent(master, [movedOut], win("2026-09-20T07:00:00Z", "2026-09-21T07:00:00Z"));
  assert.deepEqual(later.map((o) => [o.occurrenceId, o.master]), [[`${master.id}@2026-09-10T16:00:00Z`, false], [`${master.id}@2026-09-20T16:00:00Z`, true]]);
});

test("a weekly 9 AM survives the DST change in its own zone", () => {
  const weekly = timed("2026-10-19T09:00:00", "FREQ=WEEKLY;BYDAY=MO");
  const list = expandEvent(weekly, [], win("2026-10-19T00:00:00Z", "2026-11-17T00:00:00Z"));
  assert.deepEqual(wallStarts(list), ["2026-10-19 09:00", "2026-10-26 09:00", "2026-11-02 09:00", "2026-11-09 09:00", "2026-11-16 09:00"]);
  assert.deepEqual(starts(list), ["2026-10-19T16:00:00Z", "2026-10-26T16:00:00Z", "2026-11-02T17:00:00Z", "2026-11-09T17:00:00Z", "2026-11-16T17:00:00Z"], "the instant shifts by an hour when LA leaves DST on Nov 1");
  assert.ok(list.every((o) => "at" in o.start && "at" in o.end && Date.parse(o.end.at) - Date.parse(o.start.at) === 3600000), "the duration is kept");
  // Spring forward the other way, and a zone the display zone is not.
  const kolkata = timed("2026-03-02T09:00:00", "FREQ=WEEKLY;BYDAY=MO", { zone: "Asia/Kolkata" });
  const india = expandEvent(kolkata, [], win("2026-03-01T00:00:00Z", "2026-03-24T00:00:00Z"));
  assert.deepEqual(starts(india), ["2026-03-02T03:30:00Z", "2026-03-09T03:30:00Z", "2026-03-16T03:30:00Z", "2026-03-23T03:30:00Z"], "a zone without DST keeps a constant offset regardless of the display zone");
});

test("a floating series happens at its wall clock in every display zone, and its occurrences stay floating", () => {
  // A floating When carries its wall clock spelled as UTC: 09:00 wherever Neel is, stored as 09:00Z with no zone.
  const floating = timed("2026-10-26T09:00:00", "FREQ=WEEKLY;BYDAY=MO", { zone: null });
  const utc = expandEvent(floating, [], win("2026-10-26T00:00:00Z", "2026-11-16T00:00:00Z", "UTC"));
  assert.deepEqual(starts(utc), ["2026-10-26T09:00:00Z", "2026-11-02T09:00:00Z", "2026-11-09T09:00:00Z"]);
  assert.ok(utc.every((o) => "at" in o.start && o.start.timezone === null && "at" in o.end && o.end.timezone === null), "the slots are floating too");
  assert.deepEqual(utc.map((o) => o.occurrenceId), [`${floating.id}@2026-10-26T09:00:00Z`, `${floating.id}@2026-11-02T09:00:00Z`, `${floating.id}@2026-11-09T09:00:00Z`], "refs carry the wall clock, the way a floating exdate does");
  // Read in Los Angeles the same row is still 09:00 on the wall, across the DST change on Nov 1, and its slots are spelled the same.
  const la = expandEvent(floating, [], win("2026-10-26T07:00:00Z", "2026-11-16T08:00:00Z", LA));
  assert.deepEqual(wallStarts(la), ["2026-10-26 09:00", "2026-11-02 09:00", "2026-11-09 09:00"]);
  assert.deepEqual(starts(la), starts(utc));
  // The window is checked where the wall clock falls in the display zone: 09:00 LA on Oct 26 is 16:00Z, so a window ending at 15:00Z that day has no slot yet, and one starting at 16:30Z still has it.
  assert.deepEqual(starts(expandEvent(floating, [], win("2026-10-26T00:00:00Z", "2026-10-26T15:00:00Z", LA))), []);
  assert.deepEqual(starts(expandEvent(floating, [], win("2026-10-26T16:30:00Z", "2026-10-27T00:00:00Z", LA))), ["2026-10-26T09:00:00Z"]);
  // And ordered by that instant: a floating 09:00 sorts after a zoned 08:30 LA (15:30Z) and before a zoned 09:30 LA, though its `at` reads 09:00Z.
  const early = timed("2026-10-26T08:30:00", null);
  const late = timed("2026-10-26T09:30:00", null);
  const mixed = expandEvents([late, floating, early], win("2026-10-26T07:00:00Z", "2026-10-27T07:00:00Z", LA));
  assert.deepEqual(mixed.map((o) => o.id), [early.id, floating.id, late.id]);
});

test("a single floating event overlaps the window where its wall clock falls in the display zone", () => {
  // 01:00 on Sept 12, floating: 01:00Z as spelled, 08:00Z when read in Los Angeles. The LA day of Sept 12 is [07:00Z Sept 12, 07:00Z Sept 13).
  const oneAm = timed("2026-09-12T01:00:00", null, { zone: null });
  const laDay = win("2026-09-12T07:00:00Z", "2026-09-13T07:00:00Z", LA);
  assert.deepEqual(starts(expandEvent(oneAm, [], laDay)), ["2026-09-12T01:00:00Z"], "shows on Sept 12 in LA, where 01:00 falls after the day began");
  assert.deepEqual(starts(expandEvent(oneAm, [], win("2026-09-11T07:00:00Z", "2026-09-12T07:00:00Z", LA))), [], "not on Sept 11 in LA, though 01:00Z is inside that UTC span");
  // The same row read in Kolkata (Sept 12 is [18:30Z Sept 11, 18:30Z Sept 12)) is 01:00 on Sept 12 there too.
  assert.deepEqual(starts(expandEvent(oneAm, [], win("2026-09-11T18:30:00Z", "2026-09-12T18:30:00Z", "Asia/Kolkata"))), ["2026-09-12T01:00:00Z"]);
  const [only] = expandEvent(oneAm, [], laDay);
  assert.deepEqual(only!.start, { at: "2026-09-12T01:00:00Z", timezone: null }, "the occurrence keeps the floating encoding");
  assert.equal(only!.occurrenceId, `${oneAm.id}@2026-09-12T01:00:00Z`);
});

test("a window that starts mid-series picks up from the right slot, and counts from the start", () => {
  const weekly = timed("2020-01-06T09:00:00", "FREQ=WEEKLY;BYDAY=MO");
  assert.deepEqual(wallStarts(expandEvent(weekly, [], win("2026-09-08T07:00:00Z", "2026-09-22T07:00:00Z"))), ["2026-09-14 09:00", "2026-09-21 09:00"]);
  const counted = timed("2026-09-01T09:00:00", "FREQ=DAILY;COUNT=10");
  assert.deepEqual(wallStarts(expandEvent(counted, [], win("2026-09-08T07:00:00Z", "2026-09-30T07:00:00Z"))), ["2026-09-08 09:00", "2026-09-09 09:00", "2026-09-10 09:00"], "COUNT is counted from the first occurrence, not the window");
  const long = timed("2026-09-07T09:00:00", "FREQ=WEEKLY;BYDAY=MO", { minutes: 3 * 24 * 60 });
  const midway = expandEvent(long, [], win("2026-09-15T07:00:00Z", "2026-09-16T07:00:00Z"));
  assert.deepEqual(wallStarts(midway), ["2026-09-14 09:00"], "an occurrence that started before the window and is still running shows");
});

test("an all-day series expands by date and overlaps the window in the display zone", () => {
  const weekly = allDay("2026-09-07", "FREQ=WEEKLY;BYDAY=MO");
  const list = expandEvent(weekly, [], win("2026-09-14T07:00:00Z", "2026-09-28T07:00:00Z"));
  assert.deepEqual(list.map((o) => [o.occurrenceId, o.start, o.end]), [
    [`${weekly.id}@2026-09-14`, { date: "2026-09-14" }, { date: "2026-09-15" }],
    [`${weekly.id}@2026-09-21`, { date: "2026-09-21" }, { date: "2026-09-22" }],
  ]);
  // The LA day of the 14th starts at 07:00Z; a window that ends at 06:59Z on the 14th does not reach it.
  assert.deepEqual(starts(expandEvent(weekly, [], win("2026-09-08T07:00:00Z", "2026-09-14T06:59:00Z"))), []);
  assert.deepEqual(starts(expandEvent(weekly, [], win("2026-09-08T07:00:00Z", "2026-09-14T07:01:00Z"))), ["2026-09-14"]);
  // A three-day all-day series keeps its span, and a window inside a span still sees it.
  const retreat = allDay("2026-09-04", "FREQ=MONTHLY;BYDAY=1FR", 3);
  const list3 = expandEvent(retreat, [], win("2026-09-05T07:00:00Z", "2026-09-06T07:00:00Z"));
  assert.deepEqual(list3.map((o) => [o.start, o.end]), [[{ date: "2026-09-04" }, { date: "2026-09-07" }]]);
  assert.deepEqual(starts(expandEvent(retreat, [], win("2026-10-01T07:00:00Z", "2026-11-01T07:00:00Z"))), ["2026-10-02"]);
  // An all-day exception moves a date.
  const holiday = allDay("2026-09-07", "FREQ=WEEKLY;BYDAY=MO");
  const shifted = exception(holiday, { date: "2026-09-14" }, { start: { date: "2026-09-15" }, end: { date: "2026-09-16" } });
  const withShift = expandEvent(holiday, [shifted], win("2026-09-14T07:00:00Z", "2026-09-21T07:00:00Z"));
  assert.deepEqual(withShift.map((o) => [o.occurrenceId, o.start, o.master]), [[`${holiday.id}@2026-09-14`, { date: "2026-09-15" }, false]]);
});

test("expandEvents groups exception rows under their master and sorts across events", () => {
  const master = timed("2026-09-01T09:00:00", "FREQ=DAILY");
  const moved = exception(master, { at: "2026-09-08T16:00:00Z", timezone: LA }, { start: { at: "2026-09-08T14:00:00Z", timezone: LA }, end: { at: "2026-09-08T15:00:00Z", timezone: LA } });
  const single = timed("2026-09-08T08:30:00", null);
  const dayOff = allDay("2026-09-08", null);
  const orphan = exception(event({ ...master, id: "e_gonemaster" }), { at: "2026-09-08T20:00:00Z", timezone: LA }, { title: "Orphan", start: { at: "2026-09-08T21:00:00Z", timezone: LA }, end: { at: "2026-09-08T22:00:00Z", timezone: LA } });
  const list = expandEvents([moved, single, master, dayOff, orphan], win("2026-09-08T07:00:00Z", "2026-09-09T07:00:00Z"));
  assert.deepEqual(list.map((o) => [o.occurrenceId, o.master]), [
    [`${dayOff.id}@2026-09-08`, true],
    [`${moved.masterId}@2026-09-08T16:00:00Z`, false],
    [`${single.id}@2026-09-08T15:30:00Z`, true],
    [`e_gonemaster@2026-09-08T20:00:00Z`, false],
  ]);
  assert.equal(list.filter((o) => o.id === master.id).length, 0, "the master's own slot is replaced, not duplicated");
  const orphanOcc = list[3]!;
  assert.deepEqual(orphanOcc.start, { at: "2026-09-08T21:00:00Z", timezone: LA }, "an orphan exception shows at its own time");
  assert.deepEqual(orphanOcc.originalStart, { at: "2026-09-08T20:00:00Z", timezone: LA });
  assert.equal(orphanOcc.id, orphan.id);
});

test("occurrence refs round-trip and reject what is not one", () => {
  assert.equal(occurrenceRef("e_abc1234567", { at: "2026-09-10T16:00:00Z", timezone: LA }), "e_abc1234567@2026-09-10T16:00:00Z");
  assert.equal(occurrenceRef("e_abc1234567", { date: "2026-09-10" }), "e_abc1234567@2026-09-10");
  assert.equal(occurrenceRef("e_abc1234567", "2026-09-10"), "e_abc1234567@2026-09-10");
  assert.deepEqual(parseOccurrenceRef("e_abc1234567@2026-09-10T16:00:00Z"), { eventId: "e_abc1234567", originalStart: "2026-09-10T16:00:00Z" });
  assert.deepEqual(parseOccurrenceRef("e_abc1234567@2026-09-10"), { eventId: "e_abc1234567", originalStart: "2026-09-10" });
  for (const bad of ["e_abc1234567", "@2026-09-10", "e_abc1234567@", "e_abc1234567@tomorrow", "e_abc1234567@2026-09-10T16:00Z", "e_abc1234567@2026-02-30"]) {
    assert.equal(parseOccurrenceRef(bad), null, bad);
    assert.equal(isOccurrenceRef(bad), false, bad);
  }
  assert.equal(isOccurrenceRef("e_abc1234567@2026-09-10T16:00:00Z"), true);
  const master = timed("2026-09-01T09:00:00", "FREQ=DAILY");
  const [first] = expandEvent(master, [], win("2026-09-08T07:00:00Z", "2026-09-09T07:00:00Z"));
  assert.deepEqual(parseOccurrenceRef(first!.occurrenceId), { eventId: master.id, originalStart: "2026-09-08T16:00:00Z" });
});

test("a rule the library cannot run reports an issue and shows the master once, never nothing", () => {
  const issues: { eventId: string; message: string }[] = [];
  const broken = timed("2026-09-08T09:00:00", "FREQ=FORTNIGHTLY");
  const list = expandEvent(broken, [], { ...win("2026-09-01T07:00:00Z", "2026-10-01T07:00:00Z"), onIssue: (i) => issues.push(i) });
  assert.deepEqual(starts(list), ["2026-09-08T16:00:00Z"]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.eventId, broken.id);
  assert.match(issues[0]!.message, /FORTNIGHTLY|FREQ/);
  const hourly = timed("2026-09-08T09:00:00", "FREQ=HOURLY;COUNT=5");
  const hourlyIssues: string[] = [];
  assert.equal(expandEvent(hourly, [], { ...win("2026-09-01T07:00:00Z", "2026-10-01T07:00:00Z"), onIssue: (i) => hourlyIssues.push(i.message) }).length, 1);
  assert.match(hourlyIssues[0]!, /HOURLY/);
  // A provider-folded DTSTART line is ignored in favour of the row's own start.
  const folded = timed("2026-09-08T09:00:00", "DTSTART;TZID=America/Los_Angeles:20200101T090000\nRRULE:FREQ=DAILY;COUNT=2");
  assert.deepEqual(wallStarts(expandEvent(folded, [], win("2026-09-01T07:00:00Z", "2026-10-01T07:00:00Z"))), ["2026-09-08 09:00", "2026-09-09 09:00"]);
});
