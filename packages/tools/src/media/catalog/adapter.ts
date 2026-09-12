// The catalog adapter: what a source must offer so lookup.ts and the title
// operations stay source-neutral (LEISURE D71, D81), the candidate and detail
// shapes every source maps into, the three errors a source can raise, the lazy
// environment reading every keyed source shares (the root .env loaded on first
// use, CatalogUnconfigured naming the variable), and FakeCatalog, an in-memory
// source for tests. Only src/media/catalog/* talks to a real source; tests
// never touch the network.

import { fileURLToPath } from "node:url";
import type { Availability, CatalogSource, Facts, Medium, Title } from "../../contract.ts";

/** One search hit. `inLibrary` is the title id already linked to this externalId; lookup.ts fills it, sources leave it null. */
export type Candidate = {
  source: CatalogSource;
  externalId: string;
  name: string;
  year: number | null;
  creators: string[];
  category: string | null;
  cover: string | null;
  editionCount: number | null;
  sourceRating: number | null;
  inLibrary: string | null;
};

/** The full pull for one work: the top-level factual fields and the facts under them, availability apart. */
export type Detail = {
  name: string;
  year: number | null;
  creators: string[];
  cover: string | null;
  length: Title["length"];
  facts: Omit<Facts, "availability">;
};

/** The media each source answers for, and the source each medium asks. */
export const MEDIA_BY_SOURCE: Record<CatalogSource, readonly Medium[]> = {
  tmdb: ["movie", "show"],
  openlibrary: ["book"],
  igdb: ["game"],
};
export const SOURCE_BY_MEDIUM: Record<Medium, CatalogSource> = { movie: "tmdb", show: "tmdb", book: "openlibrary", game: "igdb" };

/** The source could not be reached, is down, asked us to back off, or the lookup's time ran out; nothing was done. */
export class CatalogUnavailable extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "CatalogUnavailable";
    this.status = status;
  }
}

/** The source's key is missing from the root `.env`: `add` warns naming the variable, `lookup` rejects. */
export class CatalogUnconfigured extends Error {
  readonly variable: string;

  constructor(variable: string) {
    super(`${variable} is not set in the root .env`);
    this.name = "CatalogUnconfigured";
    this.variable = variable;
  }
}

/** The source answered a request with a 4xx that is not a rate limit: it said no, and `message` carries its reason. A 404 is "no such id" from every source, fake included. */
export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

export interface CatalogAdapter {
  readonly source: CatalogSource;
  readonly media: Medium[];
  /** At most 10 candidates, in the source's order. */
  search(medium: Medium, text: string, opts?: { year?: number; signal?: AbortSignal }): Promise<Candidate[]>;
  detail(medium: Medium, externalId: string, opts?: { signal?: AbortSignal }): Promise<Detail>;
  availability(medium: Medium, externalId: string, region: string, opts?: { signal?: AbortSignal }): Promise<Availability[]>;
}

/** Throws a plain Error when `medium` is not one the adapter answers for; every adapter call checks this before anything else. */
export function assertCovers(adapter: Pick<CatalogAdapter, "source" | "media">, medium: Medium): void {
  if (!adapter.media.includes(medium)) throw new Error(`${adapter.source} does not cover ${medium}`);
}

// ------------------------------------------------------------------ environment

/** Where an adapter reads its variables: `process.env` by default, a plain object in tests. */
export type CatalogEnv = Record<string, string | undefined>;

/** The root `.env`, resolved from this file the way `src/db/client.ts` resolves it. */
const ENV_FILE = fileURLToPath(new URL("../../../../../.env", import.meta.url));

/**
 * One variable from `env`, loading the repository root `.env` first when `env`
 * is the real environment and the variable is unset (the same rule
 * `googleClientConfig` and `databaseUrl` follow). Undefined when it is set
 * nowhere or blank. Read at call time, never at construction, so a missing key
 * only matters once the source is actually asked for something.
 */
export function readEnv(env: CatalogEnv, variable: string): string | undefined {
  if (env === process.env && !env[variable]) {
    try {
      process.loadEnvFile(ENV_FILE);
    } catch {
      // No root .env; the variable is simply unset.
    }
  }
  const value = env[variable]?.trim();
  return value ? value : undefined;
}

/** `readEnv`, or CatalogUnconfigured naming the variable: what `add` turns into a warning and `lookup` into a rejection. */
export function requireEnv(env: CatalogEnv, variable: string): string {
  const value = readEnv(env, variable);
  if (!value) throw new CatalogUnconfigured(variable);
  return value;
}

/**
 * The CatalogUnavailable for a signal that aborted: the budget's own error when
 * the budget cut the lookup short (so the warning can say so), otherwise one
 * naming the source. Every adapter, fake or real, throws this and nothing else
 * when its signal is aborted.
 */
export function abortedError(signal: AbortSignal, source: string): CatalogUnavailable {
  const reason: unknown = signal.reason;
  if (reason instanceof CatalogUnavailable) return reason;
  const detail = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return new CatalogUnavailable(`${source}: the request was aborted${detail ? ` (${detail})` : ""}`);
}

/** Throws the aborted error when `signal` is already aborted; the first thing every adapter call does. */
export function throwIfAborted(signal: AbortSignal | undefined, source: string): void {
  if (signal?.aborted) throw abortedError(signal, source);
}

/** Facts with nothing in them: what a detail starts from before a source fills the fields it has. */
export function emptyFacts(): Omit<Facts, "availability"> {
  return {
    synopsis: null,
    genres: [],
    people: [],
    released: null,
    runtime: null,
    pages: null,
    episodes: null,
    playtime: null,
    series: null,
    platforms: [],
    formats: [],
    language: null,
    links: [],
    sourceRating: null,
  };
}

// ------------------------------------------------------------------ FakeCatalog

/** One recorded adapter call, with the arguments that matter to a test. */
export type FakeCatalogCall =
  | { method: "search"; medium: Medium; text: string; year: number | null }
  | { method: "detail"; medium: Medium; externalId: string }
  | { method: "availability"; medium: Medium; externalId: string; region: string };
export type FakeCatalogMethod = FakeCatalogCall["method"];

/** What `seed` needs for one work; everything else takes a plain default. */
export type FakeTitle = {
  externalId: string;
  name: string;
  year?: number | null;
  creators?: string[];
  category?: string | null;
  cover?: string | null;
  editionCount?: number | null;
  sourceRating?: number | null;
  /** Search texts that find it besides its own name, matched like the name (case and spacing ignored). */
  texts?: string[];
  length?: Title["length"];
  facts?: Partial<Omit<Facts, "availability">>;
  /** What `availability` answers, filtered to the region asked for. */
  availability?: Availability[];
};

type FakeWork = { candidate: Candidate; detail: Detail; texts: string[]; availability: Availability[] };
type Failure = { error: Error; method: FakeCatalogMethod | null };

/** Case, surrounding space, and runs of space ignored: enough for a fake to match a name the way a search box would. */
function searchKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * An in-memory source. Works live per medium, seeded with the candidate and
 * detail fields at once; `search` returns every seeded work whose name contains
 * the text or whose `texts` name it, in seed order, so two works seeded under
 * one name are the "several candidates" case; an unknown id is the HttpError
 * 404 a real source answers with. Every call is recorded in
 * `calls`; `failNext` makes the next one throw and `failAlways` every one until
 * `recover`, optionally for one method only; `stallNext` makes the next call
 * wait until its signal aborts, which is how a test exhausts a lookup budget.
 * An already-aborted signal is refused the way net.ts refuses it.
 */
export class FakeCatalog implements CatalogAdapter {
  readonly source: CatalogSource;
  readonly media: Medium[];
  readonly calls: FakeCatalogCall[] = [];
  #works = new Map<Medium, Map<string, FakeWork>>();
  #nextFailure: Failure | null = null;
  #alwaysFailure: Failure | null = null;
  #stall: { method: FakeCatalogMethod | null } | null = null;

  constructor(opts: { source?: CatalogSource; media?: Medium[] } = {}) {
    this.source = opts.source ?? "tmdb";
    this.media = opts.media ? [...opts.media] : [...MEDIA_BY_SOURCE[this.source]];
  }

  // ---------------------------------------------------------------- the interface

  async search(medium: Medium, text: string, opts: { year?: number; signal?: AbortSignal } = {}): Promise<Candidate[]> {
    await this.#call({ method: "search", medium, text, year: opts.year ?? null }, opts.signal);
    this.#covers(medium);
    const key = searchKey(text);
    if (!key) return [];
    const hits: Candidate[] = [];
    for (const work of this.#of(medium).values()) {
      if (searchKey(work.candidate.name).includes(key) || work.texts.includes(key)) hits.push(structuredClone(work.candidate));
      if (hits.length === 10) break;
    }
    return hits;
  }

  async detail(medium: Medium, externalId: string, opts: { signal?: AbortSignal } = {}): Promise<Detail> {
    await this.#call({ method: "detail", medium, externalId }, opts.signal);
    this.#covers(medium);
    return structuredClone(this.#work(medium, externalId).detail);
  }

  async availability(medium: Medium, externalId: string, region: string, opts: { signal?: AbortSignal } = {}): Promise<Availability[]> {
    await this.#call({ method: "availability", medium, externalId, region }, opts.signal);
    this.#covers(medium);
    return structuredClone(this.#work(medium, externalId).availability.filter((row) => row.region === region));
  }

  // ---------------------------------------------------------------- test helpers

  /** Put works into a medium (upsert by externalId). Candidate and detail share the seeded fields. */
  seed(medium: Medium, titles: FakeTitle[]): void {
    const works = this.#of(medium);
    for (const seed of titles) {
      const creators = [...(seed.creators ?? [])];
      const candidate: Candidate = {
        source: this.source,
        externalId: seed.externalId,
        name: seed.name,
        year: seed.year ?? null,
        creators,
        category: seed.category ?? null,
        cover: seed.cover ?? null,
        editionCount: seed.editionCount ?? null,
        sourceRating: seed.sourceRating ?? null,
        inLibrary: null,
      };
      const detail: Detail = {
        name: seed.name,
        year: seed.year ?? null,
        creators: [...creators],
        cover: seed.cover ?? null,
        length: seed.length ?? null,
        facts: { ...emptyFacts(), ...(seed.facts ?? {}) },
      };
      works.set(seed.externalId, { candidate, detail, texts: (seed.texts ?? []).map(searchKey), availability: [...(seed.availability ?? [])] });
    }
  }

  /** The next call throws `error` (a CatalogUnavailable or CatalogUnconfigured, typically) after being recorded; with `method`, the next call to that method. One shot. */
  failNext(error: Error, method?: FakeCatalogMethod): void {
    this.#nextFailure = { error, method: method ?? null };
  }

  /** Every call throws `error` until `recover`; with `method`, every call to that method. */
  failAlways(error: Error, method?: FakeCatalogMethod): void {
    this.#alwaysFailure = { error, method: method ?? null };
  }

  /** Clear `failNext`, `failAlways`, and `stallNext`. */
  recover(): void {
    this.#nextFailure = null;
    this.#alwaysFailure = null;
    this.#stall = null;
  }

  /** The next call (to `method`, when given) waits until its signal aborts and then throws the aborted error; a call without a signal is refused instead of hanging. */
  stallNext(method?: FakeCatalogMethod): void {
    this.#stall = { method: method ?? null };
  }

  /** The recorded calls to one method. */
  callsTo<M extends FakeCatalogMethod>(method: M): Extract<FakeCatalogCall, { method: M }>[] {
    return this.calls.filter((call): call is Extract<FakeCatalogCall, { method: M }> => call.method === method);
  }

  // ---------------------------------------------------------------- internals

  async #call(call: FakeCatalogCall, signal: AbortSignal | undefined): Promise<void> {
    this.calls.push(call);
    throwIfAborted(signal, this.source);
    if (this.#stall && (this.#stall.method === null || this.#stall.method === call.method)) {
      this.#stall = null;
      if (!signal) throw new Error(`FakeCatalog: stallNext needs a signal on ${call.method}, or the call would never return`);
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      throw abortedError(signal, this.source);
    }
    const next = this.#nextFailure;
    if (next && (next.method === null || next.method === call.method)) {
      this.#nextFailure = null;
      throw next.error;
    }
    const always = this.#alwaysFailure;
    if (always && (always.method === null || always.method === call.method)) throw always.error;
  }

  #covers(medium: Medium): void {
    assertCovers(this, medium);
  }

  #of(medium: Medium): Map<string, FakeWork> {
    let works = this.#works.get(medium);
    if (!works) {
      works = new Map();
      this.#works.set(medium, works);
    }
    return works;
  }

  /** The seeded work, or the HttpError 404 a real source answers an unknown id with. */
  #work(medium: Medium, externalId: string): FakeWork {
    const work = this.#of(medium).get(externalId);
    if (!work) throw new HttpError(`${this.source} refused the request (HTTP 404): no ${medium} with id ${externalId}`, 404, null);
    return work;
  }
}
