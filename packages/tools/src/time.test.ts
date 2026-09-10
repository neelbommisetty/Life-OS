import { test } from "node:test";
import assert from "node:assert/strict";
import { zonedToInstant, parseInstant, localDate, localTime, relativeDate, dayWindow, isValidDate, addDays, instantOf } from "./time.ts";

test("wall-clock times resolve in a timezone, including across DST", () => {
  assert.equal(zonedToInstant("2026-09-08T09:00", "America/Los_Angeles")?.toISOString(), "2026-09-08T16:00:00.000Z");
  assert.equal(zonedToInstant("2026-12-08T09:00", "America/Los_Angeles")?.toISOString(), "2026-12-08T17:00:00.000Z");
  assert.equal(zonedToInstant("2026-09-08T09:00", "Asia/Kolkata")?.toISOString(), "2026-09-08T03:30:00.000Z");
  assert.equal(zonedToInstant("2026-02-30T09:00", "UTC"), null);
  assert.equal(parseInstant("2026-09-08T09:00:00-07:00", "UTC"), "2026-09-08T16:00:00Z");
  assert.equal(localDate("2026-09-08T16:00:00Z", "America/Los_Angeles"), "2026-09-08");
  assert.equal(localTime("2026-09-09T06:30:00Z", "America/Los_Angeles"), "23:30");
  assert.equal(localDate("2026-09-09T06:30:00Z", "America/Los_Angeles"), "2026-09-08");
});

test("relative dates and day windows", () => {
  const today = "2026-09-06";
  assert.equal(relativeDate("today", today), today);
  assert.equal(relativeDate("tomorrow", today), "2026-09-07");
  assert.equal(relativeDate("+7d", today), "2026-09-13");
  assert.equal(relativeDate("-1w", today), "2026-08-30");
  assert.equal(relativeDate("2026-10-21", today), "2026-10-21");
  assert.equal(relativeDate("next week", today), null);
  assert.deepEqual(dayWindow("2026-09-06", "America/Los_Angeles"), { start: "2026-09-06T07:00:00Z", end: "2026-09-07T07:00:00Z" });
  assert.equal(isValidDate("2026-02-29"), false);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("instantOf: a zoned When is its instant, a floating one is its wall clock read in the display zone, a date is midnight there", () => {
  const zoned = { at: "2026-09-12T15:00:00Z", timezone: "America/Los_Angeles" };
  assert.equal(instantOf(zoned, "Asia/Kolkata"), Date.parse("2026-09-12T15:00:00Z"), "the display zone does not move a zoned instant");
  // A floating 08:00 is stored as 08:00Z and happens at 08:00 wherever Neel is.
  const floating = { at: "2026-09-12T08:00:00Z", timezone: null };
  assert.equal(instantOf(floating, "UTC"), Date.parse("2026-09-12T08:00:00Z"));
  assert.equal(instantOf(floating, "America/Los_Angeles"), Date.parse("2026-09-12T15:00:00Z"));
  assert.equal(instantOf(floating, "Asia/Kolkata"), Date.parse("2026-09-12T02:30:00Z"));
  assert.equal(instantOf({ at: "2026-12-12T08:00:00Z", timezone: null }, "America/Los_Angeles"), Date.parse("2026-12-12T16:00:00Z"), "and follows the zone's offset through the year");
  assert.equal(instantOf({ date: "2026-09-12" }, "America/Los_Angeles"), Date.parse("2026-09-12T07:00:00Z"));
  assert.equal(instantOf({ date: "2026-09-12" }, "Asia/Kolkata"), Date.parse("2026-09-11T18:30:00Z"));
});
