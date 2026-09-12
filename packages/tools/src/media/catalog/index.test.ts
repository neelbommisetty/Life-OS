// index.ts: defaultCatalogs builds the three real adapters without touching
// the environment or the network, each source throws CatalogUnconfigured only
// when asked and only when its key is missing, and catalogFor routes a medium
// to its source. Every fetch here is a fake that refuses to be called.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Medium } from "../../contract.ts";
import { CatalogUnconfigured, FakeCatalog, MEDIA_BY_SOURCE, SOURCE_BY_MEDIUM, type CatalogAdapter } from "./adapter.ts";
import { IgdbAdapter, OpenLibraryAdapter, TmdbAdapter, catalogFor, defaultCatalogs, type Catalogs } from "./index.ts";
import type { FetchLike } from "./net.ts";

/** A fetch that must never be reached; records the attempt so a test can assert on it. */
function noFetch(): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetch: FetchLike = async (input) => {
    calls.push(String(input));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch, calls };
}

test("defaultCatalogs: one real adapter per source, each covering exactly its media, built without reading a variable or sending anything", () => {
  const { fetch, calls } = noFetch();
  const catalogs = defaultCatalogs({ env: {}, fetch });
  assert.deepEqual(Object.keys(catalogs).sort(), ["igdb", "openlibrary", "tmdb"]);
  assert.ok(catalogs.tmdb instanceof TmdbAdapter);
  assert.ok(catalogs.openlibrary instanceof OpenLibraryAdapter);
  assert.ok(catalogs.igdb instanceof IgdbAdapter);
  for (const [source, adapter] of Object.entries(catalogs) as [keyof Catalogs, CatalogAdapter][]) {
    assert.equal(adapter.source, source);
    assert.deepEqual(adapter.media, [...MEDIA_BY_SOURCE[source]]);
  }
  assert.equal(calls.length, 0);
});

test("defaultCatalogs: a source with no key throws CatalogUnconfigured naming its first variable, only when asked, and sends nothing", async () => {
  const { fetch, calls } = noFetch();
  const catalogs = defaultCatalogs({ env: {}, fetch });
  await assert.rejects(catalogs.tmdb.search("movie", "Arrival"), (error: unknown) => error instanceof CatalogUnconfigured && error.variable === "LIFE_TMDB_KEY");
  await assert.rejects(catalogs.tmdb.detail("show", "1396"), (error: unknown) => error instanceof CatalogUnconfigured && error.variable === "LIFE_TMDB_KEY");
  await assert.rejects(catalogs.igdb.search("game", "Hades"), (error: unknown) => error instanceof CatalogUnconfigured && error.variable === "LIFE_IGDB_CLIENT_ID");
  await assert.rejects(catalogs.igdb.availability("game", "1145360", "US"), (error: unknown) => error instanceof CatalogUnconfigured && error.variable === "LIFE_IGDB_CLIENT_ID");
  assert.equal(calls.length, 0, "no request leaves before the key check");
});

test("defaultCatalogs: Open Library needs no key, so it works with an empty environment", async () => {
  const calls: string[] = [];
  const fetch: FetchLike = async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ docs: [{ key: "/works/OL1W", title: "Skyward", author_name: ["Brandon Sanderson"], first_publish_year: 2018, edition_count: 30 }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const catalogs = defaultCatalogs({ env: {}, fetch });
  const candidates = await catalogs.openlibrary.search("book", "Skyward");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.name, "Skyward");
  assert.equal(calls.length, 1);
});

test("defaultCatalogs: the keys are read at call time, so a variable set after construction is seen", async () => {
  const env: Record<string, string | undefined> = {};
  const { fetch, calls } = noFetch();
  const catalogs = defaultCatalogs({ env, fetch });
  await assert.rejects(catalogs.tmdb.search("movie", "Arrival"), CatalogUnconfigured);
  env.LIFE_TMDB_KEY = "tok";
  await catalogs.tmdb.search("movie", "Arrival").catch(() => undefined);
  assert.ok(calls.some((url) => url.includes("/search/movie")), "with the key present the request goes out");
});

test("defaultCatalogs: the IGDB token directory is the option given, so nothing reaches .local/ in tests", async () => {
  const dir = await mkdtemp(join(tmpdir(), "catalogs-test-"));
  try {
    const { fetch, calls } = noFetch();
    const catalogs = defaultCatalogs({ env: { LIFE_IGDB_CLIENT_ID: "cid", LIFE_IGDB_CLIENT_SECRET: "shh" }, fetch, igdbDir: dir });
    // The fake answers `{}` to the token call, which is not a token; the adapter fails on it rather than writing a bad file.
    await assert.rejects(catalogs.igdb.search("game", "Hades"));
    assert.ok(calls[0]!.startsWith("https://id.twitch.tv/oauth2/token"), "the first request is the Twitch token");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("catalogFor routes every medium to its source's adapter, for real and fake sets alike", () => {
  const real = defaultCatalogs({ env: {}, fetch: noFetch().fetch });
  const fakes: Catalogs = { tmdb: new FakeCatalog({ source: "tmdb" }), openlibrary: new FakeCatalog({ source: "openlibrary" }), igdb: new FakeCatalog({ source: "igdb" }) };
  for (const medium of Object.keys(SOURCE_BY_MEDIUM) as Medium[]) {
    assert.equal(catalogFor(real, medium).source, SOURCE_BY_MEDIUM[medium]);
    assert.ok(catalogFor(real, medium).media.includes(medium));
    assert.equal(catalogFor(fakes, medium).source, SOURCE_BY_MEDIUM[medium]);
  }
});
