import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRule, formatRule, nextOccurrence, occurrencesBetween } from "./recurrence.ts";

const rule = (s: string) => {
  const parsed = parseRule(s);
  assert.ok(parsed.ok, s);
  return parsed.ok ? parsed.rule : null!;
};

test("parses the subset and rejects the rest", () => {
  assert.deepEqual(rule("FREQ=DAILY"), { freq: "DAILY", interval: 1 });
  assert.deepEqual(rule("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"), { freq: "WEEKLY", interval: 2, byDay: [0, 2] });
  assert.equal(formatRule(rule("freq=weekly;byday=fr")), "FREQ=WEEKLY;BYDAY=FR");
  for (const bad of ["", "FREQ=HOURLY", "FREQ=MONTHLY;BYDAY=MO", "FREQ=DAILY;COUNT=3", "FREQ=DAILY;INTERVAL=0", "BYDAY=MO"])
    assert.equal(parseRule(bad).ok, false, bad);
});

test("next occurrence follows the grid anchored at the first date", () => {
  assert.equal(nextOccurrence(rule("FREQ=DAILY"), "2026-09-01", "2026-09-06"), "2026-09-07");
  assert.equal(nextOccurrence(rule("FREQ=DAILY;INTERVAL=3"), "2026-09-01", "2026-09-06"), "2026-09-07");
  assert.equal(nextOccurrence(rule("FREQ=WEEKLY"), "2026-09-01", "2026-09-01"), "2026-09-08");
  assert.equal(nextOccurrence(rule("FREQ=WEEKLY;BYDAY=MO,FR"), "2026-09-01", "2026-09-01"), "2026-09-04");
  assert.equal(nextOccurrence(rule("FREQ=WEEKLY;BYDAY=MO,FR"), "2026-09-01", "2026-09-04"), "2026-09-07");
  assert.equal(nextOccurrence(rule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"), "2026-09-07", "2026-09-07"), "2026-09-21");
  assert.equal(nextOccurrence(rule("FREQ=MONTHLY"), "2026-01-31", "2026-01-31"), "2026-03-31", "skips February");
  assert.equal(nextOccurrence(rule("FREQ=YEARLY"), "2024-02-29", "2024-02-29"), "2028-02-29");
  assert.equal(nextOccurrence(rule("FREQ=DAILY"), "2026-09-10", "2026-09-01"), "2026-09-10", "before the anchor returns the anchor");
});

test("occurrences in a window are bounded", () => {
  assert.deepEqual(occurrencesBetween(rule("FREQ=WEEKLY;BYDAY=MO,WE"), "2026-09-01", "2026-09-06", "2026-09-16"), ["2026-09-07", "2026-09-09", "2026-09-14", "2026-09-16"]);
  assert.equal(occurrencesBetween(rule("FREQ=DAILY"), "2020-01-01", "2020-01-01", "2030-01-01", 10).length, 10);
});
