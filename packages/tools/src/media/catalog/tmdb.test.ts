// tmdb.ts: the pure mapping functions against recorded fixtures (no network),
// then the adapter's request shape (URL, method, headers) through a fake
// fetch, and CatalogUnconfigured when LIFE_TMDB_KEY is unset.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { CatalogUnconfigured } from "./adapter.ts";
import type { FetchLike } from "./net.ts";
import { mapAvailability, mapDetail, mapSearch, TmdbAdapter } from "./tmdb.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures", "tmdb");

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as T;
}

const CONFIG = { baseUrl: "https://image.tmdb.org/t/p/", sizes: ["w92", "w154", "w185", "w342", "w500", "w780", "original"] };

// ------------------------------------------------------------------ mapSearch

test("mapSearch: movie results map name, year, rating, and cover from config", () => {
  const json = fixture<{ results: unknown[] }>("tmdb-movie-search.json");
  const candidates = mapSearch(json as never, "movie", CONFIG);
  assert.equal(candidates.length, 2);
  const [dune2, dune1] = candidates;
  assert.equal(dune2!.source, "tmdb");
  assert.equal(dune2!.externalId, "693134");
  assert.equal(dune2!.name, "Dune: Part Two");
  assert.equal(dune2!.year, 2024);
  assert.equal(dune2!.category, null);
  assert.equal(dune2!.creators.length, 0);
  assert.equal(dune2!.sourceRating, 8.2);
  assert.equal(dune2!.cover, "https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg");
  assert.equal(dune2!.inLibrary, null);
  assert.equal(dune1!.year, 2021);
});

test("mapSearch: show results read name and first_air_date, and cap at 10", () => {
  const json = fixture<{ results: unknown[] }>("tmdb-tv-search.json");
  const [breakingBad] = mapSearch(json as never, "show", CONFIG);
  assert.equal(breakingBad!.name, "Breaking Bad");
  assert.equal(breakingBad!.year, 2008);

  const many = { results: Array.from({ length: 15 }, (_, i) => ({ id: i, name: `Show ${i}`, first_air_date: "2020-01-01" })) };
  assert.equal(mapSearch(many as never, "show", CONFIG).length, 10);
});

test("mapSearch: without a configuration, cover is null rather than throwing", () => {
  const json = fixture<{ results: unknown[] }>("tmdb-movie-search.json");
  const [dune2] = mapSearch(json as never, "movie", null);
  assert.equal(dune2!.cover, null);
});

// ------------------------------------------------------------------ mapDetail: movie

test("mapDetail: movie detail maps directors as creators, cast and crew as people, runtime, and collection as series ordered by release", () => {
  const json = fixture<unknown>("tmdb-movie-detail.json");
  const collection = fixture<unknown>("tmdb-collection.json");
  const detail = mapDetail(json as never, "movie", collection as never, CONFIG);

  assert.equal(detail.name, "Dune: Part Two");
  assert.equal(detail.year, 2024);
  assert.deepEqual(detail.creators, ["Denis Villeneuve"]);
  assert.equal(detail.cover, "https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg");
  assert.deepEqual(detail.length, { minutes: 166 });

  const facts = detail.facts;
  assert.equal(facts.synopsis, "Follow the mythic journey of Paul Atreides as he unites with Chani and the Fremen.");
  assert.deepEqual(facts.genres, ["Science Fiction", "Adventure"]);
  assert.equal(facts.runtime, 166);
  assert.equal(facts.episodes, null);
  assert.equal(facts.released, "2024-02-27");
  assert.equal(facts.language, "English");
  assert.deepEqual(facts.sourceRating, { value: 8.2, scale: 10, count: 6543 });

  // people: directors and writers first, then cast, cast capped at 10 (12 seeded)
  assert.deepEqual(facts.people.slice(0, 2), [
    { role: "Director", name: "Denis Villeneuve" },
    { role: "Writer", name: "Jon Spaihts" },
  ]);
  const castPeople = facts.people.filter((p) => p.role === "Cast");
  assert.equal(castPeople.length, 10);
  assert.equal(castPeople[0]!.name, "Timothée Chalamet");

  // series: collection parts ordered by release_date ascending, position null
  assert.ok(facts.series);
  assert.equal(facts.series!.name, "Dune Collection");
  assert.equal(facts.series!.position, null);
  assert.deepEqual(
    facts.series!.entries.map((e) => e.externalId),
    ["438631", "693134", "1041796"],
  );
  for (const entry of facts.series!.entries) assert.equal(entry.position, null);
});

test("mapDetail: a movie with no belongs_to_collection has no series", () => {
  const json = fixture<Record<string, unknown>>("tmdb-movie-detail.json");
  const solo = { ...json, belongs_to_collection: null };
  const detail = mapDetail(solo as never, "movie", null, CONFIG);
  assert.equal(detail.facts.series, null);
});

// ------------------------------------------------------------------ mapDetail: show

test("mapDetail: show detail maps created_by as creators, seasons/episodes, and runtime from episode_run_time", () => {
  const json = fixture<unknown>("tmdb-tv-detail.json");
  const detail = mapDetail(json as never, "show", null, CONFIG);

  assert.equal(detail.name, "Breaking Bad");
  assert.equal(detail.year, 2008);
  assert.deepEqual(detail.creators, ["Vince Gilligan"]);
  assert.deepEqual(detail.length, { seasons: 5, episodes: 62 });

  const facts = detail.facts;
  assert.deepEqual(facts.episodes, { seasons: 5, episodes: 62 });
  assert.equal(facts.runtime, 45); // episode_run_time[0], ahead of last_episode_to_air
  assert.equal(facts.series, null); // shows have no series (TMDB has no per-show collections)
  assert.deepEqual(facts.people[0], { role: "Creator", name: "Vince Gilligan" });
  assert.ok(facts.people.some((p) => p.role === "Cast" && p.name === "Bryan Cranston"));
});

test("mapDetail: show runtime falls back to last_episode_to_air.runtime with no episode_run_time", () => {
  const json = fixture<Record<string, unknown>>("tmdb-tv-detail.json");
  const noEpisodeRuntime = { ...json, episode_run_time: [] };
  const detail = mapDetail(noEpisodeRuntime as never, "show", null, CONFIG);
  assert.equal(detail.facts.runtime, 55);
});

test("mapDetail: show runtime is null with neither episode_run_time nor last_episode_to_air", () => {
  const json = fixture<Record<string, unknown>>("tmdb-tv-detail.json");
  const bare = { ...json, episode_run_time: [], last_episode_to_air: null };
  const detail = mapDetail(bare as never, "show", null, CONFIG);
  assert.equal(detail.facts.runtime, null);
});

test("mapDetail: a show with zero seasons and episodes reported has a null length", () => {
  const json = fixture<Record<string, unknown>>("tmdb-tv-detail.json");
  const bare = { ...json, number_of_seasons: 0, number_of_episodes: 0 };
  const detail = mapDetail(bare as never, "show", null, CONFIG);
  assert.equal(detail.length, null);
});

// ------------------------------------------------------------------ mapAvailability

test("mapAvailability: flatrate, free, and ads all become stream; rent and buy keep their kind; every row carries the region's link and constructed:false", () => {
  const json = fixture<{ "watch/providers": unknown }>("tmdb-movie-detail.json");
  const rows = mapAvailability(json["watch/providers"] as never, "US");
  const byKind = (kind: string) => rows.filter((r) => r.kind === kind);

  assert.equal(byKind("stream").length, 3); // Max (flatrate), Tubi (free), Freevee (ads)
  assert.ok(byKind("stream").some((r) => r.name === "Max"));
  assert.ok(byKind("stream").some((r) => r.name === "Tubi"));
  assert.ok(byKind("stream").some((r) => r.name === "Freevee"));
  assert.equal(byKind("rent").length, 1);
  assert.equal(byKind("buy").length, 1);
  for (const row of rows) {
    assert.equal(row.url, "https://www.themoviedb.org/movie/693134-dune-part-two/watch?locale=US");
    assert.equal(row.region, "US");
    assert.equal(row.price, null);
    assert.equal(row.constructed, false);
  }
});

test("mapAvailability: a different region reads its own providers and link", () => {
  const json = fixture<{ "watch/providers": unknown }>("tmdb-movie-detail.json");
  const rows = mapAvailability(json["watch/providers"] as never, "GB");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.name, "NOW");
  assert.equal(rows[0]!.url, "https://www.themoviedb.org/movie/693134-dune-part-two/watch?locale=GB");
  assert.equal(rows[0]!.region, "GB");
});

test("mapAvailability: no providers for the region is no rows", () => {
  const json = fixture<{ "watch/providers": unknown }>("tmdb-movie-detail.json");
  assert.deepEqual(mapAvailability(json["watch/providers"] as never, "FR"), []);
  assert.deepEqual(mapAvailability(undefined, "US"), []);
});

// ------------------------------------------------------------------ the adapter: requests

type Call = { url: string; init?: RequestInit };

function fakeFetch(routes: [pattern: string, body: unknown][]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const hit = routes.find(([pattern]) => url.includes(pattern));
    if (!hit) return new Response(JSON.stringify({ status_message: `no fixture route for ${url}` }), { status: 404, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(hit[1]), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetchFn, calls };
}

function headerOf(call: Call, name: string): string | undefined {
  const headers = call.init?.headers as Record<string, string> | undefined;
  return headers?.[name.toLowerCase()];
}

test("adapter: search/movie sends query, year, include_adult, language, and the bearer token", async () => {
  const search = fixture<unknown>("tmdb-movie-search.json");
  const configuration = fixture<unknown>("tmdb-configuration.json");
  const { fetch, calls } = fakeFetch([
    ["/search/movie", search],
    ["/configuration", configuration],
  ]);
  const adapter = new TmdbAdapter({ env: { LIFE_TMDB_KEY: "tok_abc123" }, fetch });

  const candidates = await adapter.search("movie", "Dune", { year: 2024 });
  assert.equal(candidates.length, 2);

  const searchCall = calls.find((c) => c.url.includes("/search/movie"))!;
  assert.match(searchCall.url, /query=Dune/);
  assert.match(searchCall.url, /year=2024/);
  assert.match(searchCall.url, /include_adult=false/);
  assert.match(searchCall.url, /language=en-US/);
  assert.equal(searchCall.init?.method ?? "GET", "GET");
  assert.equal(headerOf(searchCall, "authorization"), "Bearer tok_abc123");
});

test("adapter: search/tv sends first_air_date_year, not include_adult", async () => {
  const search = fixture<unknown>("tmdb-tv-search.json");
  const { fetch, calls } = fakeFetch([
    ["/search/tv", search],
    ["/configuration", { images: { secure_base_url: "https://image.tmdb.org/t/p/", poster_sizes: ["w500"] } }],
  ]);
  const adapter = new TmdbAdapter({ env: { LIFE_TMDB_KEY: "tok" }, fetch });

  await adapter.search("show", "Breaking Bad", { year: 2008 });
  const call = calls.find((c) => c.url.includes("/search/tv"))!;
  assert.match(call.url, /query=Breaking(\+|%20)Bad/);
  assert.match(call.url, /first_air_date_year=2008/);
  assert.doesNotMatch(call.url, /include_adult/);
});

test("adapter: detail fetches movie/{id} with credits and watch/providers, then the collection when one is linked", async () => {
  const movie = fixture<unknown>("tmdb-movie-detail.json");
  const collection = fixture<unknown>("tmdb-collection.json");
  const configuration = fixture<unknown>("tmdb-configuration.json");
  const { fetch, calls } = fakeFetch([
    ["/movie/693134", movie],
    ["/collection/726871", collection],
    ["/configuration", configuration],
  ]);
  const adapter = new TmdbAdapter({ env: { LIFE_TMDB_KEY: "tok" }, fetch });

  const detail = await adapter.detail("movie", "693134");
  assert.equal(detail.name, "Dune: Part Two");
  assert.ok(detail.facts.series);
  assert.equal(detail.facts.series!.entries.length, 3);

  const detailCall = calls.find((c) => c.url.includes("/movie/693134"))!;
  assert.match(detailCall.url, /append_to_response=credits/);
  assert.match(detailCall.url, /watch/);
  assert.ok(calls.some((c) => c.url.includes("/collection/726871")));
  assert.equal(headerOf(detailCall, "authorization"), "Bearer tok");
});

test("adapter: detail fetches tv/{id} and never requests a collection", async () => {
  const show = fixture<unknown>("tmdb-tv-detail.json");
  const { fetch, calls } = fakeFetch([
    ["/tv/1396", show],
    ["/configuration", { images: { secure_base_url: "https://image.tmdb.org/t/p/", poster_sizes: ["w500"] } }],
  ]);
  const adapter = new TmdbAdapter({ env: { LIFE_TMDB_KEY: "tok" }, fetch });

  const detail = await adapter.detail("show", "1396");
  assert.equal(detail.name, "Breaking Bad");
  assert.ok(calls.some((c) => c.url.includes("/tv/1396")));
  assert.ok(!calls.some((c) => c.url.includes("/collection/")));
});

test("adapter: configuration is fetched once per instance and reused across calls", async () => {
  const movie = fixture<unknown>("tmdb-movie-detail.json");
  const configuration = fixture<unknown>("tmdb-configuration.json");
  const { fetch, calls } = fakeFetch([
    ["/movie/693134", { ...(movie as Record<string, unknown>), belongs_to_collection: null }],
    ["/configuration", configuration],
  ]);
  const adapter = new TmdbAdapter({ env: { LIFE_TMDB_KEY: "tok" }, fetch });

  await adapter.detail("movie", "693134");
  await adapter.detail("movie", "693134");
  assert.equal(calls.filter((c) => c.url.includes("/configuration")).length, 1);
});

test("adapter: availability reads watch/providers for the given region", async () => {
  const movie = fixture<unknown>("tmdb-movie-detail.json");
  const { fetch, calls } = fakeFetch([["/movie/693134", movie]]);
  const adapter = new TmdbAdapter({ env: { LIFE_TMDB_KEY: "tok" }, fetch });

  const rows = await adapter.availability("movie", "693134", "GB");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.name, "NOW");
  const call = calls.find((c) => c.url.includes("/movie/693134"))!;
  assert.match(call.url, /watch/);
  assert.doesNotMatch(call.url, /append_to_response=credits/);
});

test("adapter: region defaults to LIFE_REGION, then US", async () => {
  const movie = fixture<unknown>("tmdb-movie-detail.json");
  const { fetch } = fakeFetch([["/movie/693134", movie]]);
  const fromEnv = new TmdbAdapter({ env: { LIFE_TMDB_KEY: "tok", LIFE_REGION: "gb" }, fetch });
  const rows = await fromEnv.availability("movie", "693134", "GB");
  assert.equal(rows[0]!.name, "NOW");

  const defaulted = new TmdbAdapter({ env: { LIFE_TMDB_KEY: "tok" }, fetch });
  const usRows = await defaulted.availability("movie", "693134", "US");
  assert.ok(usRows.some((r) => r.name === "Max"));
});

test("adapter: search on a medium outside `media` throws before any request", async () => {
  const { fetch, calls } = fakeFetch([]);
  const adapter = new TmdbAdapter({ env: { LIFE_TMDB_KEY: "tok" }, fetch });
  await assert.rejects(() => adapter.search("book" as never, "x"), /tmdb does not cover book/);
  assert.equal(calls.length, 0);
});

test("adapter: an already-aborted signal throws before any request", async () => {
  const { fetch, calls } = fakeFetch([]);
  const adapter = new TmdbAdapter({ env: { LIFE_TMDB_KEY: "tok" }, fetch });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => adapter.search("movie", "x", { signal: controller.signal }));
  assert.equal(calls.length, 0);
});

// ------------------------------------------------------------------ CatalogUnconfigured

test("adapter: a missing LIFE_TMDB_KEY throws CatalogUnconfigured naming the variable, only on use", async () => {
  const { fetch } = fakeFetch([]);
  const adapter = new TmdbAdapter({ env: {}, fetch });
  await assert.rejects(
    () => adapter.search("movie", "Dune"),
    (error: unknown) => error instanceof CatalogUnconfigured && error.variable === "LIFE_TMDB_KEY",
  );
});

test("adapter: constructing the adapter with no key does not throw", () => {
  assert.doesNotThrow(() => new TmdbAdapter({ env: {} }));
});
