import { test } from "node:test";
import assert from "node:assert/strict";
import { zonedToInstant, parseInstant, localDate, localTime, relativeDate, dayWindow, isValidDate, addDays } from "./time.ts";

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
