import { test } from "node:test";
import assert from "node:assert/strict";
import type { On } from "../contract.ts";
import { ON_FORMS, compareOn, formatOn, isoWeekEnd, isoWeekStart, onIssue, onKey, onRange, parseOn, yearOf } from "./on.ts";

const parsed = (input: string): On => {
  const result = parseOn(input);
  if (!result.ok) throw new Error(`${input}: ${result.error}`);
  return result.on;
};

const error = (input: string): string => {
  const result = parseOn(input);
  if (result.ok) throw new Error(`${input} should not parse`);
  return result.error;
};

test("every date form parses to its precision and formats back", () => {
  const roundTrips: [string, On][] = [
    ["2026-09-07", { date: "2026-09-07", precision: "day" }],
    ["2026-09-07~w", { date: "2026-09-07", precision: "week" }],
    ["2026-09", { date: "2026-09", precision: "month" }],
    ["2026", { date: "2026", precision: "year" }],
    ["?", { date: null, precision: "unknown" }],
  ];
  for (const [text, on] of roundTrips) {
    assert.deepEqual(parsed(text), on, text);
    assert.equal(formatOn(on), text, text);
    assert.equal(onIssue(on), null, text);
  }
  assert.deepEqual(parsed("  2026-09-07 "), { date: "2026-09-07", precision: "day" }, "surrounding space is fine");
});

test("a week is stored as the Monday of the ISO week containing the day typed", () => {
  // 2026-09-07 is a Monday; the 9th is the Wednesday and the 13th the Sunday of that week.
  assert.deepEqual(parsed("2026-09-09~w"), { date: "2026-09-07", precision: "week" });
  assert.deepEqual(parsed("2026-09-13~w"), { date: "2026-09-07", precision: "week" });
  assert.deepEqual(parsed("2026-09-14~w"), { date: "2026-09-14", precision: "week" }, "the next Monday starts the next week");
  assert.equal(formatOn(parsed("2026-09-09~w")), "2026-09-07~w");
  assert.equal(isoWeekStart("2026-09-09"), "2026-09-07");
  assert.equal(isoWeekEnd("2026-09-09"), "2026-09-13");
  assert.equal(isoWeekStart("2026-09-07"), "2026-09-07", "a Monday is its own week start");
  assert.equal(isoWeekStart("2026-09-13"), "2026-09-07", "a Sunday belongs to the week that began the Monday before");
  assert.equal(isoWeekStart("2027-01-01"), "2026-12-28", "ISO weeks cross the year boundary");
  assert.equal(isoWeekEnd("2026-12-28"), "2027-01-03");
});

test("malformed forms are rejected with the accepted forms named", () => {
  for (const bad of ["2026-9", "2026-09-31", "~m", "2026-09~w", "2026-09-07~m", "2026-09-07~d", "2026-13", "2026-02-29", "26-09-07", "yesterday", "", "20260907"]) {
    const message = error(bad);
    assert.match(message, /YYYY-MM-DD, YYYY-MM-DD~w \(the ISO week containing that day\), YYYY-MM, YYYY, or \? \(unknown\)/, bad);
    assert.equal(message.includes(ON_FORMS), true, bad);
  }
  assert.match(error("2026-09-31"), /"2026-09-31" is not a real date/);
  assert.match(error("2026-9"), /"2026-9" is not a date form/);
  assert.match(error("2026-13"), /"2026-13" is not a real month/);
  assert.match(error("~m"), /the only marker is ~w after a full date/);
  assert.match(error("2026-09-31~w"), /not a real date/);
  assert.match(error(""), /Empty date/);
});

test("onIssue names why a stored On is malformed", () => {
  assert.equal(onIssue({ date: "2026-09-09", precision: "week" }), "A week's date is the Monday of its ISO week");
  assert.equal(onIssue({ date: "2026-09-31", precision: "day" }), "Use YYYY-MM-DD for a day");
  assert.equal(onIssue({ date: "2026-9", precision: "month" }), "Use YYYY-MM for a month");
  assert.equal(onIssue({ date: "2026-09", precision: "year" }), "Use YYYY for a year");
  assert.equal(onIssue({ date: "2026-09-07", precision: "unknown" }), "An unknown date carries no date");
  assert.equal(onIssue({ date: null, precision: "day" }), "A day needs a date");
  assert.equal(onIssue({ date: "2026-09-07", precision: "month" }), "Use YYYY-MM for a month", "a day spelled at month precision is wrong");
});

test("ordering: unknown first, then the first day covered, then coarser before finer", () => {
  const order = ["?", "2025", "2026", "2026-09", "2026-09-07~w", "2026-09-07", "2026-09-08", "2026-09-14~w", "2026-10"].map(parsed);
  const shuffled = [...order].reverse();
  assert.deepEqual(shuffled.sort(compareOn).map(formatOn), order.map(formatOn));
  assert.equal(compareOn(parsed("2026-09-07~w"), parsed("2026-09-07")), -1, "week before day on the same date");
  assert.equal(compareOn(parsed("2026-06"), parsed("2026-06-01~w")), -1, "month before a week starting the same day (2026-06-01 is a Monday)");
  assert.equal(compareOn(parsed("2026-09-01~w"), parsed("2026-09")), -1, "a week that began in August sorts before September");
  assert.equal(compareOn(parsed("2026"), parsed("2026-01")), -1, "year before month");
  assert.equal(compareOn(parsed("?"), parsed("1900")), -1, "unknown before anything dated");
  assert.equal(compareOn(parsed("2026-09-05"), parsed("2026-09-07~w")), -1, "a day before the week begins sorts before it");
  assert.equal(compareOn(parsed("2026-09-07"), parsed("2026-09-07")), 0);
  assert.equal(onKey(parsed("2026-09-07~w")) < onKey(parsed("2026-09-07")), true, "the key compares as text");
});

test("onRange covers the days an On stands for and yearOf reads its year", () => {
  assert.deepEqual(onRange(parsed("2026-09-07")), { start: "2026-09-07", end: "2026-09-07" });
  assert.deepEqual(onRange(parsed("2026-09-09~w")), { start: "2026-09-07", end: "2026-09-13" });
  assert.deepEqual(onRange(parsed("2026-02")), { start: "2026-02-01", end: "2026-02-28" });
  assert.deepEqual(onRange(parsed("2028-02")), { start: "2028-02-01", end: "2028-02-29" }, "leap February");
  assert.deepEqual(onRange(parsed("2026-12")), { start: "2026-12-01", end: "2026-12-31" }, "December rolls into the next year");
  assert.deepEqual(onRange(parsed("2026")), { start: "2026-01-01", end: "2026-12-31" });
  assert.equal(onRange(parsed("?")), null);
  assert.equal(yearOf(parsed("2026-09-07")), 2026);
  assert.equal(yearOf(parsed("2026-12-28~w")), 2026, "a week is placed by its Monday");
  assert.equal(yearOf(parsed("2025-11")), 2025);
  assert.equal(yearOf(parsed("2024")), 2024);
  assert.equal(yearOf(parsed("?")), null);
});
