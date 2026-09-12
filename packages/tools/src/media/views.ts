// The library's views (LEISURE "Views"): what he is on (`now`), what he has
// only noticed (`curious`), what he could start tonight (`backlog`), what he
// would have to get first (`buy`), what he owns (`shelf`), the diary across
// titles, one series, the time and money spent by ISO week (`time`), a year in
// review (`year`), and the wide text search. Views are operations in the
// contract, so the CLI, the app, and Codex see one answer. Nothing here
// writes; every view is one store.read snapshot over the non-deleted titles,
// and returns TitleSummary rows unless asked for the `full` record. Bad input
// throws with the view and field named: a view never answers a failed read
// with an empty result. Series is `TitleOps.series`, reached through the ops.

import { z } from "zod";
import {
  bookFormat as bookFormatSchema,
  issuesOf,
  medium as mediumSchema,
  moodFit as moodFitSchema,
  on as onSchema,
  timeFit as timeFitSchema,
  type Availability,
  type BookFormat,
  type Entry,
  type Medium,
  type Money,
  type MoodFit,
  type On,
  type Progress,
  type Title,
  type TitleSummary,
  type TimeFit,
} from "../contract.ts";
import type { Clock } from "../core.ts";
import type { Store } from "../store.ts";
import { addDays, todayIn } from "../time.ts";
import { isOwnershipEntry, lastEntry, orderEntries } from "./derive.ts";
import { compareOn, isoWeekEnd, isoWeekStart, onRange, yearOf } from "./on.ts";
import { sortTitles, summarize, type SeriesView, type TitleOps } from "./titles.ts";

// ------------------------------------------------------------------ types

/** A row of a view: the compact summary by default, the whole record with `full`. */
export type ViewTitle = TitleSummary | Title;

export type ViewOptions = {
  /** Full records instead of summaries. */
  full?: boolean;
};

export type BacklogOptions = ViewOptions & {
  /** A mood the title fits. */
  mood?: MoodFit;
  /** The time fit. */
  fit?: TimeFit;
  /** A book's wanted format. */
  format?: BookFormat;
  /** A service named in `facts.availability` (case-insensitive substring), so "what could I watch on Netflix" is a query. */
  service?: string;
  /** Also the done titles marked with a priority: what he wants to replay or reread. */
  wantedAgain?: boolean;
};

/** A title he would have to get first, with where, and the cheapest listed price when any source has one. */
export type BuyItem = { title: ViewTitle; availability: Availability[]; lowestPrice: Money | null };

/** Owned titles by what he has done with them. */
export type ShelfView = { done: ViewTitle[]; inProgress: ViewTitle[]; untouched: ViewTitle[]; dropped: ViewTitle[] };

export type DiaryEntry = Entry & { titleId: string; titleName: string; medium: Medium };
export type DiaryOptions = { medium?: Medium; since?: On; until?: On; limit?: number };
export type DiaryView = { entries: DiaryEntry[] };

/** Spend by kind within one currency. */
export type SpendByKind = { purchase: number; iap: number; rental: number };
/** Minutes by medium (only media with any), spend by currency, and the titles with minutes, most first. */
export type TimeBucket = {
  minutes: Partial<Record<Medium, number>>;
  spend: Record<string, SpendByKind>;
  titles: { id: string; name: string; minutes: number }[];
};
export type TimeWeek = TimeBucket & { from: string; to: string };
export type TimeOptions = { medium?: Medium; since?: On; until?: On; weeks?: number };
export type TimeView = {
  from: string;
  to: string;
  /** The sum over the clipped range. */
  total: TimeBucket;
  /** One per ISO week touching the range, oldest first; the first and last are clipped to `from` and `to`. */
  weeks: TimeWeek[];
  /** Entries with minutes or spend that fall in (or may fall in) the range but cannot be placed in a week: month, year, and unknown precision. */
  unplaced: number;
};

export type YearItem = { title: ViewTitle; entry: Entry };
export type YearView = {
  year: number;
  /** Finishes dated in the year at any precision but unknown, oldest first. */
  finished: YearItem[];
  dropped: YearItem[];
  /** How many of `finished` were rewatches, rereads, or replays: the title had finished before. */
  again: number;
  /** Finishes per medium and the average of their ratings (null when none was rated). */
  byMedium: Partial<Record<Medium, { count: number; avgRating: number | null }>>;
};

export interface MediaViews {
  /** Active and paused titles, active first, then by the last entry's `at`, newest first. */
  now(medium?: Medium, opts?: ViewOptions): Promise<ViewTitle[]>;
  /** Titles noticed but never wanted (D99), newest first. */
  curious(medium?: Medium, opts?: ViewOptions): Promise<ViewTitle[]>;
  /** Backlog titles with ownership not `none` (plus done titles with a priority when `wantedAgain`), narrowed by the options; priority then name. */
  backlog(medium?: Medium, opts?: BacklogOptions): Promise<ViewTitle[]>;
  /** Backlog titles with ownership `none`, each with where to get it (buy, rent, play, listen, borrow) and the lowest price listed. */
  buy(medium?: Medium, opts?: ViewOptions): Promise<BuyItem[]>;
  /** Owned titles in four buckets, each sorted like `list`. */
  shelf(medium?: Medium, opts?: ViewOptions): Promise<ShelfView>;
  /** Entries across titles, newest first by `on` then `at`; unknown-precision entries excluded; `since` and `until` are dates with precision, and an entry is in the range when the days its `on` covers overlap it. */
  diary(opts?: DiaryOptions): Promise<DiaryView>;
  /** As `TitleOps.series`: null when the ref does not resolve or the title is in no series. */
  series(ref: string): Promise<SeriesView | null>;
  /** Minutes and spend by ISO week over the last `weeks` weeks (default 8), or the range `since`..`until`. */
  time(opts?: TimeOptions): Promise<TimeView>;
  /** Finishes and drops in a calendar year, placed by `on` at any precision but unknown. */
  year(year: number, medium?: Medium, opts?: ViewOptions): Promise<YearView>;
  /** Non-deleted titles of any status where name, an alias, a creator, notes, the review, or any entry text contains `text`. */
  search(text: string, opts?: ViewOptions): Promise<ViewTitle[]>;
}

/** The most weeks `time` will lay out. */
export const MAX_TIME_WEEKS = 520;
/** How many weeks `time` covers when no range is given. */
export const DEFAULT_TIME_WEEKS = 8;
/** The availability kinds `buy` lists: ways to get a title, not ways he already has it. */
export const BUY_KINDS: readonly Availability["kind"][] = ["buy", "rent", "play", "listen", "borrow"];
/** The order media appear in a bucket. */
const MEDIA: readonly Medium[] = ["movie", "show", "game", "book"];

// ------------------------------------------------------------------ input schemas

/** A range bound: any precision but unknown, which cannot bound anything. */
const boundSchema = onSchema.refine((value) => value.precision !== "unknown", "An unknown date cannot bound a range");
const viewOptionsSchema = z.strictObject({ full: z.boolean().optional() });
const backlogOptionsSchema = viewOptionsSchema.extend({
  mood: moodFitSchema.optional(),
  fit: timeFitSchema.optional(),
  format: bookFormatSchema.optional(),
  service: z.string().trim().min(1).max(200).optional(),
  wantedAgain: z.boolean().optional(),
});
const diaryOptionsSchema = z.strictObject({
  medium: mediumSchema.optional(),
  since: boundSchema.optional(),
  until: boundSchema.optional(),
  limit: z.number().int().min(1).max(100000).optional(),
});
const timeOptionsSchema = z.strictObject({
  medium: mediumSchema.optional(),
  since: boundSchema.optional(),
  until: boundSchema.optional(),
  weeks: z.number().int().min(1).max(MAX_TIME_WEEKS).optional(),
});
const yearSchema = z.number().int().min(1).max(9999);

// ------------------------------------------------------------------ helpers

/** Parse `value` with `schema`, throwing an Error naming the view and the field (a scalar's issues carry `field` instead of `input`) so an agent can correct the call. */
function parse<T>(view: string, schema: z.ZodType<T>, value: unknown, field = "input"): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new Error(`${view}: ${issuesOf(parsed.error).map((issue) => issue.replace(/^input:/, `${field}:`)).join("; ")}`);
}

const parseMedium = (view: string, medium: Medium | undefined): Medium | undefined => (medium === undefined ? undefined : parse(view, mediumSchema, medium, "medium"));

const ofMedium = (titles: Title[], medium: Medium | undefined): Title[] => (medium === undefined ? titles : titles.filter((title) => title.medium === medium));
const withStatus = (statuses: readonly Progress[]) => (title: Title): boolean => statuses.includes(title.status);
const byName = (a: Title, b: Title): number => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
const newestFirst = (a: Title, b: Title): number => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
const present = (titles: Title[], full: boolean | undefined): ViewTitle[] => (full ? titles : titles.map(summarize));
const one = (title: Title, full: boolean | undefined): ViewTitle => (full ? title : summarize(title));

/** `now`'s order: active before paused, then the last entry's `at` newest first, then name. */
function byNow(a: Title, b: Title): number {
  if (a.status !== b.status) return a.status === "active" ? -1 : 1;
  const lastA = lastEntry(a.entries)?.at ?? "";
  const lastB = lastEntry(b.entries)?.at ?? "";
  return lastB.localeCompare(lastA) || byName(a, b);
}

/** Whether a title's availability names `service` (case-insensitive substring). */
function onService(title: Title, service: string): boolean {
  const needle = service.toLowerCase();
  return (title.facts?.availability ?? []).some((row) => row.name.toLowerCase().includes(needle));
}

/** The cheapest listed price among `rows` (by amount; a region's listings share a currency), or null when none carries one. */
export function lowestPrice(rows: Availability[]): Money | null {
  let best: Money | null = null;
  for (const row of rows) if (row.price && (best === null || row.price.amount < best.amount)) best = row.price;
  return best;
}

/** Diary order reversed: newest `on` first (finer precision first on a tie), then `at`, then the diary's own tie-break. */
function newestEntryFirst(a: DiaryEntry, b: DiaryEntry): number {
  const byOn = compareOn(b.on, a.on);
  if (byOn !== 0) return byOn;
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Every entry of every title, tagged with its title. */
function allEntries(titles: Title[]): DiaryEntry[] {
  const out: DiaryEntry[] = [];
  for (const title of titles) for (const entry of title.entries) out.push({ ...entry, titleId: title.id, titleName: title.name, medium: title.medium });
  return out;
}

/** Whether the days `on` covers overlap [from, to]. False for unknown. */
function overlaps(on: On, from: string, to: string): boolean {
  const range = onRange(on);
  return range !== null && range.start <= to && range.end >= from;
}

const emptyBucket = (): TimeBucket => ({ minutes: {}, spend: {}, titles: [] });

/** Accumulate one entry's minutes or spend into a bucket (the entry has at least one). */
function addToBucket(bucket: TimeBucket, entry: DiaryEntry, titleMinutes: Map<string, { id: string; name: string; minutes: number }>): void {
  if (entry.minutes !== null && !isOwnershipEntry(entry.type)) {
    bucket.minutes[entry.medium] = (bucket.minutes[entry.medium] ?? 0) + entry.minutes;
    const row = titleMinutes.get(entry.titleId) ?? { id: entry.titleId, name: entry.titleName, minutes: 0 };
    row.minutes += entry.minutes;
    titleMinutes.set(entry.titleId, row);
  }
  if (entry.spend !== null && isOwnershipEntry(entry.type)) {
    const byKind = (bucket.spend[entry.spend.currency] ??= { purchase: 0, iap: 0, rental: 0 });
    byKind[entry.spend.kind] = round2(byKind[entry.spend.kind] + entry.spend.amount);
  }
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** A bucket finished: minutes in medium order, currencies alphabetical, titles by minutes then name. */
function settle(bucket: TimeBucket, titleMinutes: Map<string, { id: string; name: string; minutes: number }>): TimeBucket {
  const minutes: TimeBucket["minutes"] = {};
  for (const medium of MEDIA) if (bucket.minutes[medium] !== undefined) minutes[medium] = bucket.minutes[medium];
  const spend: TimeBucket["spend"] = {};
  for (const currency of Object.keys(bucket.spend).sort()) spend[currency] = bucket.spend[currency]!;
  const titles = [...titleMinutes.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { minutes, spend, titles };
}

/** The ISO weeks touching [from, to], each clipped to the range. */
function weeksOf(from: string, to: string): { from: string; to: string; weekStart: string }[] {
  const out: { from: string; to: string; weekStart: string }[] = [];
  for (let weekStart = isoWeekStart(from); weekStart <= to; weekStart = addDays(weekStart, 7)) {
    const weekEnd = addDays(weekStart, 6);
    out.push({ weekStart, from: weekStart < from ? from : weekStart, to: weekEnd > to ? to : weekEnd });
  }
  return out;
}

/**
 * The range `time` covers. No bounds: the last `weeks` ISO weeks ending with
 * the current one. `since` alone: from its first day to the end of the current
 * week. `until` alone: `weeks` weeks ending with the week `until` ends in,
 * clipped to `until`. Both: exactly their span.
 */
function timeRange(opts: TimeOptions, today: string): { from: string; to: string } {
  const weeks = opts.weeks ?? DEFAULT_TIME_WEEKS;
  const since = opts.since ? onRange(opts.since)!.start : null;
  const until = opts.until ? onRange(opts.until)!.end : null;
  if (since !== null && until !== null) {
    if (since > until) throw new Error(`time: since: ${since} is after until ${until}`);
    return { from: since, to: until };
  }
  if (since !== null) return { from: since, to: isoWeekEnd(today) < since ? isoWeekEnd(since) : isoWeekEnd(today) };
  const to = until ?? isoWeekEnd(today);
  return { from: addDays(isoWeekStart(to), -7 * (weeks - 1)), to };
}

/** Whether a title had finished before `entry` in diary order: the finish is a rewatch, reread, or replay. */
function finishedBefore(title: Title, entry: Entry): boolean {
  for (const other of orderEntries(title.entries)) {
    if (other.id === entry.id) return false;
    if (other.type === "finish") return true;
  }
  return false;
}

/** Whether any of the title's own text or its entries' text contains `needle` (already lowercased). */
function mentions(title: Title, needle: string): boolean {
  const texts = [title.name, ...title.aliases, ...title.creators, title.notes ?? "", title.review ?? "", ...title.entries.map((entry) => entry.text ?? "")];
  return texts.some((text) => text.toLowerCase().includes(needle));
}

// ------------------------------------------------------------------ the factory

/** The library views over `store` with `clock`; `series` goes through `titles`. */
export function createMediaViews(store: Store, clock: Clock, titles: TitleOps): MediaViews {
  const today = (): string => todayIn(clock.timezone, clock.now());
  const live = (medium: Medium | undefined): Promise<Title[]> => store.read(async (tx) => ofMedium(await tx.all("title"), medium));

  return {
    async now(medium, opts = {}) {
      const scope = parseMedium("now", medium);
      const { full } = parse("now", viewOptionsSchema, opts);
      const found = (await live(scope)).filter(withStatus(["active", "paused"]));
      return present(found.sort(byNow), full);
    },

    async curious(medium, opts = {}) {
      const scope = parseMedium("curious", medium);
      const { full } = parse("curious", viewOptionsSchema, opts);
      const found = (await live(scope)).filter(withStatus(["curious"]));
      return present(found.sort(newestFirst), full);
    },

    async backlog(medium, opts = {}) {
      const scope = parseMedium("backlog", medium);
      const q = parse("backlog", backlogOptionsSchema, opts);
      const found = (await live(scope)).filter((title) => {
        const startable = title.status === "backlog" && title.ownership !== "none";
        const wantedAgain = q.wantedAgain === true && title.status === "done" && title.priority !== null;
        if (!startable && !wantedAgain) return false;
        if (q.mood !== undefined && !title.moodFit.includes(q.mood)) return false;
        if (q.fit !== undefined && title.timeFit !== q.fit) return false;
        if (q.format !== undefined && title.detail.format !== q.format) return false;
        if (q.service !== undefined && !onService(title, q.service)) return false;
        return true;
      });
      // sortTitles is status, priority, name; the two statuses here (backlog, done) keep that order too.
      return present(sortTitles(found), q.full);
    },

    async buy(medium, opts = {}) {
      const scope = parseMedium("buy", medium);
      const { full } = parse("buy", viewOptionsSchema, opts);
      const found = sortTitles((await live(scope)).filter((title) => title.status === "backlog" && title.ownership === "none"));
      return found.map((title) => {
        const availability = (title.facts?.availability ?? []).filter((row) => BUY_KINDS.includes(row.kind));
        return { title: one(title, full), availability, lowestPrice: lowestPrice(availability) };
      });
    },

    async shelf(medium, opts = {}) {
      const scope = parseMedium("shelf", medium);
      const { full } = parse("shelf", viewOptionsSchema, opts);
      const owned = sortTitles((await live(scope)).filter((title) => title.ownership === "owned"));
      const bucket = (statuses: readonly Progress[]): ViewTitle[] => present(owned.filter(withStatus(statuses)), full);
      return {
        done: bucket(["done"]),
        inProgress: bucket(["active", "paused"]),
        untouched: bucket(["backlog", "curious"]),
        dropped: bucket(["dropped"]),
      };
    },

    async diary(opts = {}) {
      const q = parse("diary", diaryOptionsSchema, opts);
      const since = q.since ? onRange(q.since)!.start : null;
      const until = q.until ? onRange(q.until)!.end : null;
      if (since !== null && until !== null && since > until) throw new Error(`diary: since: ${since} is after until ${until}`);
      const entries = allEntries(await live(q.medium))
        .filter((entry) => entry.on.precision !== "unknown" && overlaps(entry.on, since ?? "0000-01-01", until ?? "9999-12-31"))
        .sort(newestEntryFirst);
      return { entries: q.limit !== undefined ? entries.slice(0, q.limit) : entries };
    },

    series: (ref) => titles.series(ref),

    async time(opts = {}) {
      const q = parse("time", timeOptionsSchema, opts);
      const { from, to } = timeRange(q, today());
      const weeks = weeksOf(from, to);
      const weekIndex = new Map(weeks.map((week, index) => [week.weekStart, index]));
      const buckets = weeks.map(() => ({ bucket: emptyBucket(), titles: new Map<string, { id: string; name: string; minutes: number }>() }));
      const total = { bucket: emptyBucket(), titles: new Map<string, { id: string; name: string; minutes: number }>() };
      let unplaced = 0;
      for (const entry of allEntries(await live(q.medium))) {
        const counts = (entry.minutes !== null && !isOwnershipEntry(entry.type)) || (entry.spend !== null && isOwnershipEntry(entry.type));
        if (!counts) continue;
        const { on } = entry;
        let index: number | undefined;
        if (on.precision === "day") {
          if (on.date! < from || on.date! > to) continue;
          index = weekIndex.get(isoWeekStart(on.date!));
        } else if (on.precision === "week") {
          index = weekIndex.get(on.date!);
          if (index === undefined) continue;
        } else if (on.precision === "unknown" || overlaps(on, from, to)) {
          unplaced += 1;
          continue;
        } else {
          continue;
        }
        if (index === undefined) continue;
        addToBucket(buckets[index]!.bucket, entry, buckets[index]!.titles);
        addToBucket(total.bucket, entry, total.titles);
      }
      return {
        from,
        to,
        total: settle(total.bucket, total.titles),
        weeks: weeks.map((week, index) => ({ from: week.from, to: week.to, ...settle(buckets[index]!.bucket, buckets[index]!.titles) })),
        unplaced,
      };
    },

    async year(year, medium, opts = {}) {
      const wanted = parse("year", yearSchema, year, "year");
      const scope = parseMedium("year", medium);
      const { full } = parse("year", viewOptionsSchema, opts);
      const finished: YearItem[] = [];
      const dropped: YearItem[] = [];
      let again = 0;
      const byMedium: YearView["byMedium"] = {};
      const tally = new Map<Medium, { count: number; sum: number; rated: number }>();
      const inYear = (entry: DiaryEntry): boolean => yearOf(entry.on) === wanted;
      const oldestFirst = (a: DiaryEntry, b: DiaryEntry): number => newestEntryFirst(b, a);
      const titlesById = new Map((await live(scope)).map((title) => [title.id, title]));
      for (const entry of allEntries([...titlesById.values()]).filter(inYear).sort(oldestFirst)) {
        if (entry.type !== "finish" && entry.type !== "drop") continue;
        const title = titlesById.get(entry.titleId)!;
        const { titleId: _id, titleName: _name, medium: _medium, ...plain } = entry;
        const item: YearItem = { title: one(title, full), entry: plain };
        if (entry.type === "drop") {
          dropped.push(item);
          continue;
        }
        finished.push(item);
        if (finishedBefore(title, entry)) again += 1;
        const row = tally.get(title.medium) ?? { count: 0, sum: 0, rated: 0 };
        row.count += 1;
        if (entry.rating !== null) {
          row.sum += entry.rating;
          row.rated += 1;
        }
        tally.set(title.medium, row);
      }
      for (const medium of MEDIA) {
        const row = tally.get(medium);
        if (row) byMedium[medium] = { count: row.count, avgRating: row.rated ? round2(row.sum / row.rated) : null };
      }
      return { year: wanted, finished, dropped, again, byMedium };
    },

    async search(text, opts = {}) {
      const needle = text.trim().toLowerCase();
      if (!needle) throw new Error("search: text is required");
      const { full } = parse("search", viewOptionsSchema, opts);
      const found = (await live(undefined)).filter((title) => mentions(title, needle));
      return present(sortTitles(found), full);
    },
  };
}
