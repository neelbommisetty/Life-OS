// The Open Library adapter (LEISURE D71, D81): the only source for `book`.
// No key, so every request just carries a descriptive User-Agent. A search
// hit is a work; `detail` pulls the work record, up to five authors for
// creators, and the work's editions for ISBNs, formats, and a page count.
// `availability` has nothing live to offer, so it hands back the constructed
// Audible, Libby, and Kindle links from links.ts, built from the same name,
// author, and ISBN `detail` would have used. Mapping from raw JSON to
// Candidate/Detail/Availability is kept in pure functions so the tests can
// drive them straight off the fixtures under fixtures/openlibrary/, with no
// network involved.

import type { Availability, CatalogSource, Medium } from "../../contract.ts";
import { assertCovers, emptyFacts, throwIfAborted, type Candidate, type CatalogAdapter, type Detail } from "./adapter.ts";
import { Net, type FetchLike, type JsonRequest, type Timer } from "./net.ts";
import { SOURCE_NAMES, bookLinks, normalizeRegion } from "./links.ts";

const NAME = SOURCE_NAMES.openlibrary;
const BASE = "https://openlibrary.org";
/** Open Library asks every client to identify itself; there is no key to send instead. */
export const USER_AGENT = "Life-OS/0.1 (life CLI; +local)";
/** Authors past this many are not worth a request each; Neel's titles never need more. */
const MAX_AUTHOR_FETCHES = 5;
const EDITIONS_LIMIT = 50;
const SEARCH_LIMIT = 10;

// ------------------------------------------------------------------ raw shapes

type OLSearchDoc = {
  key: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  edition_count?: number;
  number_of_pages_median?: number;
};
type OLSearchResponse = { docs?: OLSearchDoc[] };

type OLDescription = string | { type?: string; value?: string };
type OLWork = {
  key?: string;
  title?: string;
  description?: OLDescription;
  covers?: number[];
  authors?: { author?: { key?: string } }[];
  first_publish_date?: string;
  number_of_pages_median?: number;
};

type OLAuthor = { key?: string; name?: string };

type OLEdition = {
  key?: string;
  isbn_13?: string[];
  isbn_10?: string[];
  physical_format?: string;
  publish_date?: string;
  number_of_pages?: number;
};
type OLEditionsResponse = { entries?: OLEdition[] };

// ------------------------------------------------------------------ pure mapping

/** The work id Open Library keys search hits and works by, stripped of the `/works/` prefix it always carries. */
export function workIdFromKey(key: string): string {
  return key.replace(/^\/works\//, "");
}

/** `search.json`'s `docs`, in the source's own order, capped at 10. Duplicate works are the norm here; lookup.ts's edition-count rule tells them apart, not this mapping. */
export function mapSearch(raw: OLSearchResponse): Candidate[] {
  const docs = raw.docs ?? [];
  return docs.slice(0, SEARCH_LIMIT).map((doc) => ({
    source: "openlibrary" as CatalogSource,
    externalId: workIdFromKey(doc.key),
    name: doc.title ?? "",
    year: doc.first_publish_year ?? null,
    creators: doc.author_name ? [...doc.author_name] : [],
    category: null,
    cover: coverUrl(doc.cover_i ?? null),
    editionCount: doc.edition_count ?? null,
    sourceRating: null,
    inLibrary: null,
  }));
}

/** A work's description, whichever shape it came in: a plain string, or `{ type, value }`. */
export function mapDescription(description: OLDescription | undefined): string | null {
  if (description === undefined) return null;
  if (typeof description === "string") {
    const trimmed = description.trim();
    return trimmed || null;
  }
  const value = description.value?.trim();
  return value || null;
}

/** `covers.openlibrary.org` at size L for a cover id; null without one. */
export function coverUrl(coverId: number | null): string | null {
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : null;
}

/** The 4-digit year out of a publish date however Open Library spelled it (`"1937"`, `"Sep 1937"`, `"1937-09-21"`); null when there isn't one. */
export function yearOfDate(date: string | null | undefined): number | null {
  const match = /\b(\d{4})\b/.exec(date ?? "");
  return match ? Number(match[1]) : null;
}

/** A book's format from an edition's free-text `physical_format`: audio first, then anything ebook-shaped, else physical. */
export function editionFormat(physicalFormat: string | null | undefined): "audiobook" | "kindle" | "physical" {
  const text = (physicalFormat ?? "").toLowerCase();
  if (text.includes("audio")) return "audiobook";
  if (text.includes("kindle") || text.includes("ebook") || text.includes("e-book")) return "kindle";
  return "physical";
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** The ISBN an edition is best identified by: the 13-digit one when it has it, else the 10-digit one, else null. */
function editionIsbn(edition: OLEdition): string | null {
  return edition.isbn_13?.[0] ?? edition.isbn_10?.[0] ?? null;
}

export type EditionSummary = {
  formats: string[];
  links: { label: string; url: string }[];
  pages: number | null;
  earliestYear: number | null;
  isbn: string | null;
};

/**
 * What a work's editions add to its detail: the distinct formats seen (first
 * seen order), a library link per edition that has an ISBN, the page count
 * (the median across editions when more than one carries a count), the
 * earliest publish year (the `first_publish_date` fallback), and one ISBN to
 * search Audible, Libby, and Kindle by.
 */
export function mapEditions(entries: OLEdition[]): EditionSummary {
  const formats: string[] = [];
  const links: { label: string; url: string }[] = [];
  const pageCounts: number[] = [];
  const years: number[] = [];
  let isbn: string | null = null;
  for (const edition of entries) {
    if (edition.physical_format) {
      const format = editionFormat(edition.physical_format);
      if (!formats.includes(format)) formats.push(format);
    }
    if (typeof edition.number_of_pages === "number" && edition.number_of_pages > 0) pageCounts.push(edition.number_of_pages);
    const year = yearOfDate(edition.publish_date);
    if (year !== null) years.push(year);
    const editionIsbnValue = editionIsbn(edition);
    if (editionIsbnValue) {
      if (isbn === null) isbn = editionIsbnValue;
      links.push({ label: `Open Library edition (ISBN ${editionIsbnValue})`, url: `${BASE}/isbn/${editionIsbnValue}` });
    }
  }
  return {
    formats,
    links,
    pages: median(pageCounts),
    earliestYear: years.length ? Math.min(...years) : null,
    isbn,
  };
}

/** The work, its authors' names, and its editions, folded into the shared `Detail` shape. Series is always null from this source (D93: `series.set` fills it by hand). */
export function mapDetail(work: OLWork, authorNames: string[], editions: OLEdition[]): Detail {
  const summary = mapEditions(editions);
  const released = work.first_publish_date?.trim() || (summary.earliestYear !== null ? String(summary.earliestYear) : null);
  const year = yearOfDate(work.first_publish_date) ?? summary.earliestYear;
  const rawPages = work.number_of_pages_median ?? summary.pages;
  const pages = rawPages === null ? null : Math.round(rawPages);
  return {
    name: work.title ?? "",
    year,
    creators: authorNames,
    cover: coverUrl(work.covers?.[0] ?? null),
    length: pages !== null ? { pages } : null,
    facts: {
      ...emptyFacts(),
      synopsis: mapDescription(work.description),
      released,
      pages,
      formats: summary.formats,
      series: null,
      links: summary.links,
    },
  };
}

/** The constructed Audible, Libby, and Kindle links for a work: everything this source ever has to offer for `availability`. */
export function mapAvailability(input: { title: string; author?: string | null; isbn?: string | null; region?: string }): Availability[] {
  return bookLinks(input);
}

// ------------------------------------------------------------------ the adapter

export type OpenLibraryOptions = {
  fetch?: FetchLike;
  timer?: Timer;
};

/**
 * The Open Library adapter: no key, so nothing to read from the environment.
 * `search` and `detail` map straight off the API's JSON; `availability`
 * re-fetches the work and its editions (the same calls `detail` makes) to get
 * the name, author, and ISBN a constructed link needs, since the interface
 * hands `availability` only an id.
 */
export class OpenLibraryAdapter implements CatalogAdapter {
  readonly source: CatalogSource = "openlibrary";
  readonly media: Medium[] = ["book"];
  #net: Net;

  constructor(opts: OpenLibraryOptions = {}) {
    this.#net = new Net({ fetch: opts.fetch, timer: opts.timer });
  }

  async search(medium: Medium, text: string, opts: { year?: number; signal?: AbortSignal } = {}): Promise<Candidate[]> {
    assertCovers(this, medium);
    throwIfAborted(opts.signal, NAME);
    const url = new URL(`${BASE}/search.json`);
    url.searchParams.set("q", text);
    url.searchParams.set("fields", "key,title,author_name,first_publish_year,cover_i,edition_count,number_of_pages_median");
    url.searchParams.set("limit", String(SEARCH_LIMIT));
    const raw = await this.#net.fetchJson<OLSearchResponse>(url.toString(), request(opts.signal));
    return mapSearch(raw);
  }

  async detail(medium: Medium, externalId: string, opts: { signal?: AbortSignal } = {}): Promise<Detail> {
    assertCovers(this, medium);
    throwIfAborted(opts.signal, NAME);
    const loaded = await this.#load(externalId, opts.signal);
    return mapDetail(loaded.work, loaded.authorNames, loaded.editions);
  }

  async availability(medium: Medium, externalId: string, region: string, opts: { signal?: AbortSignal } = {}): Promise<Availability[]> {
    assertCovers(this, medium);
    throwIfAborted(opts.signal, NAME);
    const loaded = await this.#load(externalId, opts.signal);
    const summary = mapEditions(loaded.editions);
    return mapAvailability({
      title: loaded.work.title ?? "",
      author: loaded.authorNames[0] ?? null,
      isbn: summary.isbn,
      region: normalizeRegion(region),
    });
  }

  /** The work, then up to five of its authors, then its editions, in that order; no caching across calls. */
  async #load(externalId: string, signal: AbortSignal | undefined): Promise<{ work: OLWork; authorNames: string[]; editions: OLEdition[] }> {
    const id = encodeURIComponent(externalId);
    const work = await this.#net.fetchJson<OLWork>(`${BASE}/works/${id}.json`, request(signal));
    const authorKeys = (work.authors ?? []).map((entry) => entry.author?.key).filter((key): key is string => Boolean(key)).slice(0, MAX_AUTHOR_FETCHES);
    const authorNames: string[] = [];
    for (const key of authorKeys) {
      const author = await this.#net.fetchJson<OLAuthor>(`${BASE}${key}.json`, request(signal));
      if (author.name) authorNames.push(author.name);
    }
    const editionsUrl = new URL(`${BASE}/works/${id}/editions.json`);
    editionsUrl.searchParams.set("limit", String(EDITIONS_LIMIT));
    const editionsRaw = await this.#net.fetchJson<OLEditionsResponse>(editionsUrl.toString(), request(signal));
    return { work, authorNames, editions: editionsRaw.entries ?? [] };
  }
}

/** Every Open Library request: the descriptive User-Agent the source asks for, the lookup's signal, and the display name for messages. */
function request(signal: AbortSignal | undefined): JsonRequest {
  return { headers: { "user-agent": USER_AGENT }, signal, source: NAME };
}
