// The cross-project views: today, upcoming, label, filter, search, trash,
// and the calendar's week and slots. Views are operations in the contract, so
// the CLI, the app, and Codex all see the same answer. Nothing here writes
// (the schedule's refresh makes sync entries, nothing else); `today` and
// `upcoming` read one snapshot each and partition it, `label` and `search`
// are `task.list` with one criterion, `filter` is `filter.run`, and `trash`
// is every deleted record. `today` merges the schedule half from
// src/calendar/schedule.ts into the todo view; `week` and `slots` are that
// module's. Bad input throws (an invalid date, an unknown label, an empty
// search): a view never returns an empty result for a failed read.

import type { Account, Calendar, Event, Filter, Label, Project, Section, Task } from "./contract.ts";
import type { Clock } from "./core.ts";
import type { Schedule, SlotsOptions, SlotsView, TodayOptions, TodaySchedule, WeekOptions, WeekView } from "./calendar/schedule.ts";
import { sortTasks, type Organize } from "./organize.ts";
import type { Store } from "./store.ts";
import type { TaskOps } from "./tasks.ts";
import { addDays, daysBetween, relativeDate, todayIn } from "./time.ts";

// ------------------------------------------------------------------ types

export type TodayView = {
  date: string;
  timezone: string;
  /** Accepted or in-progress tasks due before `date`. */
  overdue: Task[];
  /** Accepted or in-progress tasks due on `date`. */
  due: Task[];
  /** Accepted or in-progress tasks whose deadline is `date` or past, regardless of due; by deadline. */
  deadlines: Task[];
  /** Every proposed task: the review queue. */
  proposed: Task[];
} & TodaySchedule;

export type UpcomingDay = { date: string; tasks: Task[] };
export type UpcomingView = { from: string; to: string; days: UpcomingDay[] };

export type TrashView = { tasks: Task[]; projects: Project[]; sections: Section[]; labels: Label[]; filters: Filter[]; events: Event[]; calendars: Calendar[]; accounts: Account[] };

export interface Views {
  /**
   * `date` defaults to today in the clock's timezone; accepts YYYY-MM-DD, today,
   * tomorrow, yesterday, +Nd, -Nw. The todo lists plus the day's schedule
   * (`allDay`, `timed`, `freshness`, `warnings`); `fresh: false` skips the
   * calendar refresh, `includeHidden` shows hidden calendars. With no accounts
   * the schedule holds only the dated tasks and the todo lists are unchanged.
   */
  today(opts?: TodayOptions): Promise<TodayView>;
  /** Events and dated tasks day by day from `from` (default today) for `days` (default 7). */
  week(opts?: WeekOptions): Promise<WeekView>;
  /** Free windows of at least `duration` minutes between `from` and `to`, inside the working hours. */
  slots(opts: SlotsOptions): Promise<SlotsView>;
  /**
   * One entry per day from `from` (default today) for `days` days, empty days
   * included; undated excluded; overdue under the first day. Accepted and
   * in-progress tasks only, like `today`: a proposed task appears in today's
   * `proposed` list and nowhere in upcoming until it is accepted.
   */
  upcoming(days?: number, opts?: { from?: string }): Promise<UpcomingView>;
  /** Open tasks carrying the label (name or id) directly or through their project, sorted like `list`. Throws for an unknown label. */
  label(ref: string): Promise<Task[]>;
  /** A saved filter (id or name) or an ad hoc query. Throws when neither resolves nor parses. */
  filter(refOrQuery: string): Promise<Task[]>;
  /** Non-deleted tasks of any status whose title, notes, or a comment contains `text`, case-insensitively. */
  search(text: string): Promise<Task[]>;
  /** Deleted records only, newest deletion first. */
  trash(): Promise<TrashView>;
}

/** The most days `upcoming` will lay out. */
export const MAX_UPCOMING_DAYS = 366;

// ------------------------------------------------------------------ helpers

/** The statuses `today` reports under overdue, due, and deadlines, and `upcoming` lays out: committed work, not proposals. */
const isCommitted = (task: Task): boolean => task.status === "accepted" || task.status === "in_progress";

/** A date argument: YYYY-MM-DD or a relative word, resolved against `today`. Throws with the field named. */
function resolveDate(view: string, field: string, value: string | undefined, today: string): string {
  if (value === undefined) return today;
  const resolved = relativeDate(value, today);
  if (resolved === null) throw new Error(`${view}: ${field}: expected YYYY-MM-DD, today, tomorrow, yesterday, or +Nd, got "${value}"`);
  return resolved;
}

/** Newest deletion first; ties by id so the order is stable. */
function byDeletion<T extends { id: string; deletedAt: string | null; updatedAt: string }>(records: T[]): T[] {
  return records
    .filter((record) => record.deletedAt !== null)
    .sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

// ------------------------------------------------------------------ the factory

export function createViews(store: Store, clock: Clock, tasks: TaskOps, organize: Organize, schedule: Schedule): Views {
  const today = (): string => todayIn(clock.timezone, clock.now());

  return {
    async today(opts = {}) {
      const date = resolveDate("today", "date", opts.date, today());
      // The refresh (a write) runs first, so the todo snapshot and the schedule read the same copy.
      const scheduled = await schedule.today({ date, fresh: opts.fresh, includeHidden: opts.includeHidden });
      const lists = await store.read(async (tx) => {
        const live = await tx.all("task");
        const committed = live.filter(isCommitted);
        const deadlines = sortTasks(committed.filter((t) => t.deadline !== null && t.deadline <= date));
        return {
          overdue: sortTasks(committed.filter((t) => t.due !== null && t.due.date < date)),
          due: sortTasks(committed.filter((t) => t.due !== null && t.due.date === date)),
          // Stable sort: by deadline, then the list order for the same deadline.
          deadlines: deadlines.sort((a, b) => a.deadline!.localeCompare(b.deadline!)),
          proposed: sortTasks(live.filter((t) => t.status === "proposed")),
        };
      });
      return { date, timezone: clock.timezone, ...lists, ...scheduled };
    },

    week: (opts) => schedule.week(opts),

    slots: (opts) => schedule.slots(opts),

    async upcoming(days = 7, opts = {}) {
      if (!Number.isInteger(days) || days < 1 || days > MAX_UPCOMING_DAYS) {
        throw new Error(`upcoming: days: expected an integer from 1 to ${MAX_UPCOMING_DAYS}, got ${String(days)}`);
      }
      const from = resolveDate("upcoming", "from", opts.from, today());
      const to = addDays(from, days - 1);
      return store.read(async (tx) => {
        const dated = (await tx.all("task")).filter((t) => isCommitted(t) && t.due !== null);
        const byDay: UpcomingDay[] = Array.from({ length: days }, (_, i) => ({ date: addDays(from, i), tasks: [] }));
        for (const task of dated) {
          const dueDate = task.due!.date;
          if (dueDate > to) continue;
          // Overdue tasks land under the first day; the rest under their own.
          const slot = dueDate < from ? byDay[0]! : byDay[daysBetween(from, dueDate)]!;
          slot.tasks.push(task);
        }
        for (const day of byDay) day.tasks = sortTasks(day.tasks);
        return { from, to, days: byDay };
      });
    },

    async label(ref) {
      const value = ref.trim();
      if (!value) throw new Error("label: a label name or id is required");
      const label = await organize.label.get(value);
      if (!label) throw new Error(`label: no label "${value}"`);
      if (label.deletedAt) throw new Error(`label: label "${value}" is deleted; restore it first`);
      return tasks.list({ label: label.name });
    },

    filter: (refOrQuery) => organize.filter.run(refOrQuery),

    async search(text) {
      const needle = text.trim();
      if (!needle) throw new Error("search: text is required");
      return tasks.list({ text: needle, includeClosed: true });
    },

    trash: () =>
      store.read(async (tx) => ({
        tasks: byDeletion(await tx.all("task", { includeDeleted: true })),
        projects: byDeletion(await tx.all("project", { includeDeleted: true })),
        sections: byDeletion(await tx.all("section", { includeDeleted: true })),
        labels: byDeletion(await tx.all("label", { includeDeleted: true })),
        filters: byDeletion(await tx.all("filter", { includeDeleted: true })),
        events: byDeletion(await tx.all("event", { includeDeleted: true })),
        calendars: byDeletion(await tx.all("calendar", { includeDeleted: true })),
        accounts: byDeletion(await tx.all("account", { includeDeleted: true })),
      })),
  };
}
