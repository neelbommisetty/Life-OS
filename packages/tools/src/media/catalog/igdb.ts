// The IGDB adapter (LEISURE D71, "The catalog adapter" brief): games only.
// IGDB sits behind Twitch's client-credentials OAuth, so this file is also the
// only place that talks to Twitch. The app token is cached in
// .local/igdb/token.json (mode 0600, never logged) at the repository root,
// resolved the way src/calendar/credentials.ts resolves .local/google;
// refreshed within a day of expiry or on a 401 (one retry). The client id and
// secret are read lazily through adapter.ts's requireEnv (root .env loaded on
// first use). Every request carries Client-ID and the bearer, and the adapter
// serializes its own requests through one lane with a 250 ms floor between
// sends (IGDB's 4-per-second limit), token calls included. Mapping from the
// raw Apicalypse response to Candidate/Detail/Availability is pure and
// exported (mapSearch, mapDetail, mapAvailability) so it can be tested
// against fixtures with no network.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Availability, CatalogSource, Facts, Medium } from "../../contract.ts";
import { MEDIA_BY_SOURCE, assertCovers, emptyFacts, requireEnv, throwIfAborted } from "./adapter.ts";
import type { Candidate, CatalogAdapter, CatalogEnv, Detail } from "./adapter.ts";
import { HttpError, Net } from "./net.ts";
import type { FetchLike, Timer } from "./net.ts";
import { SOURCE_NAMES, igdbImageUrl, storeLinks } from "./links.ts";
import type { ExternalGame, Website } from "./links.ts";

const SOURCE: CatalogSource = "igdb";
const NAME = SOURCE_NAMES.igdb;

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const GAMES_URL = "https://api.igdb.com/v4/games";
const PLAYTIME_URL = "https://api.igdb.com/v4/game_time_to_beats";

/** IGDB's 4-requests-per-second limit: the adapter never sends two of its own requests closer together than this. */
export const IGDB_RATE_LIMIT_MS = 250;
/** A token is refreshed once it has less than this long left, not only once it has actually expired. */
const TOKEN_REFRESH_SKEW_MS = 24 * 60 * 60 * 1000;

/** The default token directory: `.local/igdb/` at the repository root, resolved the way `.local/google` is. */
export const IGDB_TOKEN_DIR = fileURLToPath(new URL("../../../../../.local/igdb/", import.meta.url));

/**
 * Both the current field (`game_type`) and the deprecated one (`category`)
 * use the same numbering for the values Neel cares about; whichever the API
 * answers with maps to the same word. Anything else, including a mod or a
 * bundle, is `other`.
 */
const GAME_TYPE_MAP: Readonly<Record<number, string>> = {
  0: "main",
  1: "dlc",
  2: "expansion",
  8: "remake",
  9: "remaster",
  11: "port",
};

/** The field list the brief pins, requested on every search and detail call. */
const FIELDS = [
  "name",
  "first_release_date",
  "cover.url",
  "summary",
  "genres.name",
  "themes.name",
  "involved_companies.company.name",
  "involved_companies.developer",
  "involved_companies.publisher",
  "platforms.name",
  "collections.name",
  "collections.games.name",
  "collections.games.id",
  "collections.games.first_release_date",
  "websites.url",
  "websites.type",
  "websites.category",
  "external_games.uid",
  "external_games.external_game_source",
  "external_games.category",
  "game_type",
  "category",
  "aggregated_rating",
  "aggregated_rating_count",
].join(", ");

// ------------------------------------------------------------------ raw shapes

type RawCompany = { company?: { name?: string | null } | null; developer?: boolean | null; publisher?: boolean | null };
type RawCollectionGame = { id?: number | null; name?: string | null; first_release_date?: number | null };
type RawCollection = { name?: string | null; games?: RawCollectionGame[] | null };
type RawExternalGame = { uid?: string | null; external_game_source?: number | null; category?: number | null };
type RawWebsite = { url?: string | null; type?: number | null };
type RawGame = {
  id: number;
  name?: string | null;
  first_release_date?: number | null;
  cover?: { url?: string | null } | null;
  summary?: string | null;
  genres?: { name?: string | null }[] | null;
  themes?: { name?: string | null }[] | null;
  involved_companies?: RawCompany[] | null;
  platforms?: { name?: string | null }[] | null;
  collections?: RawCollection[] | null;
  websites?: RawWebsite[] | null;
  external_games?: RawExternalGame[] | null;
  game_type?: number | null;
  category?: number | null;
  aggregated_rating?: number | null;
  aggregated_rating_count?: number | null;
};
type RawPlaytime = { game_id?: number | null; normally?: number | null };
type RawTokenResponse = { access_token: string; expires_in: number; token_type?: string };

// ------------------------------------------------------------------ pure mapping

function yearOf(seconds: number | null | undefined): number | null {
  return seconds === null || seconds === undefined ? null : new Date(seconds * 1000).getUTCFullYear();
}

function isoDate(seconds: number | null | undefined): string | null {
  return seconds === null || seconds === undefined ? null : new Date(seconds * 1000).toISOString().slice(0, 10);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/** Developer companies, else publisher companies when there is no developer credited. */
function creatorsOf(companies: readonly RawCompany[]): string[] {
  const developers = dedupe(companies.filter((company) => company.developer).map((company) => company.company?.name ?? ""));
  if (developers.length) return developers;
  return dedupe(companies.filter((company) => company.publisher).map((company) => company.company?.name ?? ""));
}

function peopleOf(companies: readonly RawCompany[]): { role: string; name: string }[] {
  const people: { role: string; name: string }[] = [];
  for (const company of companies) {
    const name = (company.company?.name ?? "").trim();
    if (!name) continue;
    if (company.developer) people.push({ role: "developer", name });
    if (company.publisher) people.push({ role: "publisher", name });
    if (!company.developer && !company.publisher) people.push({ role: "company", name });
  }
  return people;
}

function genresOf(game: RawGame): string[] {
  return dedupe([...(game.genres ?? []).map((genre) => genre.name ?? ""), ...(game.themes ?? []).map((theme) => theme.name ?? "")]);
}

/** `game_type` maps `category` when the current field is missing; either way one of the brief's seven words, or null when the API gave neither field. */
function categoryOf(game: RawGame): string | null {
  const raw = game.game_type ?? game.category;
  if (raw === null || raw === undefined) return null;
  return GAME_TYPE_MAP[raw] ?? "other";
}

/** The collection's games ordered by release, position always null (LEISURE / brief: "position null"). */
function seriesOf(game: RawGame): Facts["series"] {
  const collection = game.collections?.[0];
  if (!collection) return null;
  const games = [...(collection.games ?? [])].sort(
    (a, b) => (a.first_release_date ?? Number.POSITIVE_INFINITY) - (b.first_release_date ?? Number.POSITIVE_INFINITY),
  );
  return {
    name: collection.name ?? "",
    position: null,
    entries: games.map((entry) => ({
      externalId: String(entry.id ?? ""),
      name: entry.name ?? "",
      position: null,
      released: isoDate(entry.first_release_date),
    })),
  };
}

function externalGamesOf(game: RawGame): ExternalGame[] {
  return (game.external_games ?? []).map((row) => ({ source: row.external_game_source ?? row.category ?? null, uid: row.uid ?? null }));
}

function websitesOf(game: RawGame): Website[] {
  return (game.websites ?? []).map((row) => ({ type: row.type ?? null, url: row.url ?? null }));
}

/** Store rows through `links.ts`'s templates, falling back to `websites`, as the brief directs; links.ts marks them `constructed: false` since IGDB lists the game there. */
function availabilityOf(game: RawGame, region: string): Availability[] {
  return storeLinks(externalGamesOf(game), websitesOf(game), { region });
}

function ratingOf(game: RawGame): Facts["sourceRating"] {
  if (game.aggregated_rating === null || game.aggregated_rating === undefined) return null;
  return { value: game.aggregated_rating, scale: 100, count: game.aggregated_rating_count ?? null };
}

/** Seconds to hours, rounded to one decimal, as the brief's `round(normally / 3600, 1)` says. Exported for fixture-driven tests. */
export function playtimeHours(row: RawPlaytime | undefined): number | null {
  if (!row || row.normally === null || row.normally === undefined) return null;
  return Math.round((row.normally / 3600) * 10) / 10;
}

/** One search hit mapped to a Candidate. Exported for fixture-driven tests. */
export function mapSearch(games: readonly RawGame[]): Candidate[] {
  return games.map((game) => ({
    source: SOURCE,
    externalId: String(game.id),
    name: game.name ?? "",
    year: yearOf(game.first_release_date),
    creators: creatorsOf(game.involved_companies ?? []),
    category: categoryOf(game),
    cover: igdbImageUrl(game.cover?.url ?? null),
    editionCount: null,
    sourceRating: game.aggregated_rating ?? null,
    inLibrary: null,
  }));
}

/** The full pull for one game; `facts` omits availability the way `Detail` does — `availability()` fetches that separately. Exported for fixture-driven tests. */
export function mapDetail(game: RawGame, hours: number | null): Detail {
  return {
    name: game.name ?? "",
    year: yearOf(game.first_release_date),
    creators: creatorsOf(game.involved_companies ?? []),
    cover: igdbImageUrl(game.cover?.url ?? null),
    length: hours === null ? null : { hours },
    facts: {
      ...emptyFacts(),
      synopsis: (game.summary ?? "").trim() || null,
      genres: genresOf(game),
      people: peopleOf(game.involved_companies ?? []),
      released: isoDate(game.first_release_date),
      playtime: hours,
      series: seriesOf(game),
      platforms: (game.platforms ?? []).map((platform) => platform.name ?? "").filter(Boolean),
      sourceRating: ratingOf(game),
    },
  };
}

/** Store availability for one game. Exported for fixture-driven tests. */
export function mapAvailability(game: RawGame, region: string): Availability[] {
  return availabilityOf(game, region);
}

function escapeApicalypse(text: string): string {
  return text.replace(/[\\"]/g, "\\$&");
}

/** The `first_release_date` range (UTC epoch seconds, inclusive) that covers one calendar year. */
function yearWhere(year: number): string {
  const start = Math.floor(Date.UTC(year, 0, 1) / 1000);
  const end = Math.floor(Date.UTC(year + 1, 0, 1) / 1000) - 1;
  return `first_release_date >= ${start} & first_release_date <= ${end}`;
}

/** IGDB ids are positive integers; anything else is refused the way the source would refuse it, as an HttpError, not as the source being down. */
function idOf(externalId: string): number {
  const id = Number(externalId);
  if (!/^\d+$/.test(externalId.trim()) || !Number.isInteger(id) || id <= 0) throw new HttpError(`${NAME} refused the request: "${externalId}" is not an IGDB id`, 400, null);
  return id;
}

/** No game at that id: the same HttpError a 404 from TMDB or Open Library produces, so lookup.ts has one not-found vocabulary. */
function notFound(externalId: string): HttpError {
  return new HttpError(`${NAME} refused the request (HTTP 404): no game with id ${externalId}`, 404, null);
}

// ------------------------------------------------------------------ token

/** What `.local/igdb/token.json` holds. */
export type IgdbToken = { accessToken: string; expiresAt: string };

function isToken(value: unknown): value is IgdbToken {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.accessToken === "string" && record.accessToken.length > 0 && typeof record.expiresAt === "string" && !Number.isNaN(Date.parse(record.expiresAt));
}

/** The token file's path for a directory (the default one without an argument). */
export function igdbTokenPath(dir = IGDB_TOKEN_DIR): string {
  return join(dir, "token.json");
}

/** The cached token, or null when there is no file or it is not a token; the access token itself is for the adapter and `life doctor`'s expiry check, never for output. */
export async function readIgdbToken(dir = IGDB_TOKEN_DIR): Promise<IgdbToken | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(igdbTokenPath(dir), "utf8"));
    return isToken(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** True while the token has more than a day left: the adapter refreshes it before that, and `life doctor` reports it the same way. */
export function igdbTokenFresh(token: IgdbToken, now: Date): boolean {
  return Date.parse(token.expiresAt) - now.getTime() > TOKEN_REFRESH_SKEW_MS;
}

/** Write the token file atomically (temp file, then rename), mode 0600 in a 0700 directory. */
async function writeIgdbToken(dir: string, token: IgdbToken): Promise<void> {
  const path = igdbTokenPath(dir);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(token, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } catch (error) {
    await rm(temp).catch(() => {});
    throw error;
  }
}

export type IgdbClock = { now(): Date };

export type IgdbOptions = {
  /** Where LIFE_IGDB_CLIENT_ID and LIFE_IGDB_CLIENT_SECRET are read from, at call time; defaults to process.env with the root .env loaded when they are unset there. */
  env?: CatalogEnv;
  fetch?: FetchLike;
  /** Decides token expiry; the wall clock by default. */
  clock?: IgdbClock;
  timer?: Timer;
  /** Where the Twitch token is cached; defaults to `.local/igdb/` at the repository root. Tests pass a temp directory. */
  dir?: string;
};

/**
 * IGDB, behind Twitch's client-credentials token. `search` and `detail` both
 * hit the `games` endpoint (an Apicalypse POST); `detail` also fetches
 * `game_time_to_beats` for the play length. `availability` re-fetches just the
 * store fields for the region asked. Every one of the adapter's own requests
 * (token included) is sent at least 250 ms after the last, through one lane,
 * so concurrent calls queue rather than burst.
 */
export class IgdbAdapter implements CatalogAdapter {
  readonly source: CatalogSource = SOURCE;
  readonly media: Medium[] = [...MEDIA_BY_SOURCE[SOURCE]];

  #env: CatalogEnv;
  #net: Net;
  #clock: IgdbClock;
  #dir: string;
  #cached: IgdbToken | null = null;
  #refreshing: Promise<string> | null = null;
  #lastAt: number | null = null;
  #lane: Promise<void> = Promise.resolve();

  constructor(opts: IgdbOptions = {}) {
    this.#env = opts.env ?? process.env;
    this.#net = new Net({ fetch: opts.fetch, timer: opts.timer });
    this.#clock = opts.clock ?? { now: () => new Date() };
    this.#dir = opts.dir ?? IGDB_TOKEN_DIR;
  }

  async search(medium: Medium, text: string, opts: { year?: number; signal?: AbortSignal } = {}): Promise<Candidate[]> {
    assertCovers(this, medium);
    throwIfAborted(opts.signal, NAME);
    const clauses = [`search "${escapeApicalypse(text)}"`];
    if (opts.year !== undefined) clauses.push(`where ${yearWhere(opts.year)}`);
    const body = `fields ${FIELDS}; ${clauses.join("; ")}; limit 10;`;
    const games = await this.#call<RawGame[]>(GAMES_URL, body, opts.signal);
    return mapSearch(games.slice(0, 10));
  }

  async detail(medium: Medium, externalId: string, opts: { signal?: AbortSignal } = {}): Promise<Detail> {
    assertCovers(this, medium);
    throwIfAborted(opts.signal, NAME);
    const id = idOf(externalId);
    const games = await this.#call<RawGame[]>(GAMES_URL, `fields ${FIELDS}; where id = ${id};`, opts.signal);
    const game = games[0];
    if (!game) throw notFound(externalId);
    const times = await this.#call<RawPlaytime[]>(PLAYTIME_URL, `fields game_id, normally; where game_id = ${id};`, opts.signal);
    return mapDetail(game, playtimeHours(times[0]));
  }

  async availability(medium: Medium, externalId: string, region: string, opts: { signal?: AbortSignal } = {}): Promise<Availability[]> {
    assertCovers(this, medium);
    throwIfAborted(opts.signal, NAME);
    const id = idOf(externalId);
    const body = `fields external_games.uid, external_games.external_game_source, external_games.category, websites.url, websites.type; where id = ${id};`;
    const games = await this.#call<RawGame[]>(GAMES_URL, body, opts.signal);
    const game = games[0];
    if (!game) throw notFound(externalId);
    return mapAvailability(game, region);
  }

  // ---------------------------------------------------------------- requests

  /** POST an Apicalypse body to `url` with Client-ID and bearer, refreshing the token once on a 401. */
  async #call<T>(url: string, body: string, signal: AbortSignal | undefined): Promise<T> {
    const { clientId } = this.#credentials();
    const token = await this.#ensureToken(signal);
    try {
      return await this.#send<T>(url, body, clientId, token, signal);
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) {
        const fresh = await this.#ensureToken(signal, true);
        return await this.#send<T>(url, body, clientId, fresh, signal);
      }
      throw error;
    }
  }

  async #send<T>(url: string, body: string, clientId: string, token: string, signal: AbortSignal | undefined): Promise<T> {
    await this.#slot(signal);
    return this.#net.fetchJson<T>(url, {
      method: "POST",
      body,
      headers: { "client-id": clientId, authorization: `Bearer ${token}` },
      source: NAME,
      signal,
    });
  }

  /** The Twitch client id and secret, read lazily; the first missing one names the variable. */
  #credentials(): { clientId: string; clientSecret: string } {
    const clientId = requireEnv(this.#env, "LIFE_IGDB_CLIENT_ID");
    const clientSecret = requireEnv(this.#env, "LIFE_IGDB_CLIENT_SECRET");
    return { clientId, clientSecret };
  }

  /**
   * A valid bearer token: the in-memory one, else the cached file, else a
   * fresh one from Twitch; `force` skips straight to a fresh one. Concurrent
   * callers share one refresh, so a burst of first calls costs one token
   * request, not one each.
   */
  async #ensureToken(signal: AbortSignal | undefined, force = false): Promise<string> {
    const now = this.#clock.now();
    if (!force && this.#cached && igdbTokenFresh(this.#cached, now)) return this.#cached.accessToken;
    if (!force) {
      const stored = await readIgdbToken(this.#dir);
      if (stored && igdbTokenFresh(stored, now)) {
        this.#cached = stored;
        return stored.accessToken;
      }
    }
    if (!this.#refreshing) {
      this.#refreshing = this.#refresh(signal, now).finally(() => {
        this.#refreshing = null;
      });
    }
    return this.#refreshing;
  }

  /** One client-credentials request to Twitch, then the token cached in memory and on disk. */
  async #refresh(signal: AbortSignal | undefined, now: Date): Promise<string> {
    const { clientId, clientSecret } = this.#credentials();
    await this.#slot(signal);
    const url = new URL(TOKEN_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("client_secret", clientSecret);
    url.searchParams.set("grant_type", "client_credentials");
    const response = await this.#net.fetchJson<RawTokenResponse>(url.toString(), { method: "POST", source: NAME, signal, secrets: [clientSecret] });
    if (typeof response?.access_token !== "string" || !response.access_token || typeof response.expires_in !== "number") {
      throw new HttpError(`${NAME} refused the request: Twitch answered without an access token`, 502, response);
    }
    const token: IgdbToken = { accessToken: response.access_token, expiresAt: new Date(now.getTime() + response.expires_in * 1000).toISOString() };
    this.#cached = token;
    await writeIgdbToken(this.#dir, token);
    return token.accessToken;
  }

  /**
   * Take the next send slot: wait for every earlier caller's slot, then for
   * the 250 ms floor since the last send, then mark this send's time. The
   * lane is released as soon as the slot is taken, not when the answer
   * arrives, so a slow answer delays nothing but the pacing.
   */
  async #slot(signal: AbortSignal | undefined): Promise<void> {
    const previous = this.#lane;
    let release: () => void = () => {};
    this.#lane = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      const timer = this.#net.timer;
      if (this.#lastAt !== null) {
        const elapsed = timer.now() - this.#lastAt;
        if (elapsed < IGDB_RATE_LIMIT_MS) await this.#net.sleep(IGDB_RATE_LIMIT_MS - elapsed, signal, NAME);
      }
      this.#lastAt = timer.now();
    } finally {
      release();
    }
  }
}
