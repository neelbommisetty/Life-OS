import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarTime,
  taskCalendarTime,
  draftFor,
  draftFromSelection,
  filterDays,
  inputFromDraft,
  monthDates,
  safeLink,
  updateFromDraft,
  wallTime,
  type Calendar,
  type Day,
  type Occurrence,
} from "./calendar-model.ts";
const zone = "America/Los_Angeles";
test("task calendar duration uses elapsed minutes in the task timezone, including DST and midnight", () => {
  const timed = (date: string, time: string, duration?: number) =>
    taskCalendarTime({ due: { date, time, timezone: zone }, duration }, "UTC");
  assert.deepEqual(timed("2026-09-29", "09:00", 45), {
    start: "2026-09-29T09:00:00.000-07:00",
    end: "2026-09-29T09:45:00.000-07:00",
    allDay: false,
  });
  assert.equal(timed("2026-09-29", "23:30", 90).end, "2026-09-30T01:00:00.000-07:00");
  assert.equal(timed("2026-03-08", "01:30", 120).end, "2026-03-08T04:30:00.000-07:00");
  assert.equal(timed("2026-11-01", "00:30", 120).end, "2026-11-01T01:30:00.000-08:00");
  assert.equal(timed("2026-09-29", "09:00").end, undefined);
  assert.deepEqual(taskCalendarTime({ due: { date: "2026-09-29" }, duration: 45 }, zone), {
    start: "2026-09-29", allDay: true,
  });
  assert.equal(taskCalendarTime({ due: { date: "2026-09-29", time: "09:00" }, duration: 30 }, "UTC").end,
    "2026-09-29T09:30:00.000Z");
});
const base = () => ({
  ...draftFor("2026-09-25", zone, "c_example"),
  title: "Example",
});
test("all-day editor uses inclusive last day and API exclusive end", () => {
  const draft = { ...base(), end: "2026-09-27" };
  assert.deepEqual(inputFromDraft(draft).end, { date: "2026-09-28" });
  assert.equal(
    draftFromSelection("2026-09-25", "2026-09-28", true, zone, "c_example").end,
    "2026-09-27",
  );
  assert.throws(
    () => inputFromDraft({ ...draft, end: "2026-09-24" }),
    /end after/,
  );
});
test("timed input uses the event zone rather than the machine zone and rejects DST gaps and ambiguities", () => {
  const timed = {
    ...base(),
    allDay: false,
    start: "2026-09-25T09:00",
    end: "2026-09-25T10:00",
  };
  assert.deepEqual(inputFromDraft(timed).start, {
    at: "2026-09-25T16:00:00.000Z",
    timezone: zone,
  });
  assert.throws(
    () =>
      inputFromDraft({
        ...timed,
        start: "2026-03-08T02:30",
        end: "2026-03-08T04:00",
      }),
    /does not exist/,
  );
  assert.throws(
    () =>
      inputFromDraft({
        ...timed,
        start: "2026-11-01T01:30",
        end: "2026-11-01T04:00",
      }),
    /occurs twice/,
  );
  assert.throws(
    () => inputFromDraft({ ...timed, end: timed.start }),
    /end after/,
  );
  assert.throws(
    () => inputFromDraft({ ...timed, timezone: "Invalid/Timezone" }),
    /valid timezone/,
  );
});
test("floating events keep wall time, zoned events retain their instant", () => {
  const floating = { at: "2026-09-25T09:00:00Z", timezone: null };
  assert.equal(wallTime(floating, zone), "2026-09-25T09:00");
  assert.equal(calendarTime(floating, zone), "2026-09-25T09:00");
  assert.equal(
    wallTime({ ...floating, timezone: "UTC" }, zone),
    "2026-09-25T02:00",
  );
  assert.deepEqual(
    inputFromDraft({
      ...base(),
      allDay: false,
      floating: true,
      start: "2026-09-25T09:00",
      end: "2026-09-25T10:00",
    }).start,
    { at: "2026-09-25T09:00:00.000Z", timezone: null },
  );
});
test("metadata edits preserve exact times, custom recurrence, and ambiguous existing times", () => {
  const original = {
    ...base(),
    allDay: false,
    start: "2026-11-01T01:30",
    end: "2026-11-01T03:00",
    repeat: "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=12",
  };
  assert.deepEqual(
    updateFromDraft({ ...original, notes: "Changed only this" }, original),
    { notes: "Changed only this" },
  );
  assert.deepEqual(updateFromDraft({ ...original, repeat: "" }, original), {
    repeat: null,
  });
  assert.deepEqual(
    updateFromDraft({ ...original, title: "Updated" }, original),
    { title: "Updated" },
  );
});
test("month dates include 42 contiguous cells through leap day and year rollover", () => {
  const feb = monthDates("2028-02-15");
  assert.equal(feb.length, 42);
  assert.ok(feb.includes("2028-02-29"));
  assert.equal(new Date(feb[0] + "T12:00:00Z").getUTCDay(), 0);
  assert.ok(monthDates("2026-12-15").includes("2027-01-01"));
});
test("calendar filtering respects hidden defaults, explicit selections, tasks, and title/location search", () => {
  const calendars = [
    { id: "a", hidden: false },
    { id: "b", hidden: true },
  ] as Calendar[];
  const event = {
    occurrenceId: "e_a@2026-09-25",
    calendarId: "a",
    title: "Lunch",
    location: "Cafe",
    notes: null,
  } as Occurrence;
  const days: Day[] = [
    {
      date: "2026-09-25",
      allDay: [],
      timed: [
        { kind: "event", occurrence: event },
        {
          kind: "event",
          occurrence: {
            ...event,
            occurrenceId: "e_b@2026-09-25",
            calendarId: "b",
          },
        },
      ],
    },
  ];
  assert.equal(
    filterDays(days, calendars, {}, true, "cafe")[0].timed.length,
    1,
  );
  assert.equal(
    filterDays(days, calendars, { a: false, b: true }, true, "")[0].timed
      .length,
    1,
  );
  assert.equal(
    filterDays(days, calendars, { a: false }, true, "")[0].timed.length,
    0,
  );
  assert.equal(
    filterDays(days, calendars, {}, true, "missing")[0].timed.length,
    0,
  );
  assert.equal(safeLink("javascript:alert(1)"), undefined);
  assert.equal(
    safeLink("https://meet.google.com/example"),
    "https://meet.google.com/example",
  );
});
