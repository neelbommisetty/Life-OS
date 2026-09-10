import { test } from "node:test";
import assert from "node:assert/strict";
import { eventWriteSchema, type EventPatch, type EventWrite, type When } from "../../contract.ts";
import {
  fromGoogleCalendar,
  fromGoogleEvent,
  recurrenceFromGoogle,
  recurrenceToGoogle,
  toGoogleInsert,
  toGooglePatch,
  whenFromGoogle,
  whenToGoogle,
  type GoogleCalendarListEntry,
  type GoogleEvent,
  type MapContext,
} from "./map.ts";

const ctx: MapContext = { calendarTimezone: "America/Los_Angeles", fetchedAt: "2026-09-09T12:00:00Z" };

/** A realistic `events.list` item, as Google returns it for a timed event with guests, Meet, and overridden reminders. */
const standup: GoogleEvent = {
  id: "5k3m2n1p0q9r8s7t6u5v4w3x2y",
  etag: '"3455127964816000"',
  status: "confirmed",
  summary: "Team standup",
  description: "Agenda in the doc.\nBring blockers.",
  location: "Room 4B, 1600 Amphitheatre Pkwy",
  start: { dateTime: "2026-09-10T09:00:00-07:00", timeZone: "America/Los_Angeles" },
  end: { dateTime: "2026-09-10T09:30:00-07:00", timeZone: "America/Los_Angeles" },
  organizer: { email: "priya@example.com", displayName: "Priya Raman" },
  attendees: [
    { email: "priya@example.com", displayName: "Priya Raman", organizer: true, responseStatus: "accepted" },
    { email: "neel@example.com", self: true, responseStatus: "needsAction" },
    { email: "sam@example.com", displayName: "Sam Ortiz", optional: true, responseStatus: "tentative" },
    { email: "room-4b@resource.calendar.google.com", displayName: "Room 4B", resource: true, responseStatus: "accepted" },
  ],
  conferenceData: {
    entryPoints: [
      { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij", label: "meet.google.com/abc-defg-hij" },
      { entryPointType: "phone", uri: "tel:+1-555-0100", label: "+1 555-0100" },
    ],
    conferenceSolution: { name: "Google Meet", key: { type: "hangoutsMeet" } },
  },
  hangoutLink: "https://meet.google.com/abc-defg-hij",
  reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }, { method: "email", minutes: 60 }] },
  extendedProperties: { private: { lifeId: "e_0123456789" } },
  iCalUID: "5k3m2n1p0q9r8s7t6u5v4w3x2y@google.com",
  updated: "2026-09-01T17:22:41.123Z",
};

test("timed event: every field maps", () => {
  const event = fromGoogleEvent(standup, ctx);
  assert.deepEqual(event.start, { at: "2026-09-10T16:00:00Z", timezone: "America/Los_Angeles" });
  assert.deepEqual(event.end, { at: "2026-09-10T16:30:00Z", timezone: "America/Los_Angeles" });
  assert.equal(event.title, "Team standup");
  assert.equal(event.notes, "Agenda in the doc.\nBring blockers.");
  assert.equal(event.location, "Room 4B, 1600 Amphitheatre Pkwy");
  assert.equal(event.repeat, null);
  assert.equal(event.originalStart, null);
  assert.equal(event.providerMasterId, null);
  assert.equal(event.status, "confirmed");
  assert.equal(event.busy, true, "no transparency on a timed event means opaque");
  assert.deepEqual(event.organizer, { email: "priya@example.com", name: "Priya Raman", self: false });
  assert.deepEqual(event.attendees, [
    { email: "priya@example.com", name: "Priya Raman", response: "accepted", self: false, optional: false },
    { email: "neel@example.com", name: null, response: "needsAction", self: true, optional: false },
    { email: "sam@example.com", name: "Sam Ortiz", response: "tentative", self: false, optional: true },
  ]);
  assert.equal(event.myResponse, "needsAction");
  assert.deepEqual(event.conferencing, { kind: "meet", url: "https://meet.google.com/abc-defg-hij" });
  assert.deepEqual(event.reminders, [
    { method: "popup", minutes: 10 },
    { method: "email", minutes: 60 },
  ]);
  assert.deepEqual(event.external, {
    provider: "google",
    id: "5k3m2n1p0q9r8s7t6u5v4w3x2y",
    etag: '"3455127964816000"',
    iCalUID: "5k3m2n1p0q9r8s7t6u5v4w3x2y@google.com",
    updatedAt: "2026-09-01T17:22:41Z",
  });
  assert.equal(event.lifeId, "e_0123456789");
  assert.equal(event.deleted, false);
});

test("all-day event: dates pass through with the exclusive end, and busy defaults to false", () => {
  const item: GoogleEvent = {
    id: "allday1",
    etag: '"1"',
    status: "confirmed",
    summary: "Offsite",
    start: { date: "2026-09-14" },
    end: { date: "2026-09-16" },
    iCalUID: "allday1@google.com",
    updated: "2026-09-01T00:00:00.000Z",
  };
  const event = fromGoogleEvent(item, ctx);
  assert.deepEqual(event.start, { date: "2026-09-14" });
  assert.deepEqual(event.end, { date: "2026-09-16" });
  assert.equal(event.busy, false);
  assert.equal(fromGoogleEvent({ ...item, transparency: "opaque" }, ctx).busy, true);
  assert.equal(fromGoogleEvent({ ...item, transparency: "transparent" }, ctx).busy, false);
  assert.equal(fromGoogleEvent({ ...standup, transparency: "transparent" }, ctx).busy, false);
});

test("a dateTime without timeZone keeps the offset's instant and takes the calendar's zone", () => {
  const event = fromGoogleEvent(
    {
      id: "nozone",
      etag: '"1"',
      summary: "Call",
      start: { dateTime: "2026-09-10T18:00:00+02:00" },
      end: { dateTime: "2026-09-10T18:45:00+02:00" },
      updated: "2026-09-01T00:00:00Z",
    },
    ctx,
  );
  assert.deepEqual(event.start, { at: "2026-09-10T16:00:00Z", timezone: "America/Los_Angeles" });
  assert.deepEqual(event.end, { at: "2026-09-10T16:45:00Z", timezone: "America/Los_Angeles" });
});

test("floating: written as the wall clock in the calendar's zone with a stamp, read back with no zone", () => {
  const write: EventWrite = {
    title: "Morning pages",
    notes: null,
    location: null,
    start: { at: "2026-09-10T07:00:00Z", timezone: null },
    end: { at: "2026-09-10T07:30:00Z", timezone: null },
    repeat: null,
    busy: true,
    status: "confirmed",
  };
  const body = toGoogleInsert(write, "e_float000001", ctx);
  assert.deepEqual(body.start, { dateTime: "2026-09-10T07:00:00", timeZone: "America/Los_Angeles" });
  assert.deepEqual(body.end, { dateTime: "2026-09-10T07:30:00", timeZone: "America/Los_Angeles" });
  assert.deepEqual(body.extendedProperties, { private: { lifeId: "e_float000001", lifeFloating: "true" } });

  // Google echoes the wall clock in the zone with its offset.
  const readback = fromGoogleEvent(
    {
      id: "float1",
      etag: '"2"',
      summary: "Morning pages",
      start: { dateTime: "2026-09-10T07:00:00-07:00", timeZone: "America/Los_Angeles" },
      end: { dateTime: "2026-09-10T07:30:00-07:00", timeZone: "America/Los_Angeles" },
      extendedProperties: { private: { lifeId: "e_float000001", lifeFloating: "true" } },
      updated: "2026-09-01T00:00:00Z",
    },
    ctx,
  );
  assert.deepEqual(readback.start, { at: "2026-09-10T07:00:00Z", timezone: null });
  assert.deepEqual(readback.end, { at: "2026-09-10T07:30:00Z", timezone: null });
  assert.equal(readback.lifeId, "e_float000001");
  // Without the stamp the same JSON is a zoned event.
  assert.deepEqual(whenFromGoogle({ dateTime: "2026-09-10T07:00:00-07:00", timeZone: "America/Los_Angeles" }, ctx), {
    at: "2026-09-10T14:00:00Z",
    timezone: "America/Los_Angeles",
  });
});

test("recurrence: RRULE and EXDATE lines map, RDATE is ignored with a note", () => {
  const lines = [
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T075959Z",
    "EXDATE;TZID=America/Los_Angeles:20260914T090000,20260916T090000",
    "EXDATE:20260921T160000Z",
    "RDATE;TZID=America/Los_Angeles:20260918T090000",
  ];
  const timed = recurrenceFromGoogle(lines, { timezone: "America/Los_Angeles", allDay: false });
  assert.deepEqual(timed.repeat, {
    rrule: "FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T075959Z",
    exdates: ["2026-09-14T16:00:00Z", "2026-09-16T16:00:00Z", "2026-09-21T16:00:00Z"],
  });
  assert.deepEqual(timed.ignored, ["RDATE;TZID=America/Los_Angeles:20260918T090000"]);

  const allDay = recurrenceFromGoogle(["RRULE:FREQ=YEARLY", "EXDATE;VALUE=DATE:20270101,20280101"], { timezone: "UTC", allDay: true });
  assert.deepEqual(allDay.repeat, { rrule: "FREQ=YEARLY", exdates: ["2027-01-01", "2028-01-01"] });
  assert.deepEqual(recurrenceFromGoogle(undefined, { timezone: "UTC", allDay: false }), { repeat: null, ignored: [] });
  assert.deepEqual(recurrenceFromGoogle(["EXDATE:20260921T160000Z"], { timezone: "UTC", allDay: false }).repeat, null, "exdates without a rule are no rule");

  // A master with a rule, and a TZID without an explicit event zone falls back to the calendar's.
  const master = fromGoogleEvent(
    {
      id: "master1",
      etag: '"3"',
      summary: "Gym",
      start: { dateTime: "2026-09-07T06:00:00-07:00" },
      end: { dateTime: "2026-09-07T07:00:00-07:00" },
      recurrence: ["RRULE:FREQ=DAILY;COUNT=30", "EXDATE:20260910T060000"],
      updated: "2026-09-01T00:00:00Z",
    },
    ctx,
  );
  assert.deepEqual(master.repeat, { rrule: "FREQ=DAILY;COUNT=30", exdates: ["2026-09-10T13:00:00Z"] });
});

test("recurrence to Google: the rule line plus one EXDATE line per kind", () => {
  const repeat = { rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO", exdates: ["2026-09-14T16:00:00Z", "2026-09-21T16:00:00Z"] };
  assert.deepEqual(recurrenceToGoogle(repeat, { allDay: false, floating: false }, ctx), [
    "RRULE:FREQ=WEEKLY;BYDAY=MO",
    "EXDATE:20260914T160000Z,20260921T160000Z",
  ]);
  assert.deepEqual(recurrenceToGoogle({ rrule: "FREQ=YEARLY", exdates: ["2027-01-01"] }, { allDay: true, floating: false }, ctx), [
    "RRULE:FREQ=YEARLY",
    "EXDATE;VALUE=DATE:20270101",
  ]);
  assert.deepEqual(recurrenceToGoogle({ rrule: "FREQ=DAILY", exdates: ["2026-09-14T07:00:00Z"] }, { allDay: false, floating: true }, ctx), [
    "RRULE:FREQ=DAILY",
    "EXDATE;TZID=America/Los_Angeles:20260914T070000",
  ]);
  assert.deepEqual(recurrenceToGoogle({ rrule: "FREQ=DAILY", exdates: [] }, { allDay: false, floating: false }, ctx), ["RRULE:FREQ=DAILY"]);
  // Round trip: what we write, we read back.
  const back = recurrenceFromGoogle(recurrenceToGoogle(repeat, { allDay: false, floating: false }, ctx), { timezone: "America/Los_Angeles", allDay: false });
  assert.deepEqual(back.repeat, { rrule: "FREQ=WEEKLY;BYDAY=MO", exdates: repeat.exdates });
  const floatingBack = recurrenceFromGoogle(["RRULE:FREQ=DAILY", "EXDATE;TZID=America/Los_Angeles:20260914T070000"], { timezone: "America/Los_Angeles", allDay: false, floating: true });
  assert.deepEqual(floatingBack.repeat?.exdates, ["2026-09-14T07:00:00Z"]);
});

test("exception rows: recurringEventId and originalStartTime, and no rule of their own", () => {
  const moved = fromGoogleEvent(
    {
      id: "master1_20260915T130000Z",
      etag: '"4"',
      status: "confirmed",
      summary: "Gym (moved)",
      start: { dateTime: "2026-09-15T08:00:00-07:00", timeZone: "America/Los_Angeles" },
      end: { dateTime: "2026-09-15T09:00:00-07:00", timeZone: "America/Los_Angeles" },
      recurringEventId: "master1",
      originalStartTime: { dateTime: "2026-09-15T06:00:00-07:00", timeZone: "America/Los_Angeles" },
      // Google copies the master's recurrence onto some instance payloads; an exception row never carries a rule.
      recurrence: ["RRULE:FREQ=DAILY;COUNT=30"],
      iCalUID: "master1@google.com",
      updated: "2026-09-02T00:00:00Z",
    },
    ctx,
  );
  assert.equal(moved.providerMasterId, "master1");
  assert.deepEqual(moved.originalStart, { at: "2026-09-15T13:00:00Z", timezone: "America/Los_Angeles" });
  assert.deepEqual(moved.start, { at: "2026-09-15T15:00:00Z", timezone: "America/Los_Angeles" });
  assert.equal(moved.repeat, null);
  assert.equal(moved.status, "confirmed");
  assert.equal(moved.deleted, false);

  const allDayException = fromGoogleEvent(
    {
      id: "hol_20270101",
      etag: '"5"',
      summary: "Holiday",
      start: { date: "2027-01-02" },
      end: { date: "2027-01-03" },
      recurringEventId: "hol",
      originalStartTime: { date: "2027-01-01" },
      updated: "2026-09-02T00:00:00Z",
    },
    ctx,
  );
  assert.deepEqual(allDayException.originalStart, { date: "2027-01-01" });
});

test("cancelled instance: a stub with only the original start becomes a cancelled exception row, not a deletion", () => {
  const stub: GoogleEvent = {
    id: "master1_20260917T130000Z",
    etag: '"6"',
    status: "cancelled",
    recurringEventId: "master1",
    originalStartTime: { dateTime: "2026-09-17T06:00:00-07:00", timeZone: "America/Los_Angeles" },
  };
  const event = fromGoogleEvent(stub, ctx);
  assert.equal(event.status, "cancelled");
  assert.equal(event.deleted, false);
  assert.equal(event.providerMasterId, "master1");
  assert.deepEqual(event.originalStart, { at: "2026-09-17T13:00:00Z", timezone: "America/Los_Angeles" });
  assert.deepEqual(event.start, event.originalStart, "start falls back to the original start");
  assert.deepEqual(event.end, { at: "2026-09-17T14:00:00Z", timezone: "America/Los_Angeles" });
  assert.equal(event.title, "(No title)");
  assert.equal(event.external.iCalUID, "master1_20260917T130000Z@google.com");
  assert.equal(event.external.updatedAt, ctx.fetchedAt, "no updated on the stub: the fetch time stands in");
});

test("cancelled single event: deleted, and a bare stub still maps", () => {
  const event = fromGoogleEvent({ id: "gone1", etag: '"7"', status: "cancelled" }, ctx);
  assert.equal(event.deleted, true);
  assert.equal(event.status, "cancelled");
  assert.equal(event.providerMasterId, null);
  assert.equal(event.originalStart, null);
  assert.deepEqual(event.start, { date: "2026-09-09" });
  assert.deepEqual(event.end, { date: "2026-09-10" });
  assert.equal(event.external.id, "gone1");
  // A cancelled master that still carries its fields is deleted too.
  assert.equal(fromGoogleEvent({ ...standup, status: "cancelled" }, ctx).deleted, true);
  // Tentative passes through; an unknown status is confirmed.
  assert.equal(fromGoogleEvent({ ...standup, status: "tentative" }, ctx).status, "tentative");
  assert.equal(fromGoogleEvent({ ...standup, status: undefined }, ctx).status, "confirmed");
});

test("attendees: self decides myResponse, organizer.self, no attendees means no response", () => {
  const mine = fromGoogleEvent(
    {
      ...standup,
      organizer: { email: "neel@example.com", self: true },
      attendees: [
        { email: "neel@example.com", self: true, organizer: true, responseStatus: "accepted" },
        { email: "sam@example.com", responseStatus: "declined" },
      ],
    },
    ctx,
  );
  assert.deepEqual(mine.organizer, { email: "neel@example.com", name: null, self: true });
  assert.equal(mine.myResponse, "accepted");
  assert.equal(mine.attendees[1]?.response, "declined");

  const solo = fromGoogleEvent({ ...standup, attendees: undefined, organizer: { email: "neel@example.com", self: true } }, ctx);
  assert.deepEqual(solo.attendees, []);
  assert.equal(solo.myResponse, null);
  const noOrganizer = fromGoogleEvent({ ...standup, organizer: undefined }, ctx);
  assert.equal(noOrganizer.organizer, null);
  // An unknown responseStatus reads as needsAction; an attendee without an email is dropped.
  const odd = fromGoogleEvent({ ...standup, attendees: [{ email: "x@example.com", responseStatus: "maybe" }, { displayName: "ghost" }] }, ctx);
  assert.deepEqual(odd.attendees.map((a) => [a.email, a.response]), [["x@example.com", "needsAction"]]);
});

test("conferencing: video entry point first, hangoutLink as the fallback, none otherwise", () => {
  const zoom = fromGoogleEvent(
    {
      ...standup,
      hangoutLink: undefined,
      conferenceData: {
        entryPoints: [{ entryPointType: "video", uri: "https://zoom.us/j/123456", label: "zoom.us/j/123456" }],
        conferenceSolution: { name: "Zoom Meeting", key: { type: "addOn" } },
      },
    },
    ctx,
  );
  assert.deepEqual(zoom.conferencing, { kind: "Zoom Meeting", url: "https://zoom.us/j/123456" });
  const legacy = fromGoogleEvent({ ...standup, conferenceData: undefined }, ctx);
  assert.deepEqual(legacy.conferencing, { kind: "meet", url: "https://meet.google.com/abc-defg-hij" });
  const phoneOnly = fromGoogleEvent({ ...standup, hangoutLink: undefined, conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:+1" }] } }, ctx);
  assert.equal(phoneOnly.conferencing, null);
});

test("reminders: useDefault is null, overrides are the list, false with none is empty", () => {
  assert.equal(fromGoogleEvent({ ...standup, reminders: { useDefault: true } }, ctx).reminders, null);
  assert.equal(fromGoogleEvent({ ...standup, reminders: undefined }, ctx).reminders, null);
  assert.deepEqual(fromGoogleEvent({ ...standup, reminders: { useDefault: false } }, ctx).reminders, []);
  assert.deepEqual(fromGoogleEvent({ ...standup, reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 5 }] } }, ctx).reminders, [
    { method: "popup", minutes: 5 },
  ]);
});

test("lifeId round trip: the insert body stamps it and the readback carries it", () => {
  const write: EventWrite = eventWriteSchema.parse({
    title: "Dentist",
    notes: "bring the card",
    location: "12 High St",
    start: { at: "2026-09-10T16:00:00Z", timezone: "America/Los_Angeles" },
    end: { at: "2026-09-10T17:00:00Z", timezone: "America/Los_Angeles" },
    repeat: { rrule: "FREQ=MONTHLY;COUNT=6", exdates: ["2026-10-10T16:00:00Z"] },
    busy: true,
    status: "confirmed",
  });
  const body = toGoogleInsert(write, "e_dentist0001", ctx);
  assert.deepEqual(body, {
    summary: "Dentist",
    description: "bring the card",
    location: "12 High St",
    start: { dateTime: "2026-09-10T16:00:00Z", timeZone: "America/Los_Angeles" },
    end: { dateTime: "2026-09-10T17:00:00Z", timeZone: "America/Los_Angeles" },
    recurrence: ["RRULE:FREQ=MONTHLY;COUNT=6", "EXDATE:20261010T160000Z"],
    transparency: "opaque",
    status: "confirmed",
    extendedProperties: { private: { lifeId: "e_dentist0001" } },
  });
  // What Google would hand back for that insert.
  const readback = fromGoogleEvent(
    {
      id: "dent1",
      etag: '"8"',
      status: "confirmed",
      summary: "Dentist",
      description: "bring the card",
      location: "12 High St",
      start: { dateTime: "2026-09-10T09:00:00-07:00", timeZone: "America/Los_Angeles" },
      end: { dateTime: "2026-09-10T10:00:00-07:00", timeZone: "America/Los_Angeles" },
      recurrence: ["RRULE:FREQ=MONTHLY;COUNT=6", "EXDATE:20261010T160000Z"],
      extendedProperties: { private: { lifeId: "e_dentist0001" } },
      iCalUID: "dent1@google.com",
      updated: "2026-09-09T12:00:01.000Z",
    },
    ctx,
  );
  assert.equal(readback.lifeId, "e_dentist0001");
  assert.equal(readback.title, write.title);
  assert.equal(readback.notes, write.notes);
  assert.equal(readback.location, write.location);
  assert.deepEqual(readback.start, write.start);
  assert.deepEqual(readback.end, write.end);
  assert.deepEqual(readback.repeat, write.repeat);
  assert.equal(readback.busy, write.busy);
  assert.equal(readback.status, write.status);
  assert.equal(fromGoogleEvent({ ...standup, extendedProperties: undefined }, ctx).lifeId, null);
});

test("an instance inherits the master's private properties from Google, so its readback carries no lifeId of its own", () => {
  // Google hands extendedProperties down to instances and exceptions; the stamp names the master's row, and an
  // exception must not resolve to it in sync (nor claim the id): it is keyed by `<master>_<stamp>` alone.
  const exception = fromGoogleEvent(
    {
      id: "dent1_20261110T160000Z",
      etag: '"9"',
      status: "confirmed",
      summary: "Dentist (moved)",
      start: { dateTime: "2026-11-10T10:00:00-08:00", timeZone: "America/Los_Angeles" },
      end: { dateTime: "2026-11-10T11:00:00-08:00", timeZone: "America/Los_Angeles" },
      recurringEventId: "dent1",
      originalStartTime: { dateTime: "2026-11-10T08:00:00-08:00", timeZone: "America/Los_Angeles" },
      extendedProperties: { private: { lifeId: "e_dentist0001" } },
      iCalUID: "dent1@google.com",
      updated: "2026-09-09T12:00:02.000Z",
    },
    ctx,
  );
  assert.equal(exception.providerMasterId, "dent1");
  assert.equal(exception.lifeId, null, "the master's stamp is not the exception's id");
  const cancelledStub = fromGoogleEvent(
    { id: "dent1_20261210T160000Z", etag: '"10"', status: "cancelled", recurringEventId: "dent1", originalStartTime: { dateTime: "2026-12-10T08:00:00-08:00", timeZone: "America/Los_Angeles" }, extendedProperties: { private: { lifeId: "e_dentist0001" } } },
    ctx,
  );
  assert.equal(cancelledStub.lifeId, null);
});

test("insert: all-day and free events, empty notes and location left out", () => {
  const body = toGoogleInsert(
    { title: "Offsite", notes: null, location: null, start: { date: "2026-09-14" }, end: { date: "2026-09-16" }, repeat: null, busy: false, status: "tentative" },
    "e_offsite0001",
    ctx,
  );
  assert.deepEqual(body, {
    summary: "Offsite",
    start: { date: "2026-09-14" },
    end: { date: "2026-09-16" },
    transparency: "transparent",
    status: "tentative",
    extendedProperties: { private: { lifeId: "e_offsite0001" } },
  });
  assert.deepEqual(whenToGoogle({ date: "2026-09-14" }, ctx), { date: "2026-09-14" });
});

test("patch: only the given fields, null clears, a kind change nulls the other kind", () => {
  assert.deepEqual(toGooglePatch({}, ctx), {});
  assert.deepEqual(toGooglePatch({ title: "Renamed", busy: false }, ctx), { summary: "Renamed", transparency: "transparent" });
  assert.deepEqual(toGooglePatch({ notes: null, location: null, repeat: null }, ctx), { description: "", location: "", recurrence: [] });
  assert.deepEqual(toGooglePatch({ status: "cancelled" }, ctx), { status: "cancelled" });

  const timed: EventPatch = {
    start: { at: "2026-09-11T16:00:00Z", timezone: "Europe/London" },
    end: { at: "2026-09-11T17:00:00Z", timezone: "Europe/London" },
  };
  assert.deepEqual(toGooglePatch(timed, ctx), {
    start: { dateTime: "2026-09-11T16:00:00Z", timeZone: "Europe/London", date: null },
    end: { dateTime: "2026-09-11T17:00:00Z", timeZone: "Europe/London", date: null },
    extendedProperties: { private: { lifeFloating: "false" } },
  });
  assert.deepEqual(toGooglePatch({ start: { date: "2026-09-11" }, end: { date: "2026-09-12" } }, ctx), {
    start: { date: "2026-09-11", dateTime: null, timeZone: null },
    end: { date: "2026-09-12", dateTime: null, timeZone: null },
    extendedProperties: { private: { lifeFloating: "false" } },
  });
  const floating: When = { at: "2026-09-11T08:00:00Z", timezone: null };
  assert.deepEqual(toGooglePatch({ start: floating }, ctx), {
    start: { dateTime: "2026-09-11T08:00:00", timeZone: "America/Los_Angeles", date: null },
    extendedProperties: { private: { lifeFloating: "true" } },
  });
  // A rule change with the start known writes exdates for that kind; without it, the key shape decides.
  assert.deepEqual(toGooglePatch({ repeat: { rrule: "FREQ=WEEKLY", exdates: ["2026-09-18T16:00:00Z"] } }, ctx).recurrence, ["RRULE:FREQ=WEEKLY", "EXDATE:20260918T160000Z"]);
  assert.deepEqual(toGooglePatch({ repeat: { rrule: "FREQ=WEEKLY", exdates: ["2026-09-18"] } }, ctx).recurrence, ["RRULE:FREQ=WEEKLY", "EXDATE;VALUE=DATE:20260918"]);
  assert.deepEqual(toGooglePatch({ start: floating, repeat: { rrule: "FREQ=DAILY", exdates: ["2026-09-12T08:00:00Z"] } }, ctx).recurrence, [
    "RRULE:FREQ=DAILY",
    "EXDATE;TZID=America/Los_Angeles:20260912T080000",
  ]);
});

test("calendarList: access role, primary, hidden, colour, zone, and deleted entries", () => {
  const items: GoogleCalendarListEntry[] = [
    { id: "neel@example.com", summary: "neel@example.com", timeZone: "America/Los_Angeles", backgroundColor: "#9fe1e7", accessRole: "owner", primary: true },
    { id: "family@group.calendar.google.com", summary: "Family", summaryOverride: "Home", timeZone: "Europe/London", backgroundColor: "#f83a22", accessRole: "writer" },
    { id: "en.usa#holiday@group.v.calendar.google.com", summary: "Holidays in United States", accessRole: "reader", hidden: true },
    { id: "boss@example.com", summary: "Boss", accessRole: "freeBusyReader", timeZone: "Asia/Kolkata" },
    { id: "old@group.calendar.google.com", summary: "Old", accessRole: "owner", deleted: true },
  ];
  const mapped = items.map((item) => fromGoogleCalendar(item, { fallbackTimezone: "UTC" }));
  assert.deepEqual(mapped, [
    { id: "neel@example.com", name: "neel@example.com", color: "#9fe1e7", timezone: "America/Los_Angeles", writable: true, primary: true, hidden: false },
    { id: "family@group.calendar.google.com", name: "Home", color: "#f83a22", timezone: "Europe/London", writable: true, primary: false, hidden: false },
    { id: "en.usa#holiday@group.v.calendar.google.com", name: "Holidays in United States", color: null, timezone: "UTC", writable: false, primary: false, hidden: true },
    { id: "boss@example.com", name: "Boss", color: null, timezone: "Asia/Kolkata", writable: false, primary: false, hidden: false },
    null,
  ]);
});

test("moments: etag, iCalUID and updated fall back, untitled events get a title, malformed times are null", () => {
  const event = fromGoogleEvent({ ...standup, etag: undefined, iCalUID: undefined, updated: "not a date", summary: "   " }, ctx);
  assert.equal(event.external.etag, "missing:5k3m2n1p0q9r8s7t6u5v4w3x2y");
  assert.equal(event.external.iCalUID, "5k3m2n1p0q9r8s7t6u5v4w3x2y@google.com");
  assert.equal(event.external.updatedAt, ctx.fetchedAt);
  assert.equal(event.title, "(No title)");
  assert.equal(whenFromGoogle({ dateTime: "yesterday" }, ctx), null);
  assert.equal(whenFromGoogle(undefined, ctx), null);
  assert.equal(whenFromGoogle({}, ctx), null);
});
