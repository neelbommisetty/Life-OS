// The TMDB adapter (LEISURE D81): movies and shows. LIFE_TMDB_KEY is a v4 read
// access token sent as a bearer, read lazily on first use (the root .env
// loaded then, as the calendar does) so a missing key throws
// CatalogUnconfigured only when the adapter is actually asked to do
// something. Movies and shows share one detail shape closely enough that a
// small set of medium branches covers both, per D74. The image configuration
// is fetched once per adapter and reused. The raw-JSON-to-
// Candidate/Detail/Availability mapping is exported as pure functions so
// tmdb.test.ts can exercise it against recorded fixtures with no network.

import type { Availability, CatalogSource, Facts, Medium, Title } from "../../contract.ts";
import { assertCovers, emptyFacts, requireEnv, throwIfAborted, type Candidate, type CatalogAdapter, type CatalogEnv, type Detail } from "./adapter.ts";
import { Net, type FetchLike, type Timer } from "./net.ts";
import { SOURCE_NAMES, tmdbImageUrl } from "./links.ts";

const NAME = SOURCE_NAMES.tmdb;

const BASE_URL = "https://api.themoviedb.org/3";

// ------------------------------------------------------------------ raw TMDB shapes

type TmdbGenre = { id: number; name: string };
type TmdbCastMember = { name: string; character?: string; order?: number };
type TmdbCrewMember = { name: string; job?: string; department?: string };
type TmdbCredits = { cast?: TmdbCastMember[]; crew?: TmdbCrewMember[] };
type TmdbProvider = { provider_name: string; provider_id: number };
type TmdbRegionProviders = { link?: string; flatrate?: TmdbProvider[]; free?: TmdbProvider[]; ads?: TmdbProvider[]; rent?: TmdbProvider[]; buy?: TmdbProvider[] };
type TmdbWatchProviders = { results?: Record<string, TmdbRegionProviders> };

type TmdbSearchResult = {
  id: number;
  title?: string;
  name?: string;
  release_date?: string | null;
  first_air_date?: string | null;
  poster_path?: string | null;
  vote_average?: number | null;
  vote_count?: number | null;
};
type TmdbSearchResponse = { results?: TmdbSearchResult[] };

type TmdbCollectionRef = { id: number; name: string } | null;

/** The fields the movie and show detail shapes share; everything else is read through a medium branch. */
type TmdbDetailCommon = {
  overview?: string | null;
  genres?: TmdbGenre[];
  poster_path?: string | null;
  credits?: TmdbCredits;
  "watch/providers"?: TmdbWatchProviders;
  vote_average?: number | null;
  vote_count?: number | null;
  spoken_languages?: { english_name?: string }[];
};
type TmdbMovieDetail = TmdbDetailCommon & {
  title: string;
  release_date?: string | null;
  runtime?: number | null;
  belongs_to_collection?: TmdbCollectionRef;
};
type TmdbTvDetail = TmdbDetailCommon & {
  name: string;
  first_air_date?: string | null;
  episode_run_time?: number[];
  last_episode_to_air?: { runtime?: number | null } | null;
  number_of_seasons?: number;
  number_of_episodes?: number;
  created_by?: { name: string }[];
  type?: string;
};
type TmdbDetail = TmdbMovieDetail | TmdbTvDetail;

type TmdbCollectionPart = { id: number; title: string; release_date?: string | null };
type TmdbCollection = { id: number; name: string; parts?: TmdbCollectionPart[] };

type TmdbConfiguration = { images: { secure_base_url: string; poster_sizes: string[] } };
type ImageConfig = { baseUrl: string; sizes: string[] };

// ------------------------------------------------------------------ pure mapping

/** `YYYY-...` to a year, or null when the date is absent or unreadable. */
function yearFrom(date: string | null | undefined): number | null {
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) && date.length >= 4 ? year : null;
}

function isMovieDetail(medium: Medium, _detail: TmdbDetail): _detail is TmdbMovieDetail {
  return medium === "movie";
}

/** Search results to candidates, source order, at most 10. Category is always null: TMDB's search endpoints carry no work-type field to judge by (a show's `type` only appears on its detail pull), so lookup's confidence rule never gates on it here. */
export function mapSearch(json: TmdbSearchResponse, medium: Medium, config: ImageConfig | null): Candidate[] {
  const results = json.results ?? [];
  return results.slice(0, 10).map((result) => {
    const name = (medium === "movie" ? result.title : result.name) ?? "";
    const releaseDate = medium === "movie" ? result.release_date : result.first_air_date;
    return {
      source: "tmdb" as CatalogSource,
      externalId: String(result.id),
      name,
      year: yearFrom(releaseDate),
      creators: [],
      category: null,
      cover: config ? tmdbImageUrl(config, result.poster_path ?? null) : null,
      editionCount: null,
      sourceRating: result.vote_average ?? null,
      inLibrary: null,
    };
  });
}

/** Director(s) for a movie (deduplicated, in crew order), `created_by` for a show. */
function creatorsOf(medium: Medium, detail: TmdbDetail): string[] {
  if (isMovieDetail(medium, detail)) {
    const crew = detail.credits?.crew ?? [];
    const seen = new Set<string>();
    const directors: string[] = [];
    for (const member of crew) {
      if (member.job === "Director" && !seen.has(member.name)) {
        seen.add(member.name);
        directors.push(member.name);
      }
    }
    return directors;
  }
  return (detail.created_by ?? []).map((person) => person.name);
}

/** Cast top 10, plus directors and writers for a movie or creators for a show, each with their role. */
function peopleOf(medium: Medium, detail: TmdbDetail): Facts["people"] {
  const cast = (detail.credits?.cast ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .slice(0, 10)
    .map((member) => ({ role: "Cast", name: member.name }));
  const crewPeople: Facts["people"] = [];
  if (isMovieDetail(medium, detail)) {
    const seen = new Set<string>();
    for (const member of detail.credits?.crew ?? []) {
      const role = member.job === "Director" ? "Director" : member.department === "Writing" ? "Writer" : null;
      if (!role) continue;
      const key = `${role}:${member.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      crewPeople.push({ role, name: member.name });
    }
  } else {
    for (const person of detail.created_by ?? []) crewPeople.push({ role: "Creator", name: person.name });
  }
  return [...crewPeople, ...cast];
}

/** Runtime in minutes: a movie's own `runtime`, else a show's first `episode_run_time`, else its last aired episode's runtime. */
function runtimeOf(medium: Medium, detail: TmdbDetail): number | null {
  if (isMovieDetail(medium, detail)) return detail.runtime ?? null;
  return detail.episode_run_time?.[0] ?? detail.last_episode_to_air?.runtime ?? null;
}

/** The collection's parts ordered by release date (undated last), as series entries with no position: TMDB collections carry no numbering. */
function seriesOf(collection: TmdbCollection | null): Facts["series"] {
  if (!collection) return null;
  const parts = [...(collection.parts ?? [])].sort((a, b) => {
    const left = a.release_date ?? "";
    const right = b.release_date ?? "";
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return left.localeCompare(right);
  });
  return {
    name: collection.name,
    position: null,
    entries: parts.map((part) => ({ externalId: String(part.id), name: part.title, position: null, released: part.release_date ?? null })),
  };
}

/** A movie or show detail pull to the shared `Detail` shape. `collection` is the movie's `belongs_to_collection` pull, when it has one; shows never carry one. */
export function mapDetail(json: TmdbDetail, medium: Medium, collection: TmdbCollection | null, config: ImageConfig): Detail {
  const movie = isMovieDetail(medium, json);
  const name = movie ? json.title : (json as TmdbTvDetail).name;
  const releaseDate = (movie ? json.release_date : (json as TmdbTvDetail).first_air_date) ?? null;
  const runtime = runtimeOf(medium, json);
  const seasons = movie ? 0 : (json as TmdbTvDetail).number_of_seasons ?? 0;
  const episodeCount = movie ? 0 : (json as TmdbTvDetail).number_of_episodes ?? 0;

  let length: Title["length"] = null;
  if (movie) {
    if (runtime) length = { minutes: runtime };
  } else {
    const partial: NonNullable<Title["length"]> = {};
    if (seasons) partial.seasons = seasons;
    if (episodeCount) partial.episodes = episodeCount;
    length = Object.keys(partial).length ? partial : null;
  }

  const sourceRating: Facts["sourceRating"] = json.vote_average != null ? { value: json.vote_average, scale: 10, count: json.vote_count ?? null } : null;

  return {
    name: name ?? "",
    year: yearFrom(releaseDate),
    creators: creatorsOf(medium, json),
    cover: tmdbImageUrl(config, json.poster_path ?? null),
    length,
    facts: {
      ...emptyFacts(),
      synopsis: json.overview ?? null,
      genres: (json.genres ?? []).map((genre) => genre.name),
      people: peopleOf(medium, json),
      released: releaseDate,
      runtime,
      episodes: movie ? null : { seasons, episodes: episodeCount },
      series: movie ? seriesOf(collection) : null,
      language: json.spoken_languages?.[0]?.english_name ?? null,
      sourceRating,
    },
  };
}

/**
 * Watch providers for one region to Availability rows: `flatrate`, `free`, and
 * `ads` are all `stream` (D89 is honest that "free" and "ad-supported" are still
 * a way to watch, not a purchase); `rent` and `buy` keep their names. Every row
 * carries the region's one JustWatch `link` and `price: null`, since TMDB gives
 * no per-provider price, and `constructed: false` since the source made the
 * link, not us. No `link` for the region (or no providers at all) is no rows.
 */
export function mapAvailability(providers: TmdbWatchProviders | undefined, region: string): Availability[] {
  const regionData = providers?.results?.[region];
  const link = regionData?.link;
  if (!regionData || !link) return [];
  const rows: Availability[] = [];
  const addAll = (list: TmdbProvider[] | undefined, kind: Availability["kind"]): void => {
    for (const provider of list ?? []) rows.push({ kind, name: provider.provider_name, url: link, region, price: null, constructed: false });
  };
  addAll(regionData.flatrate, "stream");
  addAll(regionData.free, "stream");
  addAll(regionData.ads, "stream");
  addAll(regionData.rent, "rent");
  addAll(regionData.buy, "buy");
  return rows;
}

// ------------------------------------------------------------------ the adapter

export type TmdbOptions = {
  /** Where LIFE_TMDB_KEY is read from, at call time; defaults to process.env with the root .env loaded when it is unset there. */
  env?: CatalogEnv;
  fetch?: FetchLike;
  timer?: Timer;
};

/** TMDB (LEISURE D81): movies and shows, one detail shape apart. The region for providers is the caller's, per `availability` call. */
export class TmdbAdapter implements CatalogAdapter {
  readonly source: CatalogSource = "tmdb";
  readonly media: Medium[] = ["movie", "show"];
  #env: CatalogEnv;
  #net: Net;
  #config: Promise<ImageConfig> | null = null;

  constructor(opts: TmdbOptions = {}) {
    this.#env = opts.env ?? process.env;
    this.#net = new Net({ fetch: opts.fetch, timer: opts.timer });
  }

  async search(medium: Medium, text: string, opts: { year?: number; signal?: AbortSignal } = {}): Promise<Candidate[]> {
    assertCovers(this, medium);
    throwIfAborted(opts.signal, NAME);
    const params = new URLSearchParams({ query: text });
    let path: string;
    if (medium === "movie") {
      if (opts.year) params.set("year", String(opts.year));
      params.set("include_adult", "false");
      params.set("language", "en-US");
      path = `/search/movie?${params.toString()}`;
    } else {
      if (opts.year) params.set("first_air_date_year", String(opts.year));
      path = `/search/tv?${params.toString()}`;
    }
    const json = await this.#request<TmdbSearchResponse>(path, opts.signal);
    // Candidates without covers beat no candidates when only the configuration failed; a budget that ran out still ends the lookup.
    const config = await this.#configuration(opts.signal).catch((error: unknown) => {
      if (opts.signal?.aborted) throw error;
      return null;
    });
    return mapSearch(json, medium, config);
  }

  async detail(medium: Medium, externalId: string, opts: { signal?: AbortSignal } = {}): Promise<Detail> {
    assertCovers(this, medium);
    throwIfAborted(opts.signal, NAME);
    const kind = medium === "movie" ? "movie" : "tv";
    const json = await this.#request<TmdbDetail>(`/${kind}/${encodeURIComponent(externalId)}?append_to_response=credits%2Cwatch%2Fproviders&language=en-US`, opts.signal);
    let collection: TmdbCollection | null = null;
    const belongsTo = medium === "movie" ? (json as TmdbMovieDetail).belongs_to_collection : null;
    if (belongsTo) {
      collection = await this.#request<TmdbCollection>(`/collection/${belongsTo.id}?language=en-US`, opts.signal);
    }
    const config = await this.#configuration(opts.signal);
    return mapDetail(json, medium, collection, config);
  }

  async availability(medium: Medium, externalId: string, region: string, opts: { signal?: AbortSignal } = {}): Promise<Availability[]> {
    assertCovers(this, medium);
    throwIfAborted(opts.signal, NAME);
    const kind = medium === "movie" ? "movie" : "tv";
    const json = await this.#request<TmdbDetail>(`/${kind}/${encodeURIComponent(externalId)}?append_to_response=watch%2Fproviders&language=en-US`, opts.signal);
    return mapAvailability(json["watch/providers"], region);
  }

  async #request<T>(path: string, signal: AbortSignal | undefined): Promise<T> {
    const token = requireEnv(this.#env, "LIFE_TMDB_KEY");
    return this.#net.fetchJson<T>(`${BASE_URL}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
      source: NAME,
    });
  }

  /** `configuration`, fetched once per adapter instance and reused for every image URL; a failed fetch is forgotten so the next call tries again. */
  #configuration(signal: AbortSignal | undefined): Promise<ImageConfig> {
    if (!this.#config) {
      this.#config = this.#request<TmdbConfiguration>("/configuration", signal)
        .then((cfg) => ({ baseUrl: cfg.images.secure_base_url, sizes: cfg.images.poster_sizes }))
        .catch((error: unknown) => {
          this.#config = null;
          throw error;
        });
    }
    return this.#config;
  }
}
