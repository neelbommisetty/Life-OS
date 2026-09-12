// Dates with precision (LEISURE D92): when something happened, as precisely
// as Neel said. One text form per precision, parsed and printed here and
// nowhere else: `2026-09-07` (day), `2026-09-07~w` (the ISO week containing
// that day), `2026-09` (month), `2026` (year), `?` (unknown).
//
// Storage: `On.date` is the date at the precision's own grain: YYYY-MM-DD for
// a day, YYYY-MM for a month, YYYY for a year, null for unknown. A week is
// stored as the Monday of its ISO week with precision "week", so two mentions
// of the same week compare equal whichever day was typed, and prints as
// `<monday>~w`. Ordering (D91): unknown first; then by the first day the On
// covers; coarser precision before finer when those first days coincide.

import type { On, Precision } from "../contract.ts";
import { addDays, isValidDate } from "../time.ts";

export const ON_FORMS = "YYYY-MM-DD, YYYY-MM-DD~w (the ISO week containing that day), YYYY-MM, YYYY, or ? (unknown)";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK = /^(\d{4}-\d{2}-\d{2})~w$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const YEAR = /^\d{4}$/;

/** Coarser before finer: the rank an On sorts by when two cover the same first day. */
const PRECISION_RANK: Record<Precision, number> = { unknown: 0, year: 1, month: 2, week: 3, day: 4 };

/** Monday-based weekday index of a date: 0 for Monday, 6 for Sunday. */
function weekday(date: string): number {
  return (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
}

/** The Monday of the ISO week containing `date`. */
export function isoWeekStart(date: string): string {
  return addDays(date, -weekday(date));
}

/** The Sunday of the ISO week containing `date` (inclusive). */
export function isoWeekEnd(date: string): string {
  return addDays(isoWeekStart(date), 6);
}

function isValidMonth(value: string): boolean {
  const match = MONTH.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/**
 * Why a stored On is malformed, or null when it is sound: the date must be
 * spelled at its precision's grain, a week's date must be a Monday, and only
 * `unknown` has no date.
 */
export function onIssue(on: On): string | null {
  const { date, precision } = on;
  if (precision === "unknown") return date === null ? null : "An unknown date carries no date";
  if (date === null) return `A ${precision} needs a date`;
  switch (precision) {
    case "day":
      return isValidDate(date) ? null : "Use YYYY-MM-DD for a day";
    case "week":
      if (!isValidDate(date)) return "Use YYYY-MM-DD (a Monday) for a week";
      return weekday(date) === 0 ? null : "A week's date is the Monday of its ISO week";
    case "month":
      return isValidMonth(date) ? null : "Use YYYY-MM for a month";
    case "year":
      return YEAR.test(date) ? null : "Use YYYY for a year";
  }
}

export type ParsedOn = { ok: true; on: On } | { ok: false; error: string };

const reject = (problem: string): ParsedOn => ({ ok: false, error: `${problem}; use ${ON_FORMS}` });

/**
 * Parse one of the five forms. Rejections name what was wrong and the
 * accepted forms, so an agent can correct the value without guessing.
 */
export function parseOn(input: string): ParsedOn {
  const value = input.trim();
  if (value === "") return reject("Empty date");
  if (value === "?") return { ok: true, on: { date: null, precision: "unknown" } };
  const week = WEEK.exec(value);
  if (week) {
    const day = week[1]!;
    if (!isValidDate(day)) return reject(`"${day}" is not a real date`);
    return { ok: true, on: { date: isoWeekStart(day), precision: "week" } };
  }
  if (DAY.test(value)) {
    if (!isValidDate(value)) return reject(`"${value}" is not a real date`);
    return { ok: true, on: { date: value, precision: "day" } };
  }
  if (MONTH.test(value)) {
    if (!isValidMonth(value)) return reject(`"${value}" is not a real month`);
    return { ok: true, on: { date: value, precision: "month" } };
  }
  if (YEAR.test(value)) return { ok: true, on: { date: value, precision: "year" } };
  if (value.includes("~")) return reject(`"${value}" is not a date form: the only marker is ~w after a full date`);
  return reject(`"${value}" is not a date form`);
}

/** The text form of an On: the inverse of parseOn. */
export function formatOn(on: On): string {
  switch (on.precision) {
    case "unknown":
      return "?";
    case "week":
      return `${on.date}~w`;
    default:
      return on.date ?? "?";
  }
}

/** The first and last day (inclusive) an On covers; null for unknown. */
export function onRange(on: On): { start: string; end: string } | null {
  if (on.date === null || on.precision === "unknown") return null;
  switch (on.precision) {
    case "day":
      return { start: on.date, end: on.date };
    case "week":
      return { start: on.date, end: addDays(on.date, 6) };
    case "month": {
      const start = `${on.date}-01`;
      return { start, end: addDays(addMonth(start), -1) };
    }
    case "year":
      return { start: `${on.date}-01-01`, end: `${on.date}-12-31` };
  }
}

/** The first day of the month after the one `firstOfMonth` names. */
function addMonth(firstOfMonth: string): string {
  const parsed = new Date(firstOfMonth + "T00:00:00Z");
  parsed.setUTCMonth(parsed.getUTCMonth() + 1);
  return parsed.toISOString().slice(0, 10);
}

/**
 * The sortable key of an On: the first day it covers, then its precision
 * rank, so that unknown sorts first, dates sort by when they begin, and a
 * coarser On precedes a finer one beginning the same day. Comparable as text.
 */
export function onKey(on: On): string {
  const start = onRange(on)?.start ?? "0000-00-00";
  return `${start}|${PRECISION_RANK[on.precision]}`;
}

/** Order two Ons as `onKey` does. */
export function compareOn(a: On, b: On): number {
  const ka = onKey(a);
  const kb = onKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/** The calendar year an On falls in, at any precision but unknown. */
export function yearOf(on: On): number | null {
  if (on.date === null || on.precision === "unknown") return null;
  return Number(on.date.slice(0, 4));
}
