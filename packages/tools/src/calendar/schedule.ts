// The schedule views: the schedule half of `today`, `week`, and `slots`.
// Each lays the copy's events out beside the dated tasks the todo `today`
// view already reports, in the display zone, after refreshing any calendar
// whose copy is older than LIFE_CAL_MAX_AGE (unless told `fresh: false`).
// Nothing here writes on its own: the only writes are the sync entries the
// refresh makes. A refresh that fails is reported in `warnings` and in
// `freshness[].error`, and the view still answers from the copy; a view never
// hands back an empty answer in place of a failed one.
//
// `today` returns only the schedule fields (allDay, timed, freshness, warnings)
// so the caller can merge them into the todo `today` view.

import { isTimedWhen, type Account, type Calendar, type Task } from "../contract.ts";
import type { Clock } from "../core.ts";
import type { Store } from "../store.ts";
import type { TaskOps } from "../tasks.ts";
import {
  addDays,
  dayWindow,
  isValidTimezone,
  localDate,
  parseInstant,
  relativeDate,
  toInstant,
  todayIn,
  zonedToInstant,
} from "../time.ts";
import { expandEvents, type Occurrence } from "./expand.ts";
import { isStale, refreshIfStale, type Adapters } from "./sync.ts";

// ------------------------------------------------------------------ types

export type ScheduleEntry = { kind: "event"; occurrence: Occurrence } | { kind: "task"; task: Task };

export type FreshnessEntry = {
  calendarId: string;
  name: string;
  syncedAt: string | null;
  /** Whole seconds since `syncedAt` at the time of the answer; null when never synced. */
  ageSeconds: number | null;
  /** True when this answer refreshed the calendar first. */
  refreshed: boolean;
  /** Why the copy could not be refreshed (this time, or the last time a sync ran); null when it is sound. */
  error: string | null;
};
export type Freshness = FreshnessEntry[];

/** One day's schedule: all-day events first, then date-only tasks; timed entries by start, then title. */
export type Day = { date: string; allDay: ScheduleEntry[]; timed: ScheduleEntry[] };

/** The fields `today` adds to the todo view. */
export type TodaySchedule = { allDay: ScheduleEntry[]; timed: ScheduleEntry[]; freshness: Freshness; warnings: string[] };
export type WeekView = { from: string; to: string; timezone: string; days: Day[]; freshness: Freshness; warnings: string[] };
export type Slot = { start: string; end: string };
export type SlotsView = { slots: Slot[]; freshness: Freshness; warnings: string[] };

/** Working hours in the display zone; `days` are JavaScript weekdays, 0 Sunday to 6 Saturday. */
export type Hours = { start: string; end: string; days?: number[] };

export type TodayOptions = { date?: string; fresh?: boolean; includeHidden?: boolean };
export type WeekOptions = { from?: string; days?: number; fresh?: boolean; includeHidden?: boolean };
export type SlotsOptions = {
  /** Minutes. */
  duration: number;
  /** A date (YYYY-MM-DD or today, tomorrow, +Nd), or an instant; default today. */
  from?: string;
  /** A date, inclusive, or an instant; default six days after `from`. */
  to?: string;
  hours?: Hours;
  /** Calendar ids (or `<identity>/<name>`, or a unique name); hidden calendars count when named. Default: every non-hidden calendar. */
  calendars?: string[];
  fresh?: boolean;
};

export interface Schedule {
  today(opts?: TodayOptions): Promise<TodaySchedule>;
  week(opts?: WeekOptions): Promise<WeekView>;
  slots(opts: SlotsOptions): Promise<SlotsView>;
}

export type ScheduleDeps = {
  /** Selects the dated tasks, the same way the todo `today` view does. */
  tasks: TaskOps;
  /** The provider adapters, by provider; none means nothing can be refreshed and every stale calendar says so. */
  adapters?: Adapters;
  /** Overrides LIFE_CAL_MAX_AGE. */
  maxAgeSeconds?: number;
};

export const DEFAULT_MAX_AGE_SECONDS = 300;
export const DEFAULT_HOURS: Required<Hours> = { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] };
export const DEFAULT_SLOT_DAYS = 7;
/** The most days `week` will lay out. */
export const MAX_WEEK_DAYS = 366;

/** The statuses the todo `today` view lays out under overdue and due, and the schedule places: committed work, not proposals. */
export const SCHEDULED_STATUSES: Task["status"][] = ["accepted", "in_progress"];

// ------------------------------------------------------------------ helpers

/** LIFE_CAL_MAX_AGE as a non-negative integer of seconds, or the default. */
export function maxAgeFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LIFE_CAL_MAX_AGE;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_AGE_SECONDS;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_AGE_SECONDS;
}

/** The instant a dated task sits at: its due time in its own zone (the display zone when it names none); null for a date-only task. */
export function taskInstant(task: Task, timezone: string): string | null {
  if (!task.due || task.due.time === undefined) return null;
  const zone = task.due.timezone !== undefined && isValidTimezone(task.due.timezone) ? task.due.timezone : timezone;
  const at = zonedToInstant(`${task.due.date}T${task.due.time}`, zone);
  return at ? toInstant(at) : null;
}

/** An entry's start for ordering the timed list: the occurrence's instant, or the task's due instant. */
function entryStart(entry: ScheduleEntry, timezone: string): number {
  if (entry.kind === "event") return isTimedWhen(entry.occurrence.start) ? Date.parse(entry.occurrence.start.at) : Number.NaN;
  const at = taskInstant(entry.task, timezone);
  return at === null ? Number.NaN : Date.parse(at);
}

const entryTitle = (entry: ScheduleEntry): string => (entry.kind === "event" ? entry.occurrence.title : entry.task.title);
const entryId = (entry: ScheduleEntry): string => (entry.kind === "event" ? entry.occurrence.occurrenceId : entry.task.id);

/** By start, then title, then id, so the order is stable. */
function sortTimed(entries: ScheduleEntry[], timezone: string): ScheduleEntry[] {
  return entries.sort((a, b) => {
    const byStart = entryStart(a, timezone) - entryStart(b, timezone);
    if (byStart !== 0 && !Number.isNaN(byStart)) return byStart;
    return entryTitle(a).localeCompare(entryTitle(b)) || entryId(a).localeCompare(entryId(b));
  });
}

/** A date argument: YYYY-MM-DD or a relative word, resolved against `today`. Throws with the field named. */
function resolveDate(view: string, field: string, value: string | undefined, today: string): string {
  if (value === undefined) return today;
  const resolved = relativeDate(value, today);
  if (resolved === null) throw new Error(`${view}: ${field}: expected YYYY-MM-DD, today, tomorrow, yesterday, or +Nd, got "${value}"`);
  return resolved;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The weekday of a date, 0 Sunday to 6 Saturday. */
function weekdayOf(date: string): number {
  return new Date(date + "T00:00:00Z").getUTCDay();
}

/** An occurrence dropped from every view: one Neel declined. Cancelled ones stay, so the day shows what fell through. */
const isShown = (occurrence: Occurrence): boolean => occurrence.myResponse !== "declined";

/** The dates an occurrence covers, clipped to [from, to]: an all-day span by its dates, a timed one by the days it touches in the display zone. */
function daysCovered(occurrence: Occurrence, from: string, to: string, timezone: string): string[] {
  let first: string;
  let last: string;
  if (isTimedWhen(occurrence.start) && isTimedWhen(occurrence.end)) {
    first = localDate(occurrence.start.at, timezone);
    // The end is exclusive: an event ending at midnight does not touch the next day.
    last = localDate(new Date(Math.max(Date.parse(occurrence.end.at) - 1, Date.parse(occurrence.start.at))), timezone);
  } else if (!isTimedWhen(occurrence.start) && !isTimedWhen(occurrence.end)) {
    first = occurrence.start.date;
    last = addDays(occurrence.end.date, -1);
    if (last < first) last = first;
  } else {
    return [];
  }
  const out: string[] = [];
  for (let date = first < from ? from : first; date <= last && date <= to; date = addDays(date, 1)) out.push(date);
  return out;
}

// ------------------------------------------------------------------ busy time and free windows

type Interval = { start: number; end: number };

/** The busy intervals of the shown occurrences: timed ones as they are, all-day ones as whole display-zone days. */
function busyIntervals(occurrences: Occurrence[], timezone: string): Interval[] {
  const intervals: Interval[] = [];
  for (const occurrence of occurrences) {
    if (!occurrence.busy || occurrence.status === "cancelled") continue;
    if (isTimedWhen(occurrence.start) && isTimedWhen(occurrence.end)) {
      intervals.push({ start: Date.parse(occurrence.start.at), end: Date.parse(occurrence.end.at) });
    } else if (!isTimedWhen(occurrence.start) && !isTimedWhen(occurrence.end)) {
      intervals.push({ start: Date.parse(dayWindow(occurrence.start.date, timezone).start), end: Date.parse(dayWindow(occurrence.end.date, timezone).start) });
    }
  }
  return mergeIntervals(intervals);
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

/** The parts of `window` not covered by `busy` (which is merged and sorted). */
function subtract(window: Interval, busy: Interval[]): Interval[] {
  const free: Interval[] = [];
  let cursor = window.start;
  for (const interval of busy) {
    if (interval.end <= cursor) continue;
    if (interval.start >= window.end) break;
    if (interval.start > cursor) free.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
    if (cursor >= window.end) break;
  }
  if (cursor < window.end) free.push({ start: cursor, end: window.end });
  return free;
}

/**
 * The maximal free windows of at least `durationMs`, inside the working hours
 * of each day of [lower, upper) in the display zone, minus the busy time.
 * Pure, so it can be tested without a database.
 */
export function freeSlots(lower: number, upper: number, busy: Interval[], hours: Required<Hours>, durationMs: number, timezone: string): Slot[] {
  const slots: Slot[] = [];
  if (lower >= upper) return slots;
  const days = new Set(hours.days);
  const lastDate = localDate(new Date(upper - 1), timezone);
  for (let date = localDate(new Date(lower), timezone); date <= lastDate; date = addDays(date, 1)) {
    if (!days.has(weekdayOf(date))) continue;
    const open = zonedToInstant(`${date}T${hours.start}`, timezone);
    const close = zonedToInstant(`${date}T${hours.end}`, timezone);
    if (!open || !close) continue;
    const window: Interval = { start: Math.max(open.getTime(), lower), end: Math.min(close.getTime(), upper) };
    if (window.end - window.start < durationMs) continue;
    for (const free of subtract(window, busy)) {
      if (free.end - free.start < durationMs) continue;
      slots.push({ start: toInstant(new Date(free.start)), end: toInstant(new Date(free.end)) });
    }
  }
  return slots;
}

// ------------------------------------------------------------------ the factory

/** What a view reads before answering: the calendars in scope, in list order, with their accounts. */
type Scope = { calendars: Calendar[]; accountsById: Map<string, Account> };

export function createSchedule(store: Store, clock: Clock, deps: ScheduleDeps): Schedule {
  const adapters: Adapters = deps.adapters ?? {};
  const today = (): string => todayIn(clock.timezone, clock.now());
  const maxAge = (): number => deps.maxAgeSeconds ?? maxAgeFromEnv();

  /** Live calendars of live accounts, sorted by account then order; hidden ones only when asked for or named. */
  async function scope(opts: { includeHidden?: boolean; named?: string[] }, view: string): Promise<Scope> {
    const { accounts, calendars } = await store.read(async (tx) => ({ accounts: await tx.all("account"), calendars: await tx.all("calendar") }));
    const accountsById = new Map(accounts.map((account) => [account.id, account]));
    const rank = new Map(
      [...accounts].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map((account, index) => [account.id, index]),
    );
    const live = calendars
      .filter((calendar) => accountsById.has(calendar.accountId))
      .sort((a, b) => rank.get(a.accountId)! - rank.get(b.accountId)! || a.order - b.order || a.id.localeCompare(b.id));
    if (!opts.named) return { calendars: live.filter((calendar) => opts.includeHidden || !calendar.hidden), accountsById };
    const chosen = new Set<string>();
    for (const ref of opts.named) {
      const found = resolveCalendar(live, accountsById, ref);
      if (!found) throw new Error(`${view}: no calendar "${ref}"; pass an id, <identity>/<name>, or a unique name (see life calendar list --hidden)`);
      chosen.add(found.id);
    }
    return { calendars: live.filter((calendar) => chosen.has(calendar.id)), accountsById };
  }

  /**
   * Refresh the stale calendars in scope unless told not to, then read the
   * calendars again (their syncedAt moved) and build the freshness list and
   * the warnings. Failures are reported, never thrown.
   */
  async function refresh(scoped: Scope, fresh: boolean | undefined): Promise<{ calendars: Calendar[]; freshness: Freshness; warnings: string[] }> {
    const ids = scoped.calendars.map((calendar) => calendar.id);
    const refreshed = new Set<string>();
    const failed = new Map<string, string>();
    if (fresh !== false && ids.length > 0) {
      const result = await refreshIfStale(store, clock, adapters, { maxAgeSeconds: maxAge(), calendarIds: ids });
      for (const id of result.refreshed) refreshed.add(id);
      for (const failure of result.failed) failed.set(failure.calendarId, failure.error);
    }
    const current = new Map((await store.read((tx) => tx.all("calendar"))).map((calendar) => [calendar.id, calendar]));
    const calendars = scoped.calendars.map((calendar) => current.get(calendar.id) ?? calendar);
    const now = clock.now().getTime();
    const warnings: string[] = [];
    const freshness: Freshness = calendars.map((calendar) => {
      // A stale copy the refresh could not attempt is as unrefreshed as a failed one: its account cannot be reached.
      const account = scoped.accountsById.get(calendar.accountId);
      if (fresh !== false && account && account.status !== "connected" && !refreshed.has(calendar.id) && !failed.has(calendar.id) && isStale(calendar.syncedAt, clock.now(), maxAge())) {
        failed.set(calendar.id, `Account ${account.identity} ${account.status === "needs_reauth" ? "needs re-authorization (run life account add google)" : "is disconnected"}`);
      }
      const error = failed.get(calendar.id) ?? calendar.syncError;
      if (failed.has(calendar.id)) {
        warnings.push(
          `Calendar "${calendar.name}" (${calendar.id}) could not be refreshed: ${error}. Answering from the copy ${calendar.syncedAt ? `synced at ${calendar.syncedAt}` : "which was never synced"}.`,
        );
      }
      return {
        calendarId: calendar.id,
        name: calendar.name,
        syncedAt: calendar.syncedAt,
        ageSeconds: calendar.syncedAt === null ? null : Math.max(0, Math.floor((now - Date.parse(calendar.syncedAt)) / 1000)),
        refreshed: refreshed.has(calendar.id),
        error,
      };
    });
    return { calendars, freshness, warnings };
  }

  /** The shown occurrences of the calendars in [from, to) as instants; rule problems land in `warnings`. */
  async function occurrencesIn(calendars: Calendar[], fromInstant: string, toInstant: string, warnings: string[]): Promise<Occurrence[]> {
    if (calendars.length === 0) return [];
    const rows = await store.read((tx) => tx.eventsInRange(calendars.map((calendar) => calendar.id), fromInstant, toInstant));
    const occurrences = expandEvents(rows, {
      from: fromInstant,
      to: toInstant,
      timezone: clock.timezone,
      onIssue: (issue) => warnings.push(`Event ${issue.eventId}: ${issue.message}`),
    });
    return occurrences.filter(isShown);
  }

  /** The committed, dated tasks due in [from, to], as the todo `today` view selects them, in list order. */
  function tasksIn(from: string, to: string): Promise<Task[]> {
    return deps.tasks.list({ status: SCHEDULED_STATUSES, dueAfter: addDays(from, -1), dueBefore: addDays(to, 1) });
  }

  /** Lay events and tasks out per day over [from, to]. */
  async function layOut(calendars: Calendar[], from: string, to: string, warnings: string[]): Promise<Day[]> {
    const timezone = clock.timezone;
    const window = { from: dayWindow(from, timezone).start, to: dayWindow(to, timezone).end };
    const [occurrences, tasks] = await Promise.all([occurrencesIn(calendars, window.from, window.to, warnings), tasksIn(from, to)]);
    const days = new Map<string, Day>();
    for (let date = from; date <= to; date = addDays(date, 1)) days.set(date, { date, allDay: [], timed: [] });
    for (const occurrence of occurrences) {
      const entry: ScheduleEntry = { kind: "event", occurrence };
      for (const date of daysCovered(occurrence, from, to, timezone)) {
        const day = days.get(date)!;
        (isTimedWhen(occurrence.start) ? day.timed : day.allDay).push(entry);
      }
    }
    for (const task of tasks) {
      const day = task.due ? days.get(task.due.date) : undefined;
      if (!day) continue;
      const entry: ScheduleEntry = { kind: "task", task };
      (taskInstant(task, timezone) === null ? day.allDay : day.timed).push(entry);
    }
    const out = [...days.values()];
    for (const day of out) sortTimed(day.timed, timezone);
    return out;
  }

  return {
    async today(opts = {}) {
      const date = resolveDate("today", "date", opts.date, today());
      const scoped = await scope({ includeHidden: opts.includeHidden }, "today");
      const { calendars, freshness, warnings } = await refresh(scoped, opts.fresh);
      const [day] = await layOut(calendars, date, date, warnings);
      return { allDay: day!.allDay, timed: day!.timed, freshness, warnings };
    },

    async week(opts = {}) {
      const days = opts.days ?? 7;
      if (!Number.isInteger(days) || days < 1 || days > MAX_WEEK_DAYS) {
        throw new Error(`week: days: expected an integer from 1 to ${MAX_WEEK_DAYS}, got ${String(days)}`);
      }
      const from = resolveDate("week", "from", opts.from, today());
      const to = addDays(from, days - 1);
      const scoped = await scope({ includeHidden: opts.includeHidden }, "week");
      const { calendars, freshness, warnings } = await refresh(scoped, opts.fresh);
      const laid = await layOut(calendars, from, to, warnings);
      return { from, to, timezone: clock.timezone, days: laid, freshness, warnings };
    },

    async slots(opts) {
      const timezone = clock.timezone;
      if (!Number.isInteger(opts.duration) || opts.duration < 1) throw new Error(`slots: duration: expected a whole number of minutes, at least 1, got ${String(opts.duration)}`);
      const hours = resolveHours(opts.hours);
      const now = today();
      const lowerInstant = resolveBound("from", opts.from, now, now, timezone, "start");
      const fromDate = localDate(lowerInstant, timezone);
      const upperInstant = resolveBound("to", opts.to, now, addDays(fromDate, DEFAULT_SLOT_DAYS - 1), timezone, "end");
      if (Date.parse(upperInstant) <= Date.parse(lowerInstant)) throw new Error(`slots: to: must be after from (${lowerInstant})`);

      const scoped = await scope({ named: opts.calendars }, "slots");
      const { calendars, freshness, warnings } = await refresh(scoped, opts.fresh);
      const lower = Math.max(Date.parse(lowerInstant), clock.now().getTime());
      const upper = Date.parse(upperInstant);
      if (lower >= upper) return { slots: [], freshness, warnings };
      const occurrences = await occurrencesIn(calendars, toInstant(new Date(lower)), upperInstant, warnings);
      const slots = freeSlots(lower, upper, busyIntervals(occurrences, timezone), hours, opts.duration * 60000, timezone);
      return { slots, freshness, warnings };
    },
  };
}

// ------------------------------------------------------------------ input resolution

/** A calendar by id, `<identity>/<name>`, or a name unique among the live calendars (case-insensitively). */
function resolveCalendar(calendars: Calendar[], accountsById: Map<string, Account>, ref: string): Calendar | null {
  const value = ref.trim();
  if (!value) return null;
  const byId = calendars.find((calendar) => calendar.id === value);
  if (byId) return byId;
  const lower = value.toLowerCase();
  const slash = value.indexOf("/");
  if (slash > 0) {
    const identity = lower.slice(0, slash);
    const name = lower.slice(slash + 1);
    const found = calendars.filter((calendar) => accountsById.get(calendar.accountId)?.identity.toLowerCase() === identity && calendar.name.toLowerCase() === name);
    if (found.length === 1) return found[0]!;
  }
  const byName = calendars.filter((calendar) => calendar.name.toLowerCase() === lower);
  return byName.length === 1 ? byName[0]! : null;
}

/** Validated working hours with the defaults filled in. Throws with the field named. */
function resolveHours(hours: Hours | undefined): Required<Hours> {
  if (!hours) return DEFAULT_HOURS;
  if (!HHMM.test(hours.start)) throw new Error(`slots: hours.start: expected HH:MM, got "${hours.start}"`);
  if (!HHMM.test(hours.end)) throw new Error(`slots: hours.end: expected HH:MM, got "${hours.end}"`);
  if (hours.end <= hours.start) throw new Error(`slots: hours.end: must be after hours.start (${hours.start})`);
  const days = hours.days ?? DEFAULT_HOURS.days;
  if (days.length === 0 || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error(`slots: hours.days: expected weekdays 0 (Sunday) to 6 (Saturday), got ${JSON.stringify(days)}`);
  }
  return { start: hours.start, end: hours.end, days: [...new Set(days)] };
}

/**
 * A bound of the slots window as an instant: a date or relative word means
 * the start of that day for `from` and the end of it for `to`; a wall-clock
 * time is read in the display zone; an instant with a zone stands as it is.
 */
function resolveBound(field: "from" | "to", value: string | undefined, today: string, fallbackDate: string, timezone: string, edge: "start" | "end"): string {
  if (value === undefined) return dayWindow(fallbackDate, timezone)[edge];
  const raw = value.trim();
  const asDate = relativeDate(raw, today);
  if (asDate !== null) return dayWindow(asDate, timezone)[edge];
  const instant = parseInstant(raw.replace(" ", "T"), timezone);
  if (instant === null) throw new Error(`slots: ${field}: expected YYYY-MM-DD, today, tomorrow, +Nd, or "YYYY-MM-DD HH:MM", got "${raw}"`);
  return instant;
}
