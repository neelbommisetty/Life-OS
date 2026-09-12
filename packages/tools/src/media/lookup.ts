// Catalog lookup and reference resolution for the library (LEISURE D71, D93,
// D94). Two normalizations: `normalizeTitle` (from tasks.ts, unchanged) is the
// duplicate check's, `normalizeLookup` (punctuation and a leading article gone
// too) is the confidence rule's. The confidence rule says when a search hit
// may be linked without asking and, when it may not, which test failed so an
// agent can retry with a year instead of asking Neel. `resolve` runs one whole
// lookup (search, confidence, detail, availability) under one time budget and
// never throws for a source problem: it reports what happened and titles.ts
// decides whether that is a warning or a rejection. `applyPull` writes a pull
// onto a title honouring `edited` and the hand-set series, and `pullChanged`
// tells a refresh whether anything but `pulledAt` moved. Ref resolution turns
// an id or a name into one title, or into the candidates and hint the CLI asks
// with. Nothing here writes; only src/media/catalog/* touches the network.

import type { Availability, CatalogSource, Medium, Needs, Title } from "../contract.ts";
import { titleId as titleIdSchema } from "../contract.ts";
import { diff } from "../core.ts";
import type { Tx } from "../store.ts";
import { normalizeTitle } from "../tasks.ts";
import { CatalogUnavailable, CatalogUnconfigured, HttpError, type Candidate, type Detail } from "./catalog/adapter.ts";
import { catalogFor, type Catalogs } from "./catalog/index.ts";
import { SOURCE_NAMES, normalizeRegion } from "./catalog/links.ts";
import { BUDGET_MS, Budget, realTimer, type Timer } from "./catalog/net.ts";

// ------------------------------------------------------------------ normalization

const LEADING_ARTICLE = /^(?:the|a|an) /;

/** `normalizeTitle` with a leading article gone: what the confidence rule compares. Punctuation is already spaces there. */
export function normalizeLookup(text: string): string {
  return normalizeTitle(text).replace(LEADING_ARTICLE, "");
}

/** The words of a normalized title. */
const words = (text: string): string[] => normalizeTitle(text).split(" ").filter(Boolean);

// ------------------------------------------------------------------ the confidence rule (D94)

/** The tests a candidate list can fail; `needs.message` carries the one that did, verbatim, so an agent can act on it. */
export const CONFIDENCE = {
  several: "several exact matches",
  noExact: "no exact name match",
  year: "year differs",
  category: "not a main work",
  editions: "edition counts too close",
} as const;

/** The IGDB categories that stand for the work itself; a DLC, expansion, remake, or edition never auto-links. */
export const MAIN_WORK_CATEGORIES: readonly string[] = ["main", "remaster", "port"];

/** How far ahead in `editionCount` an Open Library hit must be of the runner-up to auto-link: duplicate works are the norm there. */
export const EDITION_LEAD = 3;

export type Confidence = { ok: true; candidate: Candidate } | { ok: false; reason: string };

/** Whether a candidate is the work itself. TMDB and Open Library never say (null), so null passes for them; IGDB must say main, remaster, or port. */
export function isMainWork(candidate: Candidate): boolean {
  if (candidate.category === null) return candidate.source !== "igdb";
  return MAIN_WORK_CATEGORIES.includes(candidate.category);
}

/** Open Library: the hit is the top candidate and has at least `EDITION_LEAD` times the runner-up's editions. */
function editionsDecisive(hit: Candidate, candidates: Candidate[]): boolean {
  if (candidates.length < 2) return true;
  if (candidates[0] !== hit) return false;
  return (hit.editionCount ?? 0) >= EDITION_LEAD * (candidates[1]!.editionCount ?? 0);
}

/**
 * Auto-link when exactly one candidate's normalized name equals the input's,
 * its year matches when one was given, it is a main work, and (Open Library)
 * its edition count leads decisively. Otherwise the reason, named as the
 * agent should read it.
 */
export function judge(candidates: Candidate[], text: string, year?: number): Confidence {
  const wanted = normalizeLookup(text);
  const exact = candidates.filter((candidate) => normalizeLookup(candidate.name) === wanted);
  if (!exact.length) return { ok: false, reason: CONFIDENCE.noExact };
  const dated = year === undefined ? exact : exact.filter((candidate) => candidate.year === year);
  if (!dated.length) return { ok: false, reason: CONFIDENCE.year };
  if (dated.length > 1) return { ok: false, reason: CONFIDENCE.several };
  const hit = dated[0]!;
  if (!isMainWork(hit)) return { ok: false, reason: `${CONFIDENCE.category}${hit.category ? ` (${hit.category})` : ""}` };
  if (hit.source === "openlibrary" && !editionsDecisive(hit, candidates)) return { ok: false, reason: CONFIDENCE.editions };
  return { ok: true, candidate: hit };
}

/** The candidates with `inLibrary` filled: the non-deleted title already linked to each externalId, when there is one. */
export function markInLibrary(candidates: Candidate[], titles: Title[]): Candidate[] {
  const linked = new Map<string, string>();
  for (const title of titles) {
    if (title.deletedAt || !title.catalog) continue;
    linked.set(`${title.catalog.source}:${title.catalog.externalId}`, title.id);
  }
  return candidates.map((candidate) => ({ ...candidate, inLibrary: linked.get(`${candidate.source}:${candidate.externalId}`) ?? null }));
}

// ------------------------------------------------------------------ resolve

/** What a successful lookup hands the title operations: the source, the id, the detail, and the availability for Neel's region. */
export type CatalogPull = { source: CatalogSource; externalId: string; detail: Detail; availability: Availability[] };

/** Why a lookup produced nothing: the key is missing, the source is down, the budget ran out, or the source refused (a wrong id, a bad key). */
export type LookupFailure = "unconfigured" | "unavailable" | "budget" | "refused";

export type Resolution =
  | ({ outcome: "linked"; candidate: Candidate | null } & CatalogPull)
  | { outcome: "candidates"; source: CatalogSource; candidates: Candidate[]; reason: string; message: string }
  | { outcome: "none"; source: CatalogSource; message: string }
  | { outcome: "failed"; source: CatalogSource; failure: LookupFailure; error: Error; message: string };

export type LookupOptions = {
  catalogs: Catalogs;
  /** Neel's region for availability; normalized, `US` by default. */
  region?: string;
  /** Narrows the search and the confidence rule. */
  year?: number;
  /** Skip the search: pull this id. */
  externalId?: string;
  /** The budget's timer and length; the wall clock and 20 seconds by default. */
  timer?: Timer;
  budgetMs?: number;
};

/** The wording of a `candidates` outcome: the count, the source, the failed test, and what to pass next. */
function candidatesMessage(source: CatalogSource, text: string, count: number, reason: string): string {
  const narrow = reason === CONFIDENCE.year || reason === CONFIDENCE.several ? ", or year to narrow the search" : "";
  return `${count} ${SOURCE_NAMES[source]} candidates for "${text}" (${reason}); pass catalog with one of their ids${narrow}`;
}

/** One row per URL, first wins. */
function dedupeByUrl(rows: Availability[]): Availability[] {
  const seen = new Set<string>();
  return rows.filter((row) => (seen.has(row.url) ? false : (seen.add(row.url), true)));
}

/** A source error as a `failed` outcome; anything that is not a source error is a bug and is rethrown. */
function failureOf(error: unknown, source: CatalogSource, medium: Medium, externalId: string | undefined, budget: Budget): Resolution {
  if (error instanceof CatalogUnconfigured) return { outcome: "failed", source, failure: "unconfigured", error, message: error.message };
  if (error instanceof CatalogUnavailable) {
    const budgetRanOut = budget.exhausted && error === budget.signal.reason;
    return { outcome: "failed", source, failure: budgetRanOut ? "budget" : "unavailable", error, message: error.message };
  }
  if (error instanceof HttpError) {
    const message = error.status === 404 && externalId !== undefined ? `no ${medium} with id "${externalId}" at ${SOURCE_NAMES[source]}` : error.message;
    return { outcome: "failed", source, failure: "refused", error, message };
  }
  throw error;
}

/**
 * One whole lookup under one budget: search (unless an id was given), the
 * confidence rule, `detail`, `availability`. Runs outside any transaction.
 * Source problems come back as outcomes, never as throws, so `add` can warn
 * and `lookup` can reject from the same result.
 */
export async function resolve(medium: Medium, text: string, opts: LookupOptions): Promise<Resolution> {
  const adapter = catalogFor(opts.catalogs, medium);
  const source = adapter.source;
  const region = normalizeRegion(opts.region);
  const budget = new Budget(opts.budgetMs ?? BUDGET_MS, opts.timer ?? realTimer);
  const signal = budget.signal;
  let externalId = opts.externalId;
  try {
    let candidate: Candidate | null = null;
    if (externalId === undefined) {
      const candidates = await adapter.search(medium, text, { ...(opts.year !== undefined ? { year: opts.year } : {}), signal });
      if (!candidates.length) return { outcome: "none", source, message: `no ${SOURCE_NAMES[source]} match for "${text}"` };
      const verdict = judge(candidates, text, opts.year);
      if (!verdict.ok) return { outcome: "candidates", source, candidates, reason: verdict.reason, message: candidatesMessage(source, text, candidates.length, verdict.reason) };
      candidate = verdict.candidate;
      externalId = candidate.externalId;
    }
    const detail = await adapter.detail(medium, externalId, { signal });
    const availability = await adapter.availability(medium, externalId, region, { signal });
    return { outcome: "linked", source, externalId, detail, availability: dedupeByUrl(availability), candidate };
  } catch (error) {
    return failureOf(error, source, medium, externalId, budget);
  } finally {
    budget.release();
  }
}

/** `availability` alone for a linked title, under its own budget; the same outcome vocabulary as `resolve`. */
export async function resolveAvailability(medium: Medium, externalId: string, opts: LookupOptions): Promise<{ outcome: "ok"; availability: Availability[] } | Extract<Resolution, { outcome: "failed" }>> {
  const adapter = catalogFor(opts.catalogs, medium);
  const budget = new Budget(opts.budgetMs ?? BUDGET_MS, opts.timer ?? realTimer);
  try {
    const availability = await adapter.availability(medium, externalId, normalizeRegion(opts.region), { signal: budget.signal });
    return { outcome: "ok", availability: dedupeByUrl(availability) };
  } catch (error) {
    return failureOf(error, adapter.source, medium, externalId, budget) as Extract<Resolution, { outcome: "failed" }>;
  } finally {
    budget.release();
  }
}

// ------------------------------------------------------------------ applying a pull

/**
 * The name a title takes when a catalog names it: the catalog's when every
 * word Neel typed appears in it (so a wrong auto-link never renames a title
 * into something else), and his spelling kept as an alias when it differs in
 * more than case or punctuation. Aliases never repeat and never equal the name.
 */
export function adoptName(current: string, aliases: string[], catalogName: string): { name: string; aliases: string[] } {
  const typed = words(current);
  const pool = new Set(words(catalogName));
  if (!typed.length || !typed.every((word) => pool.has(word))) return { name: current, aliases };
  const same = normalizeTitle(current) === normalizeTitle(catalogName);
  const kept = aliases.filter((alias) => normalizeTitle(alias) !== normalizeTitle(catalogName));
  if (same || kept.some((alias) => normalizeTitle(alias) === normalizeTitle(current))) return { name: catalogName, aliases: kept };
  return { name: catalogName, aliases: [...kept, current] };
}

/**
 * `title` with a pull written onto it: every factual field not in `edited`
 * (the year keeps Neel's when the source has none), `facts` whole with the
 * availability, and `catalog` stamped `pulledAt`. The hand-set `series` is
 * never touched (D93); the catalog's series lives in `facts.series`.
 */
export function applyPull(title: Title, pull: CatalogPull, pulledAt: string): Title {
  const edited = new Set(title.edited);
  const next: Title = {
    ...title,
    facts: { ...pull.detail.facts, availability: pull.availability },
    catalog: { source: pull.source, externalId: pull.externalId, pulledAt },
  };
  if (!edited.has("name")) Object.assign(next, adoptName(title.name, title.aliases, pull.detail.name));
  if (!edited.has("year")) next.year = pull.detail.year ?? title.year;
  if (!edited.has("creators")) next.creators = [...pull.detail.creators];
  if (!edited.has("cover")) next.cover = pull.detail.cover;
  if (!edited.has("length")) next.length = pull.detail.length;
  return next;
}

/** Whether a refresh changed anything but `catalog.pulledAt`: the test that decides `updated` against a quiet stamp. */
export function pullChanged(before: Title, after: Title): boolean {
  const pulledAt = before.catalog?.pulledAt;
  const compared: Title = after.catalog && pulledAt !== undefined ? { ...after, catalog: { ...after.catalog, pulledAt } } : after;
  return Object.keys(diff(before, compared)).length > 0;
}

// ------------------------------------------------------------------ ref resolution

export const isTitleId = (value: string): boolean => titleIdSchema.safeParse(value).success;

/**
 * The titles a name picks out, in the order the brief fixes: an exact
 * normalized `name`, else an alias, else a case-insensitive substring of
 * `name`. Each step only runs when the one before found nothing.
 */
export function findByName(titles: Title[], text: string): Title[] {
  const wanted = normalizeTitle(text);
  if (!wanted) return [];
  const exact = titles.filter((title) => normalizeTitle(title.name) === wanted);
  if (exact.length) return exact;
  const aliased = titles.filter((title) => title.aliases.some((alias) => normalizeTitle(alias) === wanted));
  if (aliased.length) return aliased;
  const needle = text.trim().toLowerCase();
  return titles.filter((title) => title.name.toLowerCase().includes(needle));
}

export type RefResolution =
  | { ok: true; title: Title }
  | { ok: false; kind: "ambiguous"; issues: string[]; needs: Needs; candidates: Title[] }
  | { ok: false; kind: "not_found"; issues: string[] }
  | { ok: false; kind: "deleted"; issues: string[]; title: Title };

export type RefOptions = {
  /** The group's medium; every medium when absent (`life media`). */
  medium?: Medium;
  /** Accept a deleted title by id (names only ever find live titles). */
  includeDeleted?: boolean;
};

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * One title for a ref: an id (deleted included when asked), or a name among
 * the non-deleted titles of the medium. Several hits are a `needs` on `ref`
 * with the candidates; none is `not_found`, and when the name exists in
 * another medium the issue says where (`found as book m_x; use life book`).
 */
export async function resolveTitle(tx: Tx, ref: string, opts: RefOptions = {}): Promise<RefResolution> {
  const value = ref.trim();
  const what = opts.medium ?? "title";
  if (!value) return { ok: false, kind: "not_found", issues: ["ref: a title id or name is required"] };
  if (isTitleId(value)) {
    const title = await tx.get("title", value);
    if (!title) return { ok: false, kind: "not_found", issues: [`title: no title "${value}"`] };
    if (opts.medium !== undefined && title.medium !== opts.medium) {
      return { ok: false, kind: "not_found", issues: [`title: "${value}" is a ${title.medium}, not a ${opts.medium}; use life ${title.medium}`] };
    }
    if (title.deletedAt && !opts.includeDeleted) return { ok: false, kind: "deleted", issues: [`title: ${title.id} is deleted; restore it first`], title };
    return { ok: true, title };
  }
  const all = await tx.all("title");
  const scoped = opts.medium === undefined ? all : all.filter((title) => title.medium === opts.medium);
  const hits = findByName(scoped, value);
  if (hits.length === 1) return { ok: true, title: hits[0]! };
  if (hits.length > 1) {
    const ids = hits.map((title) => title.id);
    const message = `"${value}" names ${plural(hits.length, what)} (${ids.join(", ")}); use the id`;
    return { ok: false, kind: "ambiguous", issues: [`ref: ${message}`], needs: { field: "ref", options: ids, message }, candidates: hits };
  }
  const elsewhere = opts.medium === undefined ? [] : findByName(all.filter((title) => title.medium !== opts.medium), value);
  if (elsewhere.length) {
    const found = elsewhere.map((title) => `${title.medium} ${title.id}`).join(", ");
    const media = [...new Set(elsewhere.map((title) => title.medium))];
    return { ok: false, kind: "not_found", issues: [`title: no ${what} "${value}"; found as ${found}; use ${media.map((medium) => `life ${medium}`).join(" or ")}`] };
  }
  return { ok: false, kind: "not_found", issues: [`title: no ${what} "${value}"`] };
}
