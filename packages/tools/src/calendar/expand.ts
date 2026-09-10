// Occurrence expansion: lays one event's rule out over a window, drops its
// exdates, and lets its exception rows stand in for the slots they override.
// This is the only module that imports the rrule package (README, "The calendar").
//
// The rule runs in the event's own wall clock: dtstart and every generated
// slot are wall-clock parts carried in a UTC Date, and each slot is turned back
// into an instant with zonedToInstant, so a weekly 9 AM stays 9 AM across a
// DST change. A floating series (timezone null) has no zone of its own, so its
// wall clock is read, and the slots are resolved, in the display zone passed in.
// All-day series expand by date and overlap the window in the display zone.

import rrule from "rrule";
import { isTimedWhen, whenKey, type Event, type When } from "../contract.ts";
import {
  addDays,
  daysBetween,
  isInstant,
  isValidDate,
  localDate,
  toInstant,
  wallParts,
  zonedToInstant,
} from "../time.ts";

const { RRule } = rrule;

/**
 * One occurrence of an event: the row's fields (the master's for a slot laid
 * out from the rule, the exception row's where one stands in, the event's own
 * for a single event) with `start` and `end` set to this occurrence's times.
 * `originalStart` is the slot the rule produced, which is what addresses the
 * occurrence at the provider even after it was moved. `master` is true when the
 * fields are those of the series' own row (the master, or a single event) and
 * false when an exception row stands in for the slot.
 */
export type Occurrence = Omit<Event, "originalStart"> & {
  occurrenceId: string;
  originalStart: When;
  master: boolean;
};

export type ExpandOptions = {
  /** Window start, inclusive, as an instant. */
  from: string;
  /** Window end, exclusive, as an instant. */
  to: string;
  /** The display zone: resolves all-day dates and floating wall clocks. */
  timezone: string;
  /** Called for a rule the rrule package cannot run; the master then shows as a single occurrence. */
  onIssue?: (issue: { eventId: string; message: string }) => void;
};

/** `<eventId>@<originalStart>` where originalStart is the `at` instant or the date. */
export function occurrenceRef(eventId: string, originalStart: When | string): string {
  const key = typeof originalStart === "string" ? originalStart : whenKey(originalStart);
  return `${eventId}@${key}`;
}

/** Splits an occurrence ref; null for anything that is not `<id>@<instant|date>`. */
export function parseOccurrenceRef(ref: string): { eventId: string; originalStart: string } | null {
  const at = ref.indexOf("@");
  if (at <= 0) return null;
  const eventId = ref.slice(0, at);
  const originalStart = ref.slice(at + 1);
  if (!eventId || !(isInstant(originalStart) || isValidDate(originalStart))) return null;
  return { eventId, originalStart };
}

export function isOccurrenceRef(ref: string): boolean {
  return parseOccurrenceRef(ref) !== null;
}

/**
 * Expands a flat set of rows (what `Tx.eventsInRange` returns): exception rows
 * are attached to their master, masters and single events are expanded, and
 * an exception row whose master is not in the set still shows on its own so a
 * moved occurrence never disappears because of how the set was cut.
 */
export function expandEvents(rows: Event[], opts: ExpandOptions): Occurrence[] {
  const ids = new Set(rows.map((row) => row.id));
  const exceptionsByMaster = new Map<string, Event[]>();
  for (const row of rows) {
    if (row.masterId === null) continue;
    const list = exceptionsByMaster.get(row.masterId) ?? [];
    list.push(row);
    exceptionsByMaster.set(row.masterId, list);
  }
  const out: Occurrence[] = [];
  for (const row of rows) {
    if (row.masterId === null) {
      out.push(...expandEvent(row, exceptionsByMaster.get(row.id) ?? [], opts));
    } else if (!ids.has(row.masterId)) {
      out.push(...expandEvent(row, [], opts));
    }
  }
  return sortOccurrences(out, opts.timezone);
}

/**
 * The occurrences of one event inside [from, to). `exceptions` are the rows
 * whose `masterId` is this event; rows with another master are ignored.
 * A single event, or an exception row expanded on its own, yields at most one.
 */
export function expandEvent(event: Event, exceptions: Event[], opts: ExpandOptions): Occurrence[] {
  if (!event.repeat || event.masterId !== null) return sortOccurrences(single(event, opts), opts.timezone);
  const own = exceptions.filter((row) => row.masterId === event.id);
  const generated = slotsFor(event, opts);
  const out: Occurrence[] = [];

  // Slots the rule produced, minus exdates and the ones an exception row stands in for.
  const exdates = new Set((event.repeat?.exdates ?? []).map(normalizeKey));
  const overridden = new Set(own.map((row) => normalizeKey(whenKey(row.originalStart!))));
  for (const slot of generated) {
    const key = normalizeKey(whenKey(slot.start));
    if (exdates.has(key) || overridden.has(key)) continue;
    if (!overlaps(slot.start, slot.end, opts)) continue;
    out.push({
      ...event,
      occurrenceId: occurrenceRef(event.id, slot.start),
      start: slot.start,
      end: slot.end,
      originalStart: slot.start,
      master: true,
    });
  }

  // Exception rows show at their own time, wherever the slot they replace was;
  // a cancelled one drops its occurrence.
  for (const row of own) {
    if (row.status === "cancelled") continue;
    if (!overlaps(row.start, row.end, opts)) continue;
    out.push({
      ...row,
      occurrenceId: occurrenceRef(event.id, row.originalStart!),
      originalStart: row.originalStart!,
      master: false,
    });
  }
  return sortOccurrences(out, opts.timezone);
}

/**
 * A row without a rule as its own occurrence: a single event, or an exception
 * row shown without its master (it keeps the slot it stands in for as its
 * originalStart and its series id in the ref).
 */
function single(event: Event, opts: ExpandOptions): Occurrence[] {
  if (!overlaps(event.start, event.end, opts)) return [];
  const originalStart = event.originalStart ?? event.start;
  return [
    {
      ...event,
      occurrenceId: occurrenceRef(event.masterId ?? event.id, originalStart),
      originalStart,
      master: event.masterId === null,
    },
  ];
}

// ------------------------------------------------------------------ slots

type Slot = { start: When; end: When };

/** The master's own start as the one slot, when its rule cannot be run. */
function selfSlot(event: Event): Slot {
  return { start: event.start, end: event.end };
}

function slotsFor(event: Event, opts: ExpandOptions): Slot[] {
  const rule = event.repeat!.rrule;
  const allDay = !isTimedWhen(event.start);
  const zone = isTimedWhen(event.start) ? (event.start.timezone ?? opts.timezone) : opts.timezone;
  const report = (message: string) => opts.onIssue?.({ eventId: event.id, message });
  const parsed = parseRule(rule, zone, allDay);
  if (!parsed.ok) {
    report(`Cannot expand rule "${rule}": ${parsed.error}`);
    return [selfSlot(event)];
  }
  return allDay
    ? allDaySlots(event, parsed.options, opts, report)
    : timedSlots(event, parsed.options, zone, opts, report);
}

function timedSlots(
  event: Event,
  options: Partial<rrule.Options>,
  zone: string,
  opts: ExpandOptions,
  report: (message: string) => void,
): Slot[] {
  const start = event.start as { at: string; timezone: string | null };
  const end = event.end as { at: string; timezone: string | null };
  const durationMs = Date.parse(end.at) - Date.parse(start.at);
  const dtstart = wallDate(new Date(start.at), zone);
  // A day of slack on each side covers offset changes; the overlap check trims it.
  const after = new Date(wallDate(new Date(opts.from), zone).getTime() - durationMs - DAY_MS);
  const before = new Date(wallDate(new Date(opts.to), zone).getTime() + DAY_MS);
  const walls = run(options, dtstart, after, before, report);
  if (walls === null) return [selfSlot(event)];
  const slots: Slot[] = [];
  for (const wall of walls) {
    const instant = zonedToInstant(wallString(wall), zone);
    if (!instant) continue; // a wall clock that does not exist in this zone (a spring-forward gap on an odd rule)
    slots.push({
      start: { at: toInstant(instant), timezone: start.timezone },
      end: { at: toInstant(new Date(instant.getTime() + durationMs)), timezone: end.timezone },
    });
  }
  return slots;
}

function allDaySlots(
  event: Event,
  options: Partial<rrule.Options>,
  opts: ExpandOptions,
  report: (message: string) => void,
): Slot[] {
  const start = event.start as { date: string };
  const end = event.end as { date: string };
  const days = daysBetween(start.date, end.date);
  const dtstart = new Date(start.date + "T00:00:00Z");
  const after = new Date(addDays(localDate(opts.from, opts.timezone), -days - 1) + "T00:00:00Z");
  const before = new Date(addDays(localDate(opts.to, opts.timezone), 1) + "T00:00:00Z");
  const walls = run(options, dtstart, after, before, report);
  if (walls === null) return [selfSlot(event)];
  return walls.map((wall) => {
    const date = wall.toISOString().slice(0, 10);
    return { start: { date }, end: { date: addDays(date, days) } };
  });
}

/** Runs the rule in wall-clock space; the dtstart itself always counts as an instance, as the providers treat it. */
function run(
  options: Partial<rrule.Options>,
  dtstart: Date,
  after: Date,
  before: Date,
  report: (message: string) => void,
): Date[] | null {
  let dates: Date[];
  try {
    const rule = new RRule({ ...options, dtstart, tzid: null });
    dates = rule.between(after, before, true);
  } catch (error) {
    report(`Cannot expand rule: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const first = dtstart.getTime();
  if (first >= after.getTime() && first <= before.getTime() && !dates.some((d) => d.getTime() === first)) {
    dates.unshift(dtstart);
  }
  return dates;
}

// ------------------------------------------------------------------ rule parsing

const UNTIL = /(?:^|;)UNTIL=(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?(?=;|$)/i;

/**
 * Parses the RRULE text into rrule options, dropping any DTSTART or other
 * lines a provider may have folded in, and rewriting UNTIL into wall-clock
 * space: a UTC UNTIL becomes the wall clock it names in the event's zone, and
 * a date-only UNTIL runs to the end of that day.
 */
function parseRule(
  text: string,
  zone: string,
  allDay: boolean,
): { ok: true; options: Partial<rrule.Options> } | { ok: false; error: string } {
  const line =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /^RRULE:/i.test(l) || (!/^(DTSTART|EXDATE|RDATE|EXRULE)/i.test(l) && l.length > 0)) ?? "";
  const body = line.replace(/^RRULE:/i, "");
  if (!body) return { ok: false, error: "no RRULE line" };
  let options: Partial<rrule.Options>;
  try {
    options = RRule.parseString(body);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (options.freq === undefined || !(options.freq in FREQ_NAMES)) return { ok: false, error: "unsupported FREQ" };
  if (options.freq > RRule.DAILY) return { ok: false, error: `${FREQ_NAMES[options.freq] ?? "sub-daily"} rules are not supported` };
  const until = UNTIL.exec(body);
  if (until) {
    const [, y, m, d, hh, mm, ss, z] = until;
    const year = Number(y);
    const month = Number(m) - 1;
    const day = Number(d);
    if (hh === undefined) {
      options.until = new Date(Date.UTC(year, month, day, allDay ? 0 : 23, allDay ? 0 : 59, allDay ? 0 : 59));
    } else if (z && !allDay) {
      options.until = wallDate(new Date(Date.UTC(year, month, day, Number(hh), Number(mm), Number(ss))), zone);
    } else {
      options.until = new Date(Date.UTC(year, month, day, Number(hh), Number(mm), Number(ss)));
    }
  }
  return { ok: true, options };
}

const FREQ_NAMES: Record<number, string> = {
  [RRule.YEARLY]: "YEARLY",
  [RRule.MONTHLY]: "MONTHLY",
  [RRule.WEEKLY]: "WEEKLY",
  [RRule.DAILY]: "DAILY",
  [RRule.HOURLY]: "HOURLY",
  [RRule.MINUTELY]: "MINUTELY",
  [RRule.SECONDLY]: "SECONDLY",
};

// ------------------------------------------------------------------ helpers

const DAY_MS = 86400000;
const pad = (n: number) => String(n).padStart(2, "0");

/** The wall clock of an instant in `zone`, carried as a UTC Date for the rule to iterate. */
function wallDate(instant: Date, zone: string): Date {
  const p = wallParts(instant, zone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
}

function wallString(wall: Date): string {
  return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}`;
}

/** An originalStart key in one spelling: dates as they are, instants without fractional seconds. */
function normalizeKey(key: string): string {
  if (isValidDate(key)) return key;
  const parsed = Date.parse(key);
  return Number.isNaN(parsed) ? key : toInstant(new Date(parsed));
}

/** The instant an occurrence sorts and overlaps by: its `at`, or its date's midnight in the display zone. */
function instantOf(when: When, zone: string): number {
  if (isTimedWhen(when)) return Date.parse(when.at);
  return zonedToInstant(`${when.date}T00:00`, zone)?.getTime() ?? Date.parse(when.date + "T00:00:00Z");
}

function overlaps(start: When, end: When, opts: ExpandOptions): boolean {
  return instantOf(start, opts.timezone) < Date.parse(opts.to) && instantOf(end, opts.timezone) > Date.parse(opts.from);
}

function sortOccurrences(list: Occurrence[], zone: string): Occurrence[] {
  return list.sort((a, b) => {
    const byStart = instantOf(a.start, zone) - instantOf(b.start, zone);
    if (byStart !== 0) return byStart;
    return a.occurrenceId < b.occurrenceId ? -1 : a.occurrenceId > b.occurrenceId ? 1 : 0;
  });
}
