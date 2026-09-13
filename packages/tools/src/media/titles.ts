// Titles: the library's records and everything that happens to them (LEISURE
// D79 to D101). Adding with the name and catalog duplicate checks and the
// lookup that never blocks, listing with the compact summaries, updating with
// `edited` bookkeeping, the thirteen diary entries judged by `allowed` against
// the title's current state, corrections (`amend`, `unlog`, `relog`) that skip
// it, the take (`rate`, `review`, `like`), the catalog operations, series,
// merge, delete, and restore. Every write goes through core.mutate / applyIn
// with the record passed through `finalize` first, so the schema's stale-field
// check always holds; lookups run before the write transaction, never inside
// it. Refs are ids or names, resolved by lookup.ts; warnings ride on the
// receipt, never on the record.

import { z } from "zod";
import {
  ctxSchema,
  entryId as entryIdSchema,
  entryInputSchema,
  entryPatchSchema,
  entrySchema,
  issuesOf,
  rating as ratingSchema,
  titleAddSchema,
  titleListSchema,
  titleRef as titleRefSchema,
  titleUpdateSchema,
  type Availability,
  type BookFormat,
  type Ctx,
  type EditedField,
  type Entry,
  type EntryInput,
  type EntryPatch,
  type EntryType,
  type LogEntry,
  type Medium,
  type Needs,
  type Ownership,
  type Progress,
  type Rating,
  type Receipt,
  type Title,
  type TitleAdd,
  type TitleDetailInput,
  type TitleList,
  type TitlePriority,
  type TitleSummary,
  type TitleUpdate,
} from "../contract.ts";
import { RejectedAfterWrites, applyIn, bump, checkVersion, diff, duplicate as duplicateMutation, fail, itemCtx, mutate, newId, okMutation, randomSuffix, rejected, replayReceipt, type Clock, type Mutation } from "../core.ts";
import { cascadeCtx } from "../organize.ts";
import type { Store, Tx } from "../store.ts";
import { todayIn } from "../time.ts";
import type { Candidate } from "./catalog/adapter.ts";
import { catalogFor, type Catalogs } from "./catalog/index.ts";
import { normalizeRegion } from "./catalog/links.ts";
import { BUDGET_MS, Budget, realTimer, type Timer } from "./catalog/net.ts";
import { normalizeTitle } from "../tasks.ts";
import { allowed, backdatedWarning, finalize, lastEntry, orderEntries } from "./derive.ts";
import {
  applyPull,
  findByName,
  isTitleId,
  judge,
  markInLibrary,
  pullChanged,
  resolve,
  resolveAvailability,
  resolveTitle,
  type CatalogPull,
  type RefOptions,
  type RefResolution,
  type Resolution,
} from "./lookup.ts";

// ------------------------------------------------------------------ types

/** The next work in a series, on a finish receipt: the catalog's id when it has one, and the library title when it is already there. */
export type NextInSeries = { externalId: string | null; name: string; position: number | null; titleId: string | null };
/** One work of a series as `series` and `next` read it: the catalog's entry, the library's title, or both. */
export type SeriesEntry = { position: number | null; name: string; externalId: string | null; released: string | null; title: Title | null };
export type SeriesView = { name: string; position: number | null; entries: SeriesEntry[] };
export type NextView = { seriesEntry: SeriesEntry; title: Title | null };
export type CandidateKind = "title" | "catalog";

type Extras = {
  /** Backdated entries, a status the entry does not fit, a lookup that failed, the next in a series. The CLI lifts these into the envelope. */
  warnings?: string[];
  /** `title` on a library duplicate, `catalog` on a catalog `needs` rejection. */
  candidateKind?: CandidateKind;
  /** On `finish`, when the title is in a series. */
  next?: NextInSeries;
  /** On `unlog`, the entry taken off the diary. */
  removed?: Entry;
};

/**
 * A receipt plus what a title operation can add. A duplicate carries `Title`
 * candidates (from `Receipt`) with `candidateKind: "title"`; a rejection
 * carries `Candidate`s on a catalog `needs` (`candidateKind: "catalog"`) or
 * `Title`s on a `needs` on `ref` (`candidateKind: "title"`).
 */
export type TitleReceipt =
  | (Extract<Receipt<Title>, { ok: true }> & Extras)
  | (Extract<Receipt<Title>, { outcome: "duplicate" }> & Extras)
  | (Extract<Receipt<Title>, { outcome: "rejected" }> & Extras & { candidates?: Candidate[] | Title[] });

export type SearchOptions = { year?: number; availability?: boolean };
/** A search hit, with its availability when `catalog.search` was asked for it. */
export type SearchCandidate = Candidate & { availability?: Availability[] };
export type AvailabilityScope = { status: "backlog"; medium?: Medium };
/** What `catalog.availability` over the backlog reports: one title per transaction, so a failure stops nothing else. */
export type AvailabilityReport = {
  refreshed: { id: string; name: string; outcome: "updated" | "unchanged" }[];
  failed: { id: string; name: string; issues: string[] }[];
};
export type WhereRef = string | { catalog: string; medium: Medium };
export type EntryTarget = { entry?: string };
export type AgainOptions = { finished?: boolean };
export type FinishOptions = { queueNext?: boolean };

/** The issue prefix a source failure carries on a catalog operation: `catalog_unavailable: <message>`; the CLI maps it to exit 3. */
export const CATALOG_UNAVAILABLE = "catalog_unavailable";

export interface CatalogOps {
  /** No write. Throws CatalogUnavailable and CatalogUnconfigured; `inLibrary` is filled. With `availability`, the auto-link match (else up to three candidates) carries its list. */
  search(medium: Medium, text: string, opts?: SearchOptions): Promise<SearchCandidate[]>;
  link(ref: string, externalId: string, ctx: Ctx): Promise<TitleReceipt>;
  unlink(ref: string, ctx: Ctx): Promise<TitleReceipt>;
  /** Re-pull; on a title without a catalog, the full lookup with the same `needs` path as `add`. */
  refresh(ref: string, ctx: Ctx): Promise<TitleReceipt>;
  availability(ref: string, ctx: Ctx): Promise<TitleReceipt>;
  availability(scope: AvailabilityScope, ctx: Ctx): Promise<AvailabilityReport>;
}

export interface TitleOps {
  add(input: TitleAdd, ctx: Ctx): Promise<TitleReceipt>;
  /** Deleted included by id; names find live titles only. Throws when a name is ambiguous; null when nothing matches. */
  get(ref: string): Promise<Title | null>;
  /** What a ref names, with the candidates and hint when it does not resolve: what the CLI asks with. */
  resolve(ref: string, opts?: RefOptions): Promise<RefResolution>;
  /** Throws when the criteria are invalid. Summaries unless `full`. */
  list(filter?: TitleList): Promise<TitleSummary[] | Title[]>;
  update(ref: string, input: TitleUpdate, ctx: Ctx): Promise<TitleReceipt>;
  want(ref: string, input: EntryInput, ctx: Ctx): Promise<TitleReceipt>;
  start(ref: string, input: EntryInput, ctx: Ctx): Promise<TitleReceipt>;
  resume(ref: string, input: EntryInput, ctx: Ctx): Promise<TitleReceipt>;
  pause(ref: string, input: EntryInput, ctx: Ctx): Promise<TitleReceipt>;
  progress(ref: string, input: EntryInput, ctx: Ctx): Promise<TitleReceipt>;
  note(ref: string, input: EntryInput, ctx: Ctx): Promise<TitleReceipt>;
  buy(ref: string, input: EntryInput, ctx: Ctx): Promise<TitleReceipt>;
  borrow(ref: string, input: EntryInput, ctx: Ctx): Promise<TitleReceipt>;
  return(ref: string, input: EntryInput, ctx: Ctx): Promise<TitleReceipt>;
  service(ref: string, input: EntryInput, ctx: Ctx): Promise<TitleReceipt>;
  again(ref: string, input: EntryInput, ctx: Ctx, opts?: AgainOptions): Promise<TitleReceipt>;
  finish(ref: string, input: EntryInput, ctx: Ctx, opts?: FinishOptions): Promise<TitleReceipt>;
  drop(ref: string, input: EntryInput, ctx: Ctx): Promise<TitleReceipt>;
  amend(ref: string, entryId: string, patch: EntryPatch, ctx: Ctx): Promise<TitleReceipt>;
  unlog(ref: string, entryId: string, ctx: Ctx): Promise<TitleReceipt>;
  relog(ref: string, entryId: string, into: string, ctx: Ctx): Promise<TitleReceipt>;
  rate(ref: string, rating: Rating, ctx: Ctx, opts?: EntryTarget): Promise<TitleReceipt>;
  unrate(ref: string, ctx: Ctx, opts?: EntryTarget): Promise<TitleReceipt>;
  review(ref: string, text: string, ctx: Ctx, opts?: EntryTarget): Promise<TitleReceipt>;
  like(ref: string, ctx: Ctx): Promise<TitleReceipt>;
  unlike(ref: string, ctx: Ctx): Promise<TitleReceipt>;
  catalog: CatalogOps;
  /** `facts.availability` of a title, or a live call for a catalog id. Throws source errors on the live call. */
  where(ref: WhereRef): Promise<Availability[]>;
  next(ref: string): Promise<NextView | null>;
  series(ref: string): Promise<SeriesView | null>;
  merge(ref: string, into: string, ctx: Ctx): Promise<TitleReceipt>;
  delete(ref: string, ctx: Ctx): Promise<TitleReceipt>;
  restore(id: string, ctx: Ctx): Promise<TitleReceipt>;
  history(ref: string): Promise<LogEntry[]>;
  /** The same operations with every ref resolved among one medium's titles: what a `life <medium>` group uses. */
  scoped(medium: Medium): TitleOps;
}

export type TitleDeps = {
  catalogs: Catalogs;
  /** Neel's region for availability (LIFE_REGION); normalized, `US` when absent. */
  region?: string;
  /** The lookup budget's timer and length; the wall clock and 20 seconds by default. Tests pass a short budget with a stalled FakeCatalog. */
  timer?: Timer;
  budgetMs?: number;
};

// ------------------------------------------------------------------ input schemas local to titles

const entryTargetSchema = z.strictObject({ entry: entryIdSchema.optional() });
const againOptionsSchema = z.strictObject({ finished: z.boolean().optional() });
const finishOptionsSchema = z.strictObject({ queueNext: z.boolean().optional() });
const reviewTextSchema = z.string().trim().min(1, "Required").max(20000);
const searchOptionsSchema = z.strictObject({ year: z.number().int().min(1).max(9999).optional(), availability: z.boolean().optional() });
const availabilityScopeSchema = z.strictObject({ status: z.literal("backlog"), medium: z.enum(["movie", "show", "game", "book"]).optional() });

// ------------------------------------------------------------------ small helpers

/** How `list` orders statuses: what he is on first, what he has finished last. */
export const STATUS_ORDER: readonly Progress[] = ["active", "paused", "backlog", "curious", "done", "dropped"];
/** How `list` orders priorities: `now` first, none last. */
export const PRIORITY_ORDER: readonly (TitlePriority | null)[] = ["now", "soon", "later", null];
const CLOSERS: ReadonlySet<EntryType> = new Set(["finish", "drop"]);
/** Which detail fields a medium has; the others must stay null (D73). */
const DETAIL_FIELDS: Record<Medium, readonly (keyof Title["detail"])[]> = { book: ["format"], game: ["platform"], movie: ["where"], show: ["where"] };

type Lookup<T> = { ok: true; record: T } | { ok: false; issues: string[]; id?: string; needs?: Needs };
const failed = (lookup: { issues: string[]; id?: string; needs?: Needs }): Mutation<Title> =>
  fail<Title>(lookup.issues, { ...(lookup.id !== undefined ? { id: lookup.id } : {}), ...(lookup.needs !== undefined ? { needs: lookup.needs } : {}) });
const isEntryId = (value: string): boolean => entryIdSchema.safeParse(value).success;
const byStatus = (a: Title, b: Title): number => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
const byPriority = (a: Title, b: Title): number => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
const byName = (a: Title, b: Title): number => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
const byCreated = (a: Title, b: Title): number => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
/** `list`'s sort: status order, then priority, then name. */
export const sortTitles = (titles: Title[]): Title[] => [...titles].sort((a, b) => byStatus(a, b) || byPriority(a, b) || byName(a, b));

function originOf(ctx: Ctx, now: string): Title["origin"] {
  return {
    actor: ctx.actor,
    at: now,
    ...(ctx.reason !== undefined ? { reason: ctx.reason } : {}),
    evidence: ctx.evidence ?? [],
  };
}

/** The compact shape `list` and the views return. */
export function summarize(title: Title): TitleSummary {
  const last = lastEntry(title.entries);
  return {
    id: title.id,
    medium: title.medium,
    name: title.name,
    year: title.year,
    status: title.status,
    ownership: title.ownership,
    priority: title.priority,
    rating: title.rating,
    liked: title.liked,
    timeFit: title.timeFit,
    moodFit: title.moodFit,
    lastEntry: last ? { type: last.type, on: last.on, text: last.text } : null,
  };
}

/** `updated` with a bump when anything outside version/updatedAt differs, else `unchanged`. The record is finalized either way. */
function updatedOrUnchanged(before: Title, next: Title, now: string): Mutation<Title> {
  const after = finalize(next);
  return Object.keys(diff(before, after)).length ? okMutation("updated", before, bump(after, now)) : okMutation("unchanged", before, before);
}

/** Why an entry is malformed on its own (the facet rules of `entrySchema`), as `field: message` issues. */
function entryIssues(entry: Entry): string[] {
  const parsed = entrySchema.safeParse(entry);
  return parsed.success ? [] : issuesOf(parsed.error);
}

/** The detail input's issues for a medium: a non-null field the medium does not have. */
function detailIssues(medium: Medium, input: TitleDetailInput | undefined): string[] {
  if (!input) return [];
  const applies = DETAIL_FIELDS[medium];
  return (["format", "platform", "where"] as const)
    .filter((field) => input[field] !== undefined && input[field] !== null && !applies.includes(field))
    .map((field) => `detail.${field}: A ${medium} has no ${field}`);
}

/** The medium block from an input: given fields, null for the rest. */
function detailOf(input: TitleDetailInput | undefined): Title["detail"] {
  return { format: input?.format ?? null, platform: input?.platform ?? null, where: input?.where ?? null };
}

/** The non-deleted titles of `medium` whose name or an alias normalizes to `name`: the library duplicate check. */
export function findDuplicateTitles(name: string, titles: Title[], medium: Medium): Title[] {
  const wanted = normalizeTitle(name);
  if (!wanted) return [];
  return titles
    .filter((title) => !title.deletedAt && title.medium === medium && (normalizeTitle(title.name) === wanted || title.aliases.some((alias) => normalizeTitle(alias) === wanted)))
    .sort(byCreated);
}

/** The non-deleted title, other than `except`, linked to the same source and externalId. */
function linkedElsewhere(titles: Title[], medium: Medium, source: string, externalId: string, except?: string): Title | undefined {
  return titles.find((title) => !title.deletedAt && title.medium === medium && title.id !== except && title.catalog?.source === source && title.catalog.externalId === externalId);
}

/** The last closing entry (`finish` or `drop`) in diary order: what `rate` and `review` address without `entry`. */
function lastClosing(entries: Entry[]): Entry | null {
  const ordered = orderEntries(entries);
  for (let i = ordered.length - 1; i >= 0; i -= 1) if (CLOSERS.has(ordered[i]!.type)) return ordered[i]!;
  return null;
}

/** Aliases with `extra` folded in: no repeats by normalized name, and never the title's own name. */
function withAliases(name: string, aliases: string[], extra: string[]): string[] {
  const out = [...aliases];
  const seen = new Set([normalizeTitle(name), ...aliases.map(normalizeTitle)]);
  for (const alias of extra) {
    const key = normalizeTitle(alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

/** A cascaded write was rejected: abort the transaction and surface the issues as the primary receipt. */
class CascadeRejected extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join("; "));
    this.issues = issues;
  }
}

function must(receipt: Receipt<Title>, what: string): Title {
  if (!receipt.ok) throw new CascadeRejected(receipt.issues.map((issue) => `${what}: ${issue}`));
  return receipt.record;
}

// ------------------------------------------------------------------ series (D87): pure over the library

const seriesNameOf = (title: Title): string | null => title.series?.name ?? title.facts?.series?.name ?? null;
const seriesPositionOf = (title: Title): number | null => (title.series ? title.series.position : (title.facts?.series?.position ?? null));
const compareNullable = <T extends string | number>(a: T | null, b: T | null): number => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : a < b ? -1 : a > b ? 1 : 0);
const bySeriesOrder = (a: SeriesEntry, b: SeriesEntry): number =>
  compareNullable(a.position, b.position) || compareNullable(a.released, b.released) || a.name.localeCompare(b.name);

/**
 * The series a title belongs to, hand-set winning over `facts.series` for the
 * name and position (D93). Entries are the catalog's, each matched to the
 * library title linked to its id (or bearing its name), plus every library
 * title of the medium that names the same series by hand or by catalog and
 * is not already among them, so a book series set by hand works too.
 */
export function seriesOf(title: Title, titles: Title[]): SeriesView | null {
  const name = seriesNameOf(title);
  if (name === null) return null;
  const key = normalizeTitle(name);
  const library = titles.filter((other) => !other.deletedAt && other.medium === title.medium);
  const byExternal = (externalId: string): Title | null =>
    library.find((other) => other.catalog?.externalId === externalId && (!title.catalog || other.catalog?.source === title.catalog.source)) ?? null;
  const byTitleName = (text: string): Title | null => {
    const hits = findByName(library, text).filter((other) => normalizeTitle(other.name) === normalizeTitle(text));
    return hits.length === 1 ? hits[0]! : null;
  };
  const entries: SeriesEntry[] = [];
  const placed = new Set<string>();
  const facts = title.facts?.series;
  if (facts && normalizeTitle(facts.name) === key) {
    for (const entry of facts.entries) {
      const match = byExternal(entry.externalId) ?? byTitleName(entry.name);
      if (match) placed.add(match.id);
      entries.push({ position: entry.position, name: entry.name, externalId: entry.externalId, released: entry.released, title: match });
    }
  }
  for (const other of library) {
    if (placed.has(other.id)) continue;
    const otherName = seriesNameOf(other);
    if (otherName === null || normalizeTitle(otherName) !== key) continue;
    placed.add(other.id);
    entries.push({ position: seriesPositionOf(other), name: other.name, externalId: other.catalog?.externalId ?? null, released: other.facts?.released ?? null, title: other });
  }
  return { name, position: seriesPositionOf(title), entries: entries.sort(bySeriesOrder) };
}

/** The entry after this title in its series: by position, or by release date when positions are null. Null outside a series or at its end. */
export function nextOf(title: Title, titles: Title[]): NextView | null {
  const series = seriesOf(title, titles);
  if (!series) return null;
  const self = series.entries.find((entry) => entry.title?.id === title.id) ?? null;
  const position = series.position ?? self?.position ?? null;
  let found: SeriesEntry | undefined;
  if (position !== null) {
    found = series.entries.find((entry) => entry.position !== null && entry.position > position);
  } else {
    const released = title.facts?.released ?? self?.released ?? null;
    if (released === null) return null;
    found = series.entries.find((entry) => entry.released !== null && entry.released > released && entry.title?.id !== title.id);
  }
  return found ? { seriesEntry: found, title: found.title } : null;
}

// ------------------------------------------------------------------ the factory

/** What a write carries out of the mutation besides the receipt. */
type Meta = { warnings: string[]; next?: NextInSeries; removed?: Entry; candidates?: Candidate[]; candidateKind?: CandidateKind };
type Work = (tx: Tx, ctx: Ctx, now: string, meta: Meta) => Promise<Mutation<Title>>;

/** The title operations over `store` with `clock`, looking works up through `deps.catalogs` for `deps.region`. */
export function createTitles(store: Store, clock: Clock, deps: TitleDeps): TitleOps {
  const region = normalizeRegion(deps.region);
  const timer = deps.timer ?? realTimer;
  const budgetMs = deps.budgetMs ?? BUDGET_MS;
  const lookupOptions = { catalogs: deps.catalogs, region, timer, budgetMs };
  const today = (): string => todayIn(clock.timezone, clock.now());

  return build(undefined);

  function build(scope: Medium | undefined): TitleOps {
    const refOptions = (extra: Omit<RefOptions, "medium"> = {}): RefOptions => ({ ...(scope !== undefined ? { medium: scope } : {}), ...extra });

    // -------------------------------------------------------------- receipts

    function decorate(receipt: Receipt<Title>, meta: Meta): TitleReceipt {
      if (receipt.ok) {
        return {
          ...receipt,
          ...(meta.warnings.length ? { warnings: meta.warnings } : {}),
          ...(meta.next ? { next: meta.next } : {}),
          ...(meta.removed ? { removed: meta.removed } : {}),
        };
      }
      if (receipt.outcome === "duplicate") return { ...receipt, candidateKind: "title" };
      return { ...receipt, ...(meta.candidates ? { candidates: meta.candidates, candidateKind: "catalog" as const } : {}) };
    }

    /** A `needs` on `ref` carries the titles it names, so the CLI can render them without a second call. */
    async function withRefCandidates(receipt: TitleReceipt): Promise<TitleReceipt> {
      if (receipt.ok || receipt.outcome !== "rejected" || receipt.needs?.field !== "ref") return receipt;
      const ids = receipt.needs.options;
      const candidates = await store.read(async (tx) => (await tx.all("title")).filter((title) => ids.includes(title.id)));
      return { ...receipt, candidates, candidateKind: "title" };
    }

    async function write(op: string, ctx: Ctx, work: Work): Promise<TitleReceipt> {
      const meta: Meta = { warnings: [] };
      let receipt: Receipt<Title>;
      try {
        receipt = await mutate(store, clock, "title", op, ctx, (tx, c, now) => workWithMeta(work, tx, c, now, meta));
      } catch (error) {
        if (!(error instanceof CascadeRejected)) throw error;
        receipt = rejected<Title>(error.issues);
      }
      return withRefCandidates(decorate(receipt, meta));
    }

    /** Successful receipt extras must be present when core stores the receipt, inside the same transaction. */
    async function workWithMeta(work: Work, tx: Tx, ctx: Ctx, now: string, meta: Meta): Promise<Mutation<Title>> {
      const mutation = await work(tx, ctx, now, meta);
      if (mutation.receipt.ok) mutation.receipt = decorate(mutation.receipt, meta) as Receipt<Title>;
      return mutation;
    }

    /** A retry answers from its receipt before duplicate checks, ref resolution, or catalog calls. Item contexts have already been validated by their caller. */
    async function preflight(op: string, ctx: Ctx, item = false): Promise<TitleReceipt | null> {
      const parsed = item ? null : ctxSchema.safeParse(ctx);
      if (parsed && !parsed.success) return reject(issuesOf(parsed.error));
      const context = parsed?.success ? parsed.data : ctx;
      if (context.key === undefined) return null;
      return store.read((tx) => replayReceipt(tx, "title", op, context.key));
    }

    /**
     * `write` for a ctx already validated and given an item key by `itemCtx`
     * (the backlog form of `catalog.availability`, one transaction per title):
     * what `mutate` does after its own ctx check, which refuses item keys.
     */
    async function writeItem(op: string, ctx: Ctx, work: Work): Promise<TitleReceipt> {
      const meta: Meta = { warnings: [] };
      let receipt: Receipt<Title>;
      try {
        receipt = await store.transaction((tx) => applyIn(tx, clock, "title", op, ctx, (t, c, now) => workWithMeta(work, t, c, now, meta)));
      } catch (error) {
        if (error instanceof RejectedAfterWrites) receipt = error.receipt as Receipt<Title>;
        else if (error instanceof CascadeRejected) receipt = rejected<Title>(error.issues);
        else throw error;
      }
      return withRefCandidates(decorate(receipt, meta));
    }

    type Writer = typeof write;

    const reject = (issues: string[], extra: { needs?: Needs; candidates?: Candidate[] } = {}): TitleReceipt =>
      decorate(rejected<Title>(issues, extra.needs ? { needs: extra.needs } : {}), { warnings: [], ...(extra.candidates ? { candidates: extra.candidates } : {}) });

    // -------------------------------------------------------------- lookups

    /** A non-deleted title by ref within the scope, or the issues (and needs) that explain why not. */
    async function liveTitle(tx: Tx, ref: string, field = "title"): Promise<Lookup<Title>> {
      const parsedRef = titleRefSchema.safeParse(ref);
      if (!parsedRef.success) return { ok: false, issues: issuesOf(parsedRef.error).map((issue) => issue.replace(/^input:/, field === "title" ? "ref:" : `${field}:`)) };
      const found = await resolveTitle(tx, parsedRef.data, refOptions());
      if (found.ok) return { ok: true, record: found.title };
      const issues = field === "title" ? found.issues : found.issues.map((issue) => issue.replace(/^(title|ref):/, `${field}:`));
      if (found.kind === "ambiguous") return { ok: false, issues, needs: found.needs };
      if (found.kind === "deleted") return { ok: false, issues, id: found.title.id };
      return { ok: false, issues };
    }

    /** The same from a read, before a lookup or a write transaction. */
    const peek = (ref: string): Promise<Lookup<Title>> => store.read((tx) => liveTitle(tx, ref));

    /** The title a catalog operation addresses, read before its lookup; a ref that does not resolve is the rejection, candidates included. */
    async function findFirst(ref: string): Promise<{ ok: true; title: Title } | { ok: false; receipt: TitleReceipt }> {
      const found = await peek(ref);
      if (found.ok) return { ok: true, title: found.record };
      const receipt = decorate(rejected<Title>(found.issues, { ...(found.id !== undefined ? { id: found.id } : {}), ...(found.needs ? { needs: found.needs } : {}) }), { warnings: [] });
      return { ok: false, receipt: await withRefCandidates(receipt) };
    }

    // -------------------------------------------------------------- source failures as issues

    /** A failed lookup as the issues of a catalog operation: `catalog_unavailable:` for a source that could not answer (exit 3), `catalog:` otherwise. */
    function failureIssues(result: Extract<Resolution, { outcome: "failed" | "none" }>): string[] {
      if (result.outcome === "none") return [`catalog: ${result.message}`];
      if (result.failure === "unavailable" || result.failure === "budget") return [`${CATALOG_UNAVAILABLE}: ${result.message}`];
      return [`catalog: ${result.message}`];
    }

    /** The warning `add` carries when it created a title without a catalog. */
    function lookupWarning(result: Extract<Resolution, { outcome: "failed" | "none" }>, medium: Medium): string {
      const fix = `; run life ${medium} refresh <ref> once it is`;
      if (result.outcome === "none") return `Created without a catalog: ${result.message}`;
      if (result.failure === "unconfigured") return `Created without a catalog: ${result.message}${fix}`;
      return `Created without a catalog: ${result.message}; run life ${medium} refresh <ref> to link it later`;
    }

    /** The `needs` rejection for several candidates, with the candidates marked `inLibrary`. */
    async function candidatesRejection(result: Extract<Resolution, { outcome: "candidates" }>, medium: Medium): Promise<TitleReceipt> {
      const marked = markInLibrary(result.candidates, await store.read((tx) => tx.all("title")), medium);
      const needs: Needs = { field: "catalog", options: marked.map((candidate) => candidate.externalId), message: result.message };
      return reject([`catalog: ${result.message}`], { needs, candidates: marked });
    }

    // -------------------------------------------------------------- entries

    function buildEntry(type: EntryType, input: EntryInput, ctx: Ctx, now: string, format: BookFormat | null = null): Entry {
      return {
        id: `n_${randomSuffix()}`,
        type,
        on: input.on ?? { date: today(), precision: "day" },
        at: now,
        actor: ctx.actor,
        text: input.text ?? null,
        progress: input.progress ?? null,
        format: input.format ?? format,
        rating: input.rating ?? null,
        minutes: input.minutes ?? null,
        spend: input.spend ?? null,
        where: input.where ?? null,
        evidence: input.evidence ?? ctx.evidence ?? [],
      };
    }

    /** What each type needs on its input beyond the entry's own facet rules. */
    function requiredIssues(type: EntryType, input: EntryInput): string[] {
      if (type === "progress" && input.progress === undefined) return ["progress: Required (what he said about where he is)"];
      if (type === "note" && input.text === undefined) return ["text: Required (the note)"];
      if (type === "drop" && input.text === undefined) return ["text: Required (a drop needs its reason, which is also the review)"];
      if ((type === "borrow" || type === "service") && input.where === undefined) return [`where: Required (the ${type === "borrow" ? "lender" : "service"})`];
      return [];
    }

    /**
     * One entry appended to `title` after `allowed`, judged against the
     * title's current derived state (skipped for a closer that follows the
     * opener appended in the same call: legal by construction); the record
     * finalized; the warnings for a backdated entry and for progress or a note
     * on a title he is not on.
     */
    function appendEntry(title: Title, entry: Entry, input: EntryInput, now: string, meta: Meta, judge = true): Mutation<Title> {
      const verdict = judge ? allowed(entry.type, title.status, title.ownership) : { ok: true as const };
      if (!verdict.ok) return fail([`${verdict.issue}; ${verdict.hint}`], { id: title.id, record: title });
      const issues = entryIssues(entry);
      if (issues.length) return fail(issues, { id: title.id, record: title });
      const next = finalize({ ...title, entries: [...title.entries, entry], ...(input.liked !== undefined ? { liked: input.liked } : {}) });
      const backdated = backdatedWarning(next.entries, entry.id);
      if (backdated) meta.warnings.push(backdated);
      if ((entry.type === "progress" || entry.type === "note") && title.status !== "active") meta.warnings.push(`title is ${title.status}; use start if he is on it`);
      return okMutation("updated", title, bump(next, now));
    }

    async function entryOp(tx: Tx, ref: string, type: EntryType, input: EntryInput, ctx: Ctx, now: string, meta: Meta): Promise<Mutation<Title>> {
      const found = await liveTitle(tx, ref);
      if (!found.ok) return failed(found);
      const before = found.record;
      const mismatch = checkVersion(before, ctx);
      if (mismatch) return mismatch;
      const missing = requiredIssues(type, input);
      if (missing.length) return fail(missing, { id: before.id, record: before });
      return appendEntry(before, buildEntry(type, input, ctx, now), input, now, meta);
    }

    function entryMethod(type: EntryType): (ref: string, input: EntryInput, ctx: Ctx) => Promise<TitleReceipt> {
      return (ref, input, ctx) => {
        const parsed = entryInputSchema.safeParse(input ?? {});
        if (!parsed.success) return Promise.resolve(reject(issuesOf(parsed.error)));
        return write(`title.${type}`, ctx, (tx, c, now, meta) => entryOp(tx, ref, type, parsed.data, c, now, meta));
      };
    }

    async function againOp(tx: Tx, ref: string, input: EntryInput, ctx: Ctx, now: string, meta: Meta, opts: AgainOptions): Promise<Mutation<Title>> {
      const found = await liveTitle(tx, ref);
      if (!found.ok) return failed(found);
      const before = found.record;
      const mismatch = checkVersion(before, ctx);
      if (mismatch) return mismatch;
      if (!opts.finished) return appendEntry(before, buildEntry("again", input, ctx, now), input, now, meta);
      // A one-sitting rewatch: the opener takes the format and progress, the closer the rating, text, and minutes.
      const { rating: _rating, text: _text, minutes: _minutes, liked: _liked, ...opener } = input;
      const opened = appendEntry(before, buildEntry("again", opener, ctx, now), opener, now, meta);
      if (!opened.receipt.ok || !opened.after) return opened;
      const { progress: _progress, ...closer } = input;
      const closed = appendEntry(opened.after, buildEntry("finish", closer, ctx, now), closer, now, meta, false);
      if (!closed.receipt.ok || !closed.after) return closed;
      return okMutation("updated", before, { ...closed.after, version: before.version + 1 });
    }

    // -------------------------------------------------------------- finish and the series

    /** The pull for the next work when `queueNext` will create it: looked up before the transaction, never inside it. */
    async function prefetchNext(ref: string, opts: FinishOptions): Promise<Resolution | null> {
      if (!opts.queueNext) return null;
      const peeked = await store.read(async (tx) => {
        const found = await liveTitle(tx, ref);
        return found.ok ? { owner: found.record, next: nextOf(found.record, await tx.all("title")) } : null;
      });
      if (!peeked?.next || peeked.next.title !== null || peeked.next.seriesEntry.externalId === null) return null;
      return resolve(peeked.owner.medium, peeked.next.seriesEntry.name, { ...lookupOptions, externalId: peeked.next.seriesEntry.externalId });
    }

    /** The next work as a `backlog` title created through applyIn under `itemCtx(ctx, 1)`, with the pull's facts when the lookup succeeded. */
    async function queueNext(tx: Tx, ctx: Ctx, now: string, meta: Meta, owner: Title, next: NextView, pull: Resolution | null): Promise<Title> {
      const entry = next.seriesEntry;
      const context = itemCtx({ ...ctx, evidence: [...(ctx.evidence ?? []), `series:${owner.id}`] }, 1);
      const linked = pull?.outcome === "linked" ? pull : null;
      const source = linked?.source ?? owner.catalog?.source ?? null;
      if (pull && pull.outcome !== "linked") meta.warnings.push(`Queued "${entry.name}" without catalog facts: ${pull.message}; run life ${owner.medium} refresh once it is reachable`);
      const created = must(
        await applyIn(tx, clock, "title", "title.add", context, async (_tx, c, at) => {
          const base: Title = {
            id: newId("title"),
            medium: owner.medium,
            name: linked?.detail.name ?? entry.name,
            aliases: [],
            year: linked?.detail.year ?? (entry.released ? Number(entry.released.slice(0, 4)) || null : null),
            creators: linked ? [...linked.detail.creators] : [],
            cover: linked?.detail.cover ?? null,
            length: linked?.detail.length ?? null,
            facts: linked ? { ...linked.detail.facts, availability: linked.availability } : null,
            catalog: entry.externalId !== null && source !== null ? { source, externalId: entry.externalId, pulledAt: at } : null,
            edited: [],
            series: owner.series ? { name: owner.series.name, position: entry.position } : null,
            status: "curious",
            ownership: "none",
            ownershipDetail: null,
            priority: null,
            moodFit: [],
            timeFit: null,
            notes: null,
            detail: { format: null, platform: null, where: null },
            rating: null,
            review: null,
            liked: false,
            entries: [],
            origin: originOf(c, at),
            version: 1,
            createdAt: at,
            updatedAt: at,
            deletedAt: null,
          };
          const record = finalize({ ...base, entries: [buildEntry("want", {}, c, at)] });
          return okMutation("created", null, record);
        }),
        `next in series`,
      );
      meta.warnings.push(`Queued "${created.name}" as ${created.id} (backlog)`);
      return created;
    }

    async function finishOp(tx: Tx, ref: string, input: EntryInput, ctx: Ctx, now: string, meta: Meta, opts: FinishOptions, pull: Resolution | null): Promise<Mutation<Title>> {
      const found = await liveTitle(tx, ref);
      if (!found.ok) return failed(found);
      const before = found.record;
      const mismatch = checkVersion(before, ctx);
      if (mismatch) return mismatch;
      const finished = appendEntry(before, buildEntry("finish", input, ctx, now), input, now, meta);
      if (!finished.receipt.ok || !finished.after) return finished;
      const after = finished.after;
      const titles = (await tx.all("title")).map((title) => (title.id === after.id ? after : title));
      const next = nextOf(after, titles);
      if (!next) {
        if (opts.queueNext) meta.warnings.push(`queueNext: "${after.name}" is not in a series, or is its last entry; nothing queued`);
        return finished;
      }
      const series = seriesOf(after, titles);
      meta.next = { externalId: next.seriesEntry.externalId, name: next.seriesEntry.name, position: next.seriesEntry.position, titleId: next.title?.id ?? null };
      meta.warnings.push(`Next in ${series?.name ?? "the series"}: "${next.seriesEntry.name}"${next.title ? ` (in the library as ${next.title.id}, ${next.title.status})` : ""}`);
      if (opts.queueNext) {
        if (next.title) meta.warnings.push(`queueNext: "${next.title.name}" is already in the library as ${next.title.id}; nothing queued`);
        else meta.next.titleId = (await queueNext(tx, ctx, now, meta, after, next, pull)).id;
      }
      return finished;
    }

    // -------------------------------------------------------------- add

    /** The pull for `add`: the given id, the lookup by name, or nothing; a failure is a warning, except a refused id, which is a rejection. */
    async function pullForAdd(input: TitleAdd, warnings: string[]): Promise<{ ok: true; pull: CatalogPull | null } | { ok: false; receipt: TitleReceipt }> {
      if (input.catalog !== undefined) {
        const result = await resolve(input.medium, input.name, { ...lookupOptions, externalId: input.catalog });
        if (result.outcome === "linked") return { ok: true, pull: result };
        if (result.outcome === "failed" && result.failure === "refused") return { ok: false, receipt: reject([`catalog: ${result.message}`]) };
        if (result.outcome === "failed") warnings.push(lookupWarning(result, input.medium));
        return { ok: true, pull: null };
      }
      if (input.lookup === false) return { ok: true, pull: null };
      const result = await resolve(input.medium, input.name, { ...lookupOptions, ...(input.year !== undefined ? { year: input.year } : {}) });
      if (result.outcome === "linked") return { ok: true, pull: result };
      if (result.outcome === "candidates") return { ok: false, receipt: await candidatesRejection(result, input.medium) };
      warnings.push(lookupWarning(result, input.medium));
      return { ok: true, pull: null };
    }

    const asInput = (value: EntryInput | true | undefined): EntryInput | null => (value === undefined ? null : value === true ? {} : value);

    /** The diary an `add` composes: seenBefore's finish, want, start (an `again` after seenBefore), finish. Legal by construction, so `allowed` is not applied. */
    function composeEntries(input: TitleAdd, ctx: Ctx, now: string): Entry[] {
      const entries: Entry[] = [];
      const format = input.medium === "book" ? (input.detail?.format ?? null) : null;
      if (input.seenBefore !== undefined) {
        const on = input.seenBefore === true ? { date: null, precision: "unknown" as const } : input.seenBefore;
        entries.push(buildEntry("finish", { on }, ctx, now));
      }
      if (input.want) entries.push(buildEntry("want", {}, ctx, now));
      const started = asInput(input.started);
      if (started) entries.push(buildEntry(input.seenBefore !== undefined ? "again" : "start", started, ctx, now, format));
      const finished = asInput(input.finished);
      if (finished) entries.push(buildEntry("finish", finished, ctx, now, format));
      return entries;
    }

    async function addTitle(tx: Tx, input: TitleAdd, ctx: Ctx, now: string, meta: Meta, pull: CatalogPull | null, warnings: string[]): Promise<Mutation<Title>> {
      meta.warnings.push(...warnings);
      const titles = await tx.all("title");
      if (pull) {
        const other = linkedElsewhere(titles, input.medium, pull.source, pull.externalId);
        if (other) return duplicateMutation([other], [`${other.id} ("${other.name}") is already linked to ${pull.source} ${pull.externalId}; use it, or merge`]);
      }
      if (!input.allowDuplicate) {
        const dups = findDuplicateTitles(input.name, titles, input.medium);
        if (dups.length) return duplicateMutation(dups, [`A ${input.medium} named "${input.name}" exists (${dups.map((t) => t.id).join(", ")}); pass allowDuplicate to add anyway`]);
      }
      const entries = composeEntries(input, ctx, now);
      for (const entry of entries) {
        const issues = entryIssues(entry);
        if (issues.length) return fail(issues.map((issue) => `${entry.type}: ${issue}`));
      }
      const bare: Title = {
        id: newId("title"),
        medium: input.medium,
        name: input.name,
        aliases: [],
        year: input.year ?? null,
        creators: [],
        cover: null,
        length: null,
        facts: null,
        catalog: null,
        edited: [],
        series: null,
        status: "curious",
        ownership: "none",
        ownershipDetail: null,
        priority: input.priority ?? null,
        moodFit: input.moodFit ?? [],
        timeFit: input.timeFit ?? null,
        notes: input.notes ?? null,
        detail: detailOf(input.detail),
        rating: null,
        review: null,
        liked: input.liked ?? false,
        entries,
        origin: originOf(ctx, now),
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      const record = finalize(pull ? applyPull(bare, pull, now) : bare);
      for (const entry of entries) {
        const backdated = backdatedWarning(record.entries, entry.id);
        if (backdated) meta.warnings.push(backdated);
      }
      return okMutation("created", null, record);
    }

    async function add(input: TitleAdd, ctx: Ctx): Promise<TitleReceipt> {
      const parsed = titleAddSchema.safeParse(input);
      if (!parsed.success) return reject(issuesOf(parsed.error));
      const parsedCtx = ctxSchema.safeParse(ctx);
      if (!parsedCtx.success) return reject(issuesOf(parsedCtx.error));
      const value = parsed.data;
      const detail = detailIssues(value.medium, value.detail);
      if (detail.length) return reject(detail);
      const replay = await preflight("title.add", parsedCtx.data);
      if (replay) return replay;
      // (1) The name duplicate check in a read, before any lookup is spent.
      if (!value.allowDuplicate) {
        const dups = await store.read(async (tx) => findDuplicateTitles(value.name, await tx.all("title"), value.medium));
        if (dups.length) {
          // Another call with this key may have committed between the first replay read and this duplicate snapshot.
          const replay = await preflight("title.add", parsedCtx.data);
          if (replay) return replay;
          return decorate(duplicateMutation(dups, [`A ${value.medium} named "${value.name}" exists (${dups.map((t) => t.id).join(", ")}); pass allowDuplicate to add anyway`]).receipt, { warnings: [] });
        }
      }
      // (2) The lookup, outside any transaction.
      const warnings: string[] = [];
      const pulled = await pullForAdd(value, warnings);
      if (!pulled.ok) return pulled.receipt;
      // (3) The write.
      return write("title.add", ctx, (tx, c, now, meta) => addTitle(tx, value, c, now, meta, pulled.pull, warnings));
    }

    // -------------------------------------------------------------- update

    async function updateTitle(tx: Tx, ref: string, input: TitleUpdate, ctx: Ctx, now: string): Promise<Mutation<Title>> {
      const found = await liveTitle(tx, ref);
      if (!found.ok) return failed(found);
      const before = found.record;
      const mismatch = checkVersion(before, ctx);
      if (mismatch) return mismatch;
      const detail = detailIssues(before.medium, input.detail);
      if (detail.length) return fail(detail, { id: before.id, record: before });
      const next: Title = { ...before };
      if (input.name !== undefined) next.name = input.name;
      if (input.aliases !== undefined) next.aliases = withAliases(next.name, [], input.aliases);
      if (input.year !== undefined) next.year = input.year;
      if (input.creators !== undefined) next.creators = input.creators;
      if (input.cover !== undefined) next.cover = input.cover;
      if (input.length !== undefined) next.length = input.length;
      if (input.series !== undefined) next.series = input.series;
      if (input.priority !== undefined) next.priority = input.priority;
      if (input.moodFit !== undefined) next.moodFit = [...new Set(input.moodFit)];
      if (input.timeFit !== undefined) next.timeFit = input.timeFit;
      if (input.notes !== undefined) next.notes = input.notes;
      if (input.detail !== undefined) {
        next.detail = {
          format: input.detail.format !== undefined ? input.detail.format : before.detail.format,
          platform: input.detail.platform !== undefined ? input.detail.platform : before.detail.platform,
          where: input.detail.where !== undefined ? input.detail.where : before.detail.where,
        };
      }
      // A factual field Neel changed by hand stays his, linked or not (D93).
      const changed = diff(before, next);
      const edited = new Set<EditedField>(before.edited);
      for (const field of ["name", "year", "creators", "cover", "length"] as const) if (field in changed) edited.add(field);
      next.edited = [...edited];
      return updatedOrUnchanged(before, next, now);
    }

    // -------------------------------------------------------------- corrections

    async function amendEntry(tx: Tx, ref: string, entryId: string, patch: EntryPatch, ctx: Ctx, now: string): Promise<Mutation<Title>> {
      const found = await liveTitle(tx, ref);
      if (!found.ok) return failed(found);
      const before = found.record;
      const mismatch = checkVersion(before, ctx);
      if (mismatch) return mismatch;
      const entry = before.entries.find((e) => e.id === entryId);
      if (!entry) return fail([`entry: no entry "${entryId}" on ${before.id}; see get or history for its ids`], { id: before.id, record: before });
      const amended: Entry = { ...entry };
      for (const [key, value] of Object.entries(patch)) if (value !== undefined) (amended as unknown as Record<string, unknown>)[key] = value;
      const issues = entryIssues(amended);
      if (issues.length) return fail(issues, { id: before.id, record: before });
      return updatedOrUnchanged(before, { ...before, entries: before.entries.map((e) => (e.id === entryId ? amended : e)) }, now);
    }

    async function unlogEntry(tx: Tx, ref: string, entryId: string, ctx: Ctx, now: string, meta: Meta): Promise<Mutation<Title>> {
      const found = await liveTitle(tx, ref);
      if (!found.ok) return failed(found);
      const before = found.record;
      const mismatch = checkVersion(before, ctx);
      if (mismatch) return mismatch;
      const entry = before.entries.find((e) => e.id === entryId);
      if (!entry) return fail([`entry: no entry "${entryId}" on ${before.id}; see get or history for its ids`], { id: before.id, record: before });
      meta.removed = entry;
      return okMutation("updated", before, bump(finalize({ ...before, entries: before.entries.filter((e) => e.id !== entryId) }), now));
    }

    async function relogEntry(tx: Tx, ref: string, entryId: string, into: string, ctx: Ctx, now: string, meta: Meta): Promise<Mutation<Title>> {
      const found = await liveTitle(tx, ref);
      if (!found.ok) return failed(found);
      const before = found.record;
      const mismatch = checkVersion(before, ctx);
      if (mismatch) return mismatch;
      const target = await liveTitle(tx, into, "into");
      if (!target.ok) return failed({ ...target, id: before.id });
      const dest = target.record;
      if (dest.id === before.id) return fail([`into: "${into}" is the same title; use amend to change the entry`], { id: before.id, record: before });
      if (dest.medium !== before.medium) return fail([`into: "${dest.name}" is a ${dest.medium}, not a ${before.medium}`], { id: before.id, record: before });
      const entry = before.entries.find((e) => e.id === entryId);
      if (!entry) return fail([`entry: no entry "${entryId}" on ${before.id}; see get or history for its ids`], { id: before.id, record: before });
      if (dest.entries.some((e) => e.id === entryId)) return fail([`entry: ${entryId} already exists on ${dest.id}`], { id: before.id, record: before });
      const moved = must(
        await applyIn(tx, clock, "title", "title.relog", cascadeCtx(ctx), async (_tx, _ctx, at) =>
          okMutation("updated", dest, bump(finalize({ ...dest, entries: [...dest.entries, entry] }), at)),
        ),
        `title ${dest.id}`,
      );
      const backdated = backdatedWarning(moved.entries, entry.id);
      if (backdated) meta.warnings.push(`${moved.name} (${moved.id}): ${backdated}`);
      meta.warnings.push(`Moved ${entry.type} ${entry.id} to ${moved.name} (${moved.id}), now ${moved.status}`);
      return okMutation("updated", before, bump(finalize({ ...before, entries: before.entries.filter((e) => e.id !== entryId) }), now));
    }

    // -------------------------------------------------------------- the take

    /** The entry `rate`, `unrate`, and `review` address: the named one (a closer), else the last closing entry. */
    function takeTarget(title: Title, opts: EntryTarget, what: string): Lookup<Entry> {
      if (opts.entry !== undefined) {
        const entry = title.entries.find((e) => e.id === opts.entry);
        if (!entry) return { ok: false, issues: [`entry: no entry "${opts.entry}" on ${title.id}; see get or history for its ids`], id: title.id };
        if (!CLOSERS.has(entry.type)) return { ok: false, issues: [`entry: ${entry.id} is a ${entry.type}; only a finish or drop carries a ${what}`], id: title.id };
        return { ok: true, record: entry };
      }
      const last = lastClosing(title.entries);
      if (!last) return { ok: false, issues: [`${what}: nothing to ${what === "rating" ? "rate" : "review"}; finish or drop first`], id: title.id };
      return { ok: true, record: last };
    }

    async function takeOp(tx: Tx, ref: string, ctx: Ctx, now: string, opts: EntryTarget, what: string, change: (entry: Entry) => Entry): Promise<Mutation<Title>> {
      const found = await liveTitle(tx, ref);
      if (!found.ok) return failed(found);
      const before = found.record;
      const mismatch = checkVersion(before, ctx);
      if (mismatch) return mismatch;
      const target = takeTarget(before, opts, what);
      if (!target.ok) return fail(target.issues, { id: before.id, record: before });
      const changed = change(target.record);
      const issues = entryIssues(changed);
      if (issues.length) return fail(issues, { id: before.id, record: before });
      return updatedOrUnchanged(before, { ...before, entries: before.entries.map((e) => (e.id === changed.id ? changed : e)) }, now);
    }

    async function likeOp(tx: Tx, ref: string, liked: boolean, ctx: Ctx, now: string): Promise<Mutation<Title>> {
      const found = await liveTitle(tx, ref);
      if (!found.ok) return failed(found);
      const before = found.record;
      const mismatch = checkVersion(before, ctx);
      if (mismatch) return mismatch;
      return updatedOrUnchanged(before, { ...before, liked }, now);
    }

    // -------------------------------------------------------------- catalog

    /** A pull written onto a title: `updated` when anything but `pulledAt` moved; else `unchanged`, with `pulledAt` stamped by `tx.put` alone (no log, no version bump). */
    async function writePull(tx: Tx, before: Title, pull: CatalogPull, now: string): Promise<Mutation<Title>> {
      const next = finalize(applyPull(before, pull, now));
      if (pullChanged(before, next)) return okMutation("updated", before, bump(next, now));
      const stamped: Title = { ...before, catalog: { ...next.catalog!, pulledAt: now } };
      await tx.put("title", stamped);
      return okMutation("unchanged", before, stamped);
    }

    async function linkOp(tx: Tx, ref: string, ctx: Ctx, now: string, pull: CatalogPull): Promise<Mutation<Title>> {
      const found = await liveTitle(tx, ref);
      if (!found.ok) return failed(found);
      const before = found.record;
      const mismatch = checkVersion(before, ctx);
      if (mismatch) return mismatch;
      const other = linkedElsewhere(await tx.all("title"), before.medium, pull.source, pull.externalId, before.id);
      if (other) return fail([`catalog: ${pull.source} ${pull.externalId} is already linked to ${other.id} ("${other.name}"); merge them, or pick another id`], { id: before.id, record: before });
      return writePull(tx, before, pull, now);
    }

    /** `link`: the pull by id before the transaction, then the write. */
    async function link(ref: string, externalId: string, ctx: Ctx): Promise<TitleReceipt> {
      const id = externalId.trim();
      if (!id) return reject(["externalId: Required"]);
      const replay = await preflight("title.link", ctx);
      if (replay) return replay;
      const first = await findFirst(ref);
      if (!first.ok) return first.receipt;
      const result = await resolve(first.title.medium, first.title.name, { ...lookupOptions, externalId: id });
      if (result.outcome !== "linked") return reject(result.outcome === "candidates" ? [`catalog: ${result.message}`] : failureIssues(result));
      return write("title.link", ctx, (tx, c, now) => linkOp(tx, ref, c, now, result));
    }

    async function unlinkOp(tx: Tx, ref: string, ctx: Ctx, now: string): Promise<Mutation<Title>> {
      const found = await liveTitle(tx, ref);
      if (!found.ok) return failed(found);
      const before = found.record;
      const mismatch = checkVersion(before, ctx);
      if (mismatch) return mismatch;
      return updatedOrUnchanged(before, { ...before, catalog: null, facts: null }, now);
    }

    /** `refresh`: re-pull a linked title; run the whole lookup for one without a catalog, with `add`'s `needs` path. */
    async function refresh(ref: string, ctx: Ctx): Promise<TitleReceipt> {
      const replay = await preflight("title.refresh", ctx);
      if (replay) return replay;
      const first = await findFirst(ref);
      if (!first.ok) return first.receipt;
      const title = first.title;
      const result = title.catalog
        ? await resolve(title.medium, title.name, { ...lookupOptions, externalId: title.catalog.externalId })
        : await resolve(title.medium, title.name, { ...lookupOptions, ...(title.year !== null ? { year: title.year } : {}) });
      if (result.outcome === "candidates") return candidatesRejection(result, title.medium);
      if (result.outcome !== "linked") return reject(failureIssues(result));
      return write("title.refresh", ctx, (tx, c, now) => linkOp(tx, ref, c, now, result));
    }

    async function availabilityOp(tx: Tx, ref: string, ctx: Ctx, now: string, rows: Availability[]): Promise<Mutation<Title>> {
      const found = await liveTitle(tx, ref);
      if (!found.ok) return failed(found);
      const before = found.record;
      const mismatch = checkVersion(before, ctx);
      if (mismatch) return mismatch;
      if (!before.catalog || !before.facts) return fail([`catalog: "${before.name}" has no catalog; run refresh first`], { id: before.id, record: before });
      const next: Title = { ...before, facts: { ...before.facts, availability: rows } };
      if (pullChanged(before, next)) return okMutation("updated", before, bump(finalize({ ...next, catalog: { ...before.catalog, pulledAt: now } }), now));
      const stamped: Title = { ...before, catalog: { ...before.catalog, pulledAt: now } };
      await tx.put("title", stamped);
      return okMutation("unchanged", before, stamped);
    }

    async function availabilityOne(ref: string, ctx: Ctx, writer: Writer = write): Promise<TitleReceipt> {
      const replay = await preflight("title.availability", ctx, writer === writeItem);
      if (replay) return replay;
      const first = await findFirst(ref);
      if (!first.ok) return first.receipt;
      const title = first.title;
      if (!title.catalog) return reject([`catalog: "${title.name}" has no catalog; run refresh first`]);
      const result = await resolveAvailability(title.medium, title.catalog.externalId, lookupOptions);
      if (result.outcome !== "ok") return reject(failureIssues(result));
      return writer("title.availability", ctx, (tx, c, now) => availabilityOp(tx, ref, c, now, result.availability));
    }

    /** Every backlog title with a catalog, one transaction each under `itemCtx(ctx, index)`, so a failure stops nothing else. */
    async function availabilityBacklog(scopeInput: AvailabilityScope, ctx: Ctx): Promise<AvailabilityReport> {
      const parsedCtx = ctxSchema.safeParse(ctx);
      const medium = scopeInput.medium ?? scope;
      const backlog = await store.read(async (tx) =>
        sortTitles((await tx.all("title")).filter((title) => title.status === "backlog" && title.catalog !== null && (medium === undefined || title.medium === medium))),
      );
      const report: AvailabilityReport = { refreshed: [], failed: [] };
      for (const [index, title] of backlog.entries()) {
        const receipt = parsedCtx.success ? await availabilityOne(title.id, itemCtx(parsedCtx.data, index), writeItem) : reject(issuesOf(parsedCtx.error));
        if (receipt.ok) report.refreshed.push({ id: title.id, name: title.name, outcome: receipt.outcome === "updated" ? "updated" : "unchanged" });
        else report.failed.push({ id: title.id, name: title.name, issues: receipt.issues });
      }
      return report;
    }

    async function search(medium: Medium, text: string, opts: SearchOptions = {}): Promise<SearchCandidate[]> {
      const parsed = searchOptionsSchema.safeParse(opts);
      if (!parsed.success) throw new Error(`search: ${issuesOf(parsed.error).join("; ")}`);
      const adapter = catalogFor(deps.catalogs, medium);
      const budget = new Budget(budgetMs, timer);
      try {
        const signal = budget.signal;
        const found = await adapter.search(medium, text, { ...(parsed.data.year !== undefined ? { year: parsed.data.year } : {}), signal });
        const candidates: SearchCandidate[] = markInLibrary(found, await store.read((tx) => tx.all("title")), medium);
        if (parsed.data.availability && candidates.length) {
          const verdict = judge(candidates, text, parsed.data.year);
          const targets = verdict.ok ? candidates.filter((c) => c.externalId === verdict.candidate.externalId) : candidates.slice(0, 3);
          for (const target of targets) target.availability = await adapter.availability(medium, target.externalId, region, { signal });
        }
        return candidates;
      } finally {
        budget.release();
      }
    }

    // -------------------------------------------------------------- merge, delete, restore

    async function mergeOp(tx: Tx, ref: string, into: string, ctx: Ctx, now: string, meta: Meta): Promise<Mutation<Title>> {
      const source = await liveTitle(tx, ref);
      if (!source.ok) return failed(source);
      const from = source.record;
      const target = await liveTitle(tx, into, "into");
      if (!target.ok) return failed({ ...target, id: from.id });
      const dest = target.record;
      if (dest.id === from.id) return fail([`into: "${into}" is the same title`], { id: from.id, record: from });
      if (dest.medium !== from.medium) return fail([`into: "${dest.name}" is a ${dest.medium}, not a ${from.medium}`], { id: from.id, record: from });
      const mismatch = checkVersion(dest, ctx);
      if (mismatch) return mismatch;
      const clash = from.entries.find((entry) => dest.entries.some((e) => e.id === entry.id));
      if (clash) return fail([`entry: ${clash.id} exists on both titles; unlog one first`], { id: dest.id, record: dest });
      const note = `merged into ${dest.id}`;
      must(
        await applyIn(tx, clock, "title", "title.merge", cascadeCtx(ctx), async (_tx, _ctx, at) =>
          okMutation("updated", from, bump(finalize({ ...from, notes: from.notes ? `${from.notes}\n\n${note}` : note, deletedAt: at }), at)),
        ),
        `title ${from.id}`,
      );
      meta.warnings.push(`Merged ${from.name} (${from.id}) into ${dest.name} (${dest.id}); ${from.id} is in the trash`);
      const merged: Title = {
        ...dest,
        aliases: withAliases(dest.name, dest.aliases, [from.name, ...from.aliases]),
        moodFit: [...new Set([...dest.moodFit, ...from.moodFit])],
        entries: [...dest.entries, ...from.entries],
      };
      return okMutation("updated", dest, bump(finalize(merged), now));
    }

    async function deleteOp(tx: Tx, ref: string, ctx: Ctx, now: string): Promise<Mutation<Title>> {
      const value = ref.trim();
      if (isTitleId(value)) {
        const already = await tx.get("title", value);
        if (already?.deletedAt) return okMutation("unchanged", already, already);
      }
      const found = await liveTitle(tx, ref);
      if (!found.ok) return failed(found);
      const before = found.record;
      const mismatch = checkVersion(before, ctx);
      if (mismatch) return mismatch;
      return okMutation("updated", before, bump(finalize({ ...before, deletedAt: now }), now));
    }

    async function restoreOp(tx: Tx, id: string, ctx: Ctx, now: string): Promise<Mutation<Title>> {
      const value = id.trim();
      if (!isTitleId(value)) return fail([`title: no title "${id}"; restore takes the id (see life trash)`]);
      const found = await resolveTitle(tx, value, refOptions({ includeDeleted: true }));
      if (!found.ok) return failed({ issues: found.issues });
      const before = found.title;
      const mismatch = checkVersion(before, ctx);
      if (mismatch) return mismatch;
      if (!before.deletedAt) return okMutation("unchanged", before, before);
      return okMutation("updated", before, bump(finalize({ ...before, deletedAt: null }), now));
    }

    // -------------------------------------------------------------- reads

    async function get(ref: string): Promise<Title | null> {
      const value = ref.trim();
      if (!value) return null;
      return store.read(async (tx) => {
        const found = await resolveTitle(tx, value, refOptions({ includeDeleted: true }));
        if (found.ok) return found.title;
        if (found.kind === "ambiguous") throw new Error(`get: ${found.issues.join("; ")}`);
        return null;
      });
    }

    async function list(criteria: TitleList): Promise<TitleSummary[] | Title[]> {
      const parsed = titleListSchema.safeParse(criteria);
      if (!parsed.success) throw new Error(`list: ${issuesOf(parsed.error).join("; ")}`);
      const q = parsed.data;
      const medium = q.medium ?? scope;
      const statuses = new Set<Progress>(q.status ?? STATUS_ORDER.filter((status) => status !== "dropped"));
      const ownerships = q.ownership ? new Set<Ownership>(q.ownership) : null;
      const needle = q.text?.toLowerCase();
      return store.read(async (tx) => {
        const titles = (await tx.all("title", { includeDeleted: q.includeDeleted })).filter((title) => {
          if (medium !== undefined && title.medium !== medium) return false;
          if (!statuses.has(title.status)) return false;
          if (ownerships && !ownerships.has(title.ownership)) return false;
          if (q.priority !== undefined && title.priority !== q.priority) return false;
          if (q.moodFit !== undefined && !title.moodFit.includes(q.moodFit)) return false;
          if (q.timeFit !== undefined && title.timeFit !== q.timeFit) return false;
          if (q.format !== undefined && title.detail.format !== q.format) return false;
          if (needle !== undefined && ![title.name, ...title.aliases, ...title.creators].some((text) => text.toLowerCase().includes(needle))) return false;
          return true;
        });
        const sorted = sortTitles(titles);
        return q.full ? sorted : sorted.map(summarize);
      });
    }

    async function where(ref: WhereRef): Promise<Availability[]> {
      if (typeof ref !== "string") {
        const adapter = catalogFor(deps.catalogs, ref.medium);
        const budget = new Budget(budgetMs, timer);
        try {
          return await adapter.availability(ref.medium, ref.catalog, region, { signal: budget.signal });
        } finally {
          budget.release();
        }
      }
      const title = await get(ref);
      if (!title) throw new Error(`where: no ${scope ?? "title"} "${ref}"`);
      return title.facts?.availability ?? [];
    }

    async function readSeries<T>(ref: string, pick: (title: Title, titles: Title[]) => T): Promise<T | null> {
      return store.read(async (tx) => {
        const found = await resolveTitle(tx, ref, refOptions({ includeDeleted: true }));
        if (!found.ok) return null;
        return pick(found.title, await tx.all("title"));
      });
    }

    // -------------------------------------------------------------- the ops object

    const withParsedInput = (op: string, ref: string, input: EntryInput, ctx: Ctx, run: (parsed: EntryInput, tx: Tx, c: Ctx, now: string, meta: Meta) => Promise<Mutation<Title>>): Promise<TitleReceipt> => {
      const parsed = entryInputSchema.safeParse(input ?? {});
      if (!parsed.success) return Promise.resolve(reject(issuesOf(parsed.error)));
      return write(op, ctx, (tx, c, now, meta) => run(parsed.data, tx, c, now, meta));
    };

    return {
      add,
      get,
      resolve: (ref, opts = {}) => store.read((tx) => resolveTitle(tx, ref, { ...refOptions(), ...opts })),
      list: (criteria = {}) => list(criteria),
      update(ref, input, ctx) {
        const parsed = titleUpdateSchema.safeParse(input);
        if (!parsed.success) return Promise.resolve(reject(issuesOf(parsed.error)));
        return write("title.update", ctx, (tx, c, now) => updateTitle(tx, ref, parsed.data, c, now));
      },
      want: entryMethod("want"),
      start: entryMethod("start"),
      resume: entryMethod("resume"),
      pause: entryMethod("pause"),
      progress: entryMethod("progress"),
      note: entryMethod("note"),
      buy: entryMethod("buy"),
      borrow: entryMethod("borrow"),
      return: entryMethod("return"),
      service: entryMethod("service"),
      again(ref, input, ctx, opts = {}) {
        const parsedOpts = againOptionsSchema.safeParse(opts);
        if (!parsedOpts.success) return Promise.resolve(reject(issuesOf(parsedOpts.error)));
        return withParsedInput("title.again", ref, input, ctx, (parsed, tx, c, now, meta) => againOp(tx, ref, parsed, c, now, meta, parsedOpts.data));
      },
      async finish(ref, input, ctx, opts = {}) {
        const parsedOpts = finishOptionsSchema.safeParse(opts);
        if (!parsedOpts.success) return reject(issuesOf(parsedOpts.error));
        const parsed = entryInputSchema.safeParse(input ?? {});
        if (!parsed.success) return reject(issuesOf(parsed.error));
        const replay = await preflight("title.finish", ctx);
        if (replay) return replay;
        const pull = await prefetchNext(ref, parsedOpts.data);
        return write("title.finish", ctx, (tx, c, now, meta) => finishOp(tx, ref, parsed.data, c, now, meta, parsedOpts.data, pull));
      },
      drop: entryMethod("drop"),
      amend(ref, entryId, patch, ctx) {
        if (!isEntryId(entryId)) return Promise.resolve(reject([`entry: "${entryId}" is not an entry id (n_ plus ten characters)`]));
        const parsed = entryPatchSchema.safeParse(patch);
        if (!parsed.success) return Promise.resolve(reject(issuesOf(parsed.error)));
        return write("title.amend", ctx, (tx, c, now) => amendEntry(tx, ref, entryId, parsed.data, c, now));
      },
      unlog(ref, entryId, ctx) {
        if (!isEntryId(entryId)) return Promise.resolve(reject([`entry: "${entryId}" is not an entry id (n_ plus ten characters)`]));
        return write("title.unlog", ctx, (tx, c, now, meta) => unlogEntry(tx, ref, entryId, c, now, meta));
      },
      relog(ref, entryId, into, ctx) {
        if (!isEntryId(entryId)) return Promise.resolve(reject([`entry: "${entryId}" is not an entry id (n_ plus ten characters)`]));
        return write("title.relog", ctx, (tx, c, now, meta) => relogEntry(tx, ref, entryId, into, c, now, meta));
      },
      rate(ref, rating, ctx, opts = {}) {
        const parsedRating = ratingSchema.safeParse(rating);
        if (!parsedRating.success) return Promise.resolve(reject(issuesOf(parsedRating.error).map((issue) => issue.replace(/^input:/, "rating:"))));
        const parsedOpts = entryTargetSchema.safeParse(opts);
        if (!parsedOpts.success) return Promise.resolve(reject(issuesOf(parsedOpts.error)));
        return write("title.rate", ctx, (tx, c, now) => takeOp(tx, ref, c, now, parsedOpts.data, "rating", (entry) => ({ ...entry, rating: parsedRating.data })));
      },
      unrate(ref, ctx, opts = {}) {
        const parsedOpts = entryTargetSchema.safeParse(opts);
        if (!parsedOpts.success) return Promise.resolve(reject(issuesOf(parsedOpts.error)));
        return write("title.unrate", ctx, (tx, c, now) => takeOp(tx, ref, c, now, parsedOpts.data, "rating", (entry) => ({ ...entry, rating: null })));
      },
      review(ref, text, ctx, opts = {}) {
        const parsedText = reviewTextSchema.safeParse(text);
        if (!parsedText.success) return Promise.resolve(reject(issuesOf(parsedText.error).map((issue) => issue.replace(/^input:/, "text:"))));
        const parsedOpts = entryTargetSchema.safeParse(opts);
        if (!parsedOpts.success) return Promise.resolve(reject(issuesOf(parsedOpts.error)));
        return write("title.review", ctx, (tx, c, now) => takeOp(tx, ref, c, now, parsedOpts.data, "review", (entry) => ({ ...entry, text: parsedText.data })));
      },
      like: (ref, ctx) => write("title.like", ctx, (tx, c, now) => likeOp(tx, ref, true, c, now)),
      unlike: (ref, ctx) => write("title.unlike", ctx, (tx, c, now) => likeOp(tx, ref, false, c, now)),
      catalog: {
        search,
        link,
        unlink: (ref, ctx) => write("title.unlink", ctx, (tx, c, now) => unlinkOp(tx, ref, c, now)),
        refresh,
        availability: ((target: string | AvailabilityScope, ctx: Ctx) => {
          if (typeof target === "string") return availabilityOne(target, ctx);
          const parsed = availabilityScopeSchema.safeParse(target);
          if (!parsed.success) return Promise.reject(new Error(`availability: ${issuesOf(parsed.error).join("; ")}`));
          return availabilityBacklog(parsed.data, ctx);
        }) as CatalogOps["availability"],
      },
      where,
      next: (ref) => readSeries(ref, nextOf),
      series: (ref) => readSeries(ref, seriesOf),
      merge: (ref, into, ctx) => write("title.merge", ctx, (tx, c, now, meta) => mergeOp(tx, ref, into, c, now, meta)),
      delete: (ref, ctx) => write("title.delete", ctx, (tx, c, now) => deleteOp(tx, ref, c, now)),
      restore: (id, ctx) => write("title.restore", ctx, (tx, c, now) => restoreOp(tx, id, c, now)),
      async history(ref) {
        const value = ref.trim();
        if (isTitleId(value)) return store.read((tx) => tx.history("title", value));
        const found = await peek(value);
        return found.ok ? store.read((tx) => tx.history("title", found.record.id)) : [];
      },
      scoped: (medium) => build(medium),
    };
  }
}
