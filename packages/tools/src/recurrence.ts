// A bounded RRULE subset (RFC 5545): FREQ=DAILY|WEEKLY|MONTHLY|YEARLY,
// INTERVAL=n, and BYDAY=MO,TU,... for WEEKLY only. Everything else is rejected.
// Occurrences are calendar dates; time of day belongs to the record.

import { addDays, daysBetween, isValidDate } from "./time.ts";

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type Rule = { freq: Frequency; interval: number; byDay?: number[] };

const DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]; // 0 = Monday

export function parseRule(
  value: string,
): { ok: true; rule: Rule } | { ok: false; error: string } {
  const parts = value
    .trim()
    .toUpperCase()
    .replace(/^RRULE:/, "")
    .split(";")
    .filter(Boolean);
  if (!parts.length) return { ok: false, error: "Empty recurrence rule" };
  let freq: Frequency | undefined;
  let interval = 1;
  let byDay: number[] | undefined;
  for (const part of parts) {
    const [key, raw] = part.split("=") as [string, string | undefined];
    if (raw === undefined) return { ok: false, error: `Malformed rule part: ${part}` };
    switch (key) {
      case "FREQ":
        if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(raw))
          return { ok: false, error: `Unsupported FREQ ${raw}` };
        freq = raw as Frequency;
        break;
      case "INTERVAL":
        if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 366)
          return { ok: false, error: `INTERVAL must be 1–366, got ${raw}` };
        interval = Number(raw);
        break;
      case "BYDAY": {
        const days = raw.split(",").map((code) => DAY_CODES.indexOf(code));
        if (days.some((d) => d < 0) || !days.length)
          return { ok: false, error: `BYDAY accepts MO,TU,WE,TH,FR,SA,SU; got ${raw}` };
        byDay = [...new Set(days)].sort((a, b) => a - b);
        break;
      }
      default:
        return { ok: false, error: `Unsupported rule part ${key}` };
    }
  }
  if (!freq) return { ok: false, error: "Rule needs FREQ" };
  if (byDay && freq !== "WEEKLY")
    return { ok: false, error: "BYDAY is only supported with FREQ=WEEKLY" };
  return { ok: true, rule: byDay ? { freq, interval, byDay } : { freq, interval } };
}

export function formatRule(rule: Rule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay) parts.push(`BYDAY=${rule.byDay.map((d) => DAY_CODES[d]).join(",")}`);
  return parts.join(";");
}

/** Monday-based weekday index for a date. */
function weekday(date: string): number {
  return (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
}

function sameDayOfMonth(anchor: string, monthsAhead: number): string | null {
  const [y, m, d] = anchor.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + monthsAhead, 1));
  const daysInMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  if (d > daysInMonth) return null; // RFC 5545: skip months without that day
  target.setUTCDate(d);
  return target.toISOString().slice(0, 10);
}

/**
 * The first occurrence strictly after `after`, on the rule's grid anchored at `anchor`.
 * Returns null only if the search bound is exhausted (a defensive limit, not a rule feature).
 */
export function nextOccurrence(rule: Rule, anchor: string, after: string): string | null {
  if (!isValidDate(anchor) || !isValidDate(after)) return null;
  const limit = 5000;
  switch (rule.freq) {
    case "DAILY": {
      const step = rule.interval;
      const elapsed = Math.max(0, daysBetween(anchor, after));
      let k = Math.floor(elapsed / step);
      for (let i = 0; i < limit; i++, k++) {
        const candidate = addDays(anchor, k * step);
        if (candidate > after) return candidate;
      }
      return null;
    }
    case "WEEKLY": {
      const days = rule.byDay ?? [weekday(anchor)];
      const weekStart = addDays(anchor, -weekday(anchor));
      const stepDays = rule.interval * 7;
      const elapsed = Math.max(0, daysBetween(weekStart, after));
      let k = Math.floor(elapsed / stepDays);
      for (let i = 0; i < limit; i++, k++) {
        const base = addDays(weekStart, k * stepDays);
        for (const day of days) {
          const candidate = addDays(base, day);
          if (candidate > after && candidate >= anchor) return candidate;
        }
      }
      return null;
    }
    case "MONTHLY": {
      for (let k = 0; k < limit; k++) {
        const candidate = sameDayOfMonth(anchor, k * rule.interval);
        if (candidate && candidate > after) return candidate;
        if (candidate === null) continue;
      }
      return null;
    }
    case "YEARLY": {
      for (let k = 0; k < limit; k++) {
        const candidate = sameDayOfMonth(anchor, k * 12 * rule.interval);
        if (candidate && candidate > after) return candidate;
      }
      return null;
    }
  }
}

/** Occurrence dates in [from, to], anchored at `anchor`, bounded by `limit`. */
export function occurrencesBetween(
  rule: Rule,
  anchor: string,
  from: string,
  to: string,
  limit = 500,
): string[] {
  const dates: string[] = [];
  let cursor = addDays(from < anchor ? anchor : from, -1);
  while (dates.length < limit) {
    const next = nextOccurrence(rule, anchor, cursor);
    if (!next || next > to) break;
    dates.push(next);
    cursor = next;
  }
  return dates;
}
