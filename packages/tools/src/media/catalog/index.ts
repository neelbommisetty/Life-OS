// The catalog package's front door: the three real adapters behind one
// factory, `defaultCatalogs`, which `Tools.open({ catalogs })` uses when no
// catalogs are passed in. Each adapter reads its variables lazily, so building
// the set never throws and a missing key only surfaces as CatalogUnconfigured
// once that source is asked for something (the brief: nothing fails for lack
// of a key). Tests build the same shape from FakeCatalog instances. The
// mapping functions of the three sources share names (mapSearch, mapDetail,
// mapAvailability), so they are reached through their own modules, not here.

import type { CatalogSource, Medium } from "../../contract.ts";
import { SOURCE_BY_MEDIUM, type CatalogAdapter, type CatalogEnv } from "./adapter.ts";
import { IgdbAdapter, type IgdbClock } from "./igdb.ts";
import type { FetchLike, Timer } from "./net.ts";
import { OpenLibraryAdapter } from "./openlibrary.ts";
import { TmdbAdapter } from "./tmdb.ts";

export * from "./adapter.ts";
export * from "./links.ts";
export * from "./net.ts";
export { IGDB_RATE_LIMIT_MS, IGDB_TOKEN_DIR, IgdbAdapter, igdbTokenFresh, igdbTokenPath, readIgdbToken } from "./igdb.ts";
export type { IgdbClock, IgdbOptions, IgdbToken } from "./igdb.ts";
export { OpenLibraryAdapter, USER_AGENT as OPENLIBRARY_USER_AGENT } from "./openlibrary.ts";
export type { OpenLibraryOptions } from "./openlibrary.ts";
export { TmdbAdapter } from "./tmdb.ts";
export type { TmdbOptions } from "./tmdb.ts";

/** One adapter per source, keyed by source; what `Tools` and the CLI hold. */
export type Catalogs = Record<CatalogSource, CatalogAdapter>;

export type DefaultCatalogsOptions = {
  /** Where the keys are read from, at call time; defaults to process.env with the root .env loaded when a variable is unset there. */
  env?: CatalogEnv;
  /** Shared by every adapter; defaults to the global fetch. Tests never rely on this: they pass FakeCatalog instead. */
  fetch?: FetchLike;
  /** Shared by every adapter's Net for timeouts, the 429 retry, and IGDB's pacing; the wall clock by default. */
  timer?: Timer;
  /** Decides IGDB token expiry; the wall clock by default. */
  clock?: IgdbClock;
  /** Where the IGDB token is cached; defaults to `.local/igdb/` at the repository root. */
  igdbDir?: string;
};

/** The three real adapters, each reading its environment lazily. Building them never throws and sends nothing. */
export function defaultCatalogs(options: DefaultCatalogsOptions = {}): Catalogs {
  const shared = { env: options.env, fetch: options.fetch, timer: options.timer };
  return {
    tmdb: new TmdbAdapter(shared),
    openlibrary: new OpenLibraryAdapter({ fetch: options.fetch, timer: options.timer }),
    igdb: new IgdbAdapter({ ...shared, clock: options.clock, dir: options.igdbDir }),
  };
}

/** The adapter that answers for a medium, by `SOURCE_BY_MEDIUM`. */
export function catalogFor(catalogs: Catalogs, medium: Medium): CatalogAdapter {
  return catalogs[SOURCE_BY_MEDIUM[medium]];
}
