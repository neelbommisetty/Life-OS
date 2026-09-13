// Tests for the IGDB adapter (LEISURE / "The catalog adapter" brief). Pure
// mapping (mapSearch, mapDetail, mapAvailability, playtimeHours) is tested
// straight against fixtures with no network at all; the class itself is
// tested with a fake fetch that serves those same fixtures by URL, recording
// every request so the token flow, the 401 retry, the Client-ID header, and
// the 250 ms pacing floor can all be asserted on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CatalogUnconfigured } from "./adapter.ts";
import { FakeTimer, HttpError } from "./net.ts";
import type { FetchLike } from "./net.ts";
import { IGDB_RATE_LIMIT_MS, IgdbAdapter, igdbTokenFresh, igdbTokenPath, mapAvailability, mapDetail, mapSearch, playtimeHours, readIgdbToken } from "./igdb.ts";

const FIXTURES = fileURLToPath(new URL("./fixtures/igdb/", import.meta.url));

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

// ------------------------------------------------------------------ fake fetch

type Sent = { url: string; method: string; headers: Record<string, string>; body: string | null };
type ErrBody = { status: number; body: unknown };
function isErr(value: unknown): value is ErrBody {
  return typeof value === "object" && value !== null && "status" in value && "body" in value;
}

/** Routes a request to the token, games, or game_time_to_beats queue by URL, and records every request sent. */
function fakeFetch(queues: { token?: unknown[]; games?: unknown[]; playtime?: unknown[] } = {}): { fetch: FetchLike; sent: Sent[] } {
  const sent: Sent[] = [];
  const q = { token: [...(queues.token ?? [])], games: [...(queues.games ?? [])], playtime: [...(queues.playtime ?? [])] };
  const fetch: FetchLike = async (input, init) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string> | undefined) ?? {}));
    sent.push({ url, method: init?.method ?? "GET", headers, body: typeof init?.body === "string" ? init.body : null });
    const key = url.startsWith("https://id.twitch.tv") ? "token" : url.includes("game_time_to_beats") ? "playtime" : "games";
    const next = q[key].shift();
    if (next === undefined) throw new Error(`fakeFetch: no ${key} response queued for ${url}`);
    const body = isErr(next) ? next.body : next;
    const status = isErr(next) ? next.status : 200;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch, sent };
}

/** One real macrotask tick, so pending fs and promise work advances. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Drives `work` to completion against a FakeTimer, firing any pacing sleep the adapter scheduled. */
type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function drain<T>(work: Promise<T>, timer: FakeTimer): Promise<T> {
  let state: Settled<T> | null = null;
  work.then(
    (value) => {
      state = { ok: true, value };
    },
    (error: unknown) => {
      state = { ok: false, error };
    },
  );
  while (state === null) {
    await tick();
    timer.advance(1000);
  }
  const settled = state as Settled<T>;
  if (!settled.ok) throw settled.error;
  return settled.value;
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "igdb-test-"));
}

const FRESH_TOKEN = { accessToken: "cached-token", expiresAt: "2099-01-01T00:00:00Z" };

async function seedToken(dir: string): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, "token.json"), JSON.stringify(FRESH_TOKEN), { encoding: "utf8", mode: 0o600 });
}

// ------------------------------------------------------------------ pure mapping

test("mapSearch: name, year, creators (developer only here), category from game_type (0 -> main, 5 -> other), cover rewritten, source rating passed through", () => {
  const raw = fixture("igdb-search.json") as Parameters<typeof mapSearch>[0];
  const candidates = mapSearch(raw);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates[0], {
    source: "igdb",
    externalId: "1942",
    name: "Half-Life 2",
    year: 2005,
    creators: ["Valve"],
    category: "main",
    cover: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1r7f.jpg",
    editionCount: null,
    sourceRating: 89.6667,
    inLibrary: null,
  });
  assert.equal(candidates[1]!.name, "Half-Life 2: Deathmatch Extras Mod");
  assert.equal(candidates[1]!.category, "other", "game_type 5 (mod) is not one of the seven named words, so it falls to other");
  assert.deepEqual(candidates[1]!.creators, []);
  assert.equal(candidates[1]!.sourceRating, null);
  assert.equal(candidates[1]!.cover, null, "no cover in the fixture");
});

test("mapSearch: category falls back to the deprecated `category` field when `game_type` is absent, and is null when neither is present", () => {
  const withCategoryOnly = mapSearch([{ id: 1, name: "X", category: 9 }]);
  assert.equal(withCategoryOnly[0]!.category, "remaster");
  const withNeither = mapSearch([{ id: 2, name: "Y" }]);
  assert.equal(withNeither[0]!.category, null);
});

test("playtimeHours: seconds to hours, rounded to one decimal; null without a row", () => {
  assert.equal(playtimeHours({ game_id: 1942, normally: 36000 }), 10);
  assert.equal(playtimeHours({ game_id: 1942, normally: 5401 }), 1.5);
  assert.equal(playtimeHours(undefined), null);
  assert.equal(playtimeHours({ game_id: 1942, normally: null }), null);
});

test("mapDetail: collection games ordered by first_release_date with position always null, developer credited over publisher, genres+themes merged, platforms, playtime in facts and length.hours, cover rewritten, source rating; facts omit availability the way Detail does", () => {
  const [raw] = fixture("igdb-game.json") as Parameters<typeof mapSearch>[0];
  const hours = playtimeHours((fixture("igdb-playtime.json") as { game_id: number; normally: number }[])[0]);
  assert.equal(hours, 10);
  const detail = mapDetail(raw!, hours);

  assert.equal(detail.name, "Half-Life 2");
  assert.equal(detail.year, 2005);
  assert.deepEqual(detail.creators, ["Valve"], "developer credited; the publisher (Sierra) is not used while a developer exists");
  assert.equal(detail.cover, "https://images.igdb.com/igdb/image/upload/t_cover_big/co1r7f.jpg");
  assert.deepEqual(detail.length, { hours: 10 });

  assert.equal(detail.facts.synopsis, "Return to City 17 in this critically acclaimed sequel.");
  assert.deepEqual(detail.facts.genres, ["Shooter", "Adventure", "Action", "Sci-fi"], "genres then themes, in order");
  assert.deepEqual(
    detail.facts.people,
    [
      { role: "developer", name: "Valve" },
      { role: "publisher", name: "Sierra Entertainment" },
    ],
  );
  assert.equal(detail.facts.released, "2005-11-08");
  assert.equal(detail.facts.playtime, 10);
  assert.deepEqual(detail.facts.platforms, ["PC (Microsoft Windows)", "Xbox 360"]);
  assert.deepEqual(detail.facts.sourceRating, { value: 89.6667, scale: 100, count: 12 });

  assert.ok(detail.facts.series, "the game belongs to a collection");
  assert.equal(detail.facts.series!.name, "Half-Life Collection");
  assert.equal(detail.facts.series!.position, null);
  assert.deepEqual(
    detail.facts.series!.entries.map((entry) => [entry.externalId, entry.name, entry.position]),
    [
      ["1020", "Half-Life", null],
      ["1942", "Half-Life 2", null],
      ["9052", "Half-Life 2: Episode One", null],
    ],
    "ordered by first_release_date regardless of the source order",
  );
  assert.ok(!("availability" in detail.facts), "Detail's facts omit availability; the availability() method fetches that separately");
});

test("mapDetail: no collection, no companies, no cover, no playtime", () => {
  const detail = mapDetail({ id: 1, name: "Bare Game" }, null);
  assert.equal(detail.cover, null);
  assert.equal(detail.length, null);
  assert.equal(detail.facts.playtime, null);
  assert.equal(detail.facts.series, null);
  assert.deepEqual(detail.creators, []);
  assert.deepEqual(detail.facts.people, []);
});

test("mapAvailability: the same store rows mapDetail would put in facts, region-tagged", () => {
  const [raw] = fixture("igdb-game.json") as Parameters<typeof mapSearch>[0];
  const rows = mapAvailability(raw!, "GB");
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.region === "GB" && row.constructed === false));
});

// ------------------------------------------------------------------ the adapter

test("search: POSTs Apicalypse to /v4/games with Client-ID and the cached bearer, and maps the answer", async () => {
  const dir = await tempDir();
  try {
    await seedToken(dir);
    const timer = new FakeTimer();
    const { fetch, sent } = fakeFetch({ games: [fixture("igdb-search.json")] });
    const adapter = new IgdbAdapter({ env: { LIFE_IGDB_CLIENT_ID: "cid", LIFE_IGDB_CLIENT_SECRET: "secret" }, fetch, timer, dir });
    const candidates = await drain(adapter.search("game", "Half-Life 2", { year: 2005 }), timer);
    assert.equal(candidates.length, 2);
    assert.equal(sent.length, 1, "the cached token needed no Twitch call");
    assert.equal(sent[0]!.url, "https://api.igdb.com/v4/games");
    assert.equal(sent[0]!.method, "POST");
    assert.equal(sent[0]!.headers["client-id"], "cid");
    assert.equal(sent[0]!.headers.authorization, "Bearer cached-token");
    assert.match(sent[0]!.body ?? "", /^fields .*game_type.*aggregated_rating_count;/);
    assert.match(sent[0]!.body ?? "", /search "Half-Life 2"/);
    assert.match(sent[0]!.body ?? "", /where first_release_date >= \d+ & first_release_date <= \d+;/);
    assert.match(sent[0]!.body ?? "", /limit 10;$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("detail: fetches the game then game_time_to_beats, both with Client-ID and bearer, at least 250ms apart", async () => {
  const dir = await tempDir();
  try {
    await seedToken(dir);
    const timer = new FakeTimer();
    const { fetch, sent } = fakeFetch({ games: [fixture("igdb-game.json")], playtime: [fixture("igdb-playtime.json")] });
    const adapter = new IgdbAdapter({ env: { LIFE_IGDB_CLIENT_ID: "cid", LIFE_IGDB_CLIENT_SECRET: "secret" }, fetch, timer, dir });
    const detail = await drain(adapter.detail("game", "1942"), timer);
    assert.equal(detail.name, "Half-Life 2");
    assert.deepEqual(detail.length, { hours: 10 });
    assert.equal(sent.length, 2);
    assert.match(sent[0]!.body ?? "", /where id = 1942;$/);
    assert.equal(sent[1]!.url, "https://api.igdb.com/v4/game_time_to_beats");
    assert.match(sent[1]!.body ?? "", /^fields game_id, normally; where game_id = 1942;$/);
    for (const request of sent) {
      assert.equal(request.headers["client-id"], "cid");
      assert.equal(request.headers.authorization, "Bearer cached-token");
    }
    assert.ok(timer.waits.some((ms) => ms > 0 && ms <= 250), "the second request waited for the 250ms floor");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("availability: a lighter query for just the store fields, region-tagged rows", async () => {
  const dir = await tempDir();
  try {
    await seedToken(dir);
    const timer = new FakeTimer();
    const { fetch, sent } = fakeFetch({ games: [fixture("igdb-game.json")] });
    const adapter = new IgdbAdapter({ env: { LIFE_IGDB_CLIENT_ID: "cid", LIFE_IGDB_CLIENT_SECRET: "secret" }, fetch, timer, dir });
    const rows = await drain(adapter.availability("game", "1942", "DE"), timer);
    assert.ok(rows.length > 0);
    assert.ok(rows.every((row) => row.region === "DE"));
    assert.match(sent[0]!.body ?? "", /^fields external_games\.uid, external_games\.external_game_source, external_games\.category, websites\.url, websites\.type, websites\.category; where id = 1942;$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no cached token: fetches one from Twitch with client_id, client_secret, grant_type, and caches it to token.json mode 0600", async () => {
  const dir = await tempDir();
  try {
    const timer = new FakeTimer();
    const { fetch, sent } = fakeFetch({ token: [fixture("igdb-token.json")], games: [fixture("igdb-search.json")] });
    const adapter = new IgdbAdapter({ env: { LIFE_IGDB_CLIENT_ID: "cid", LIFE_IGDB_CLIENT_SECRET: "shh" }, fetch, timer, dir });
    await drain(adapter.search("game", "Half-Life"), timer);
    assert.equal(sent.length, 2);
    const tokenRequest = sent[0]!;
    assert.ok(tokenRequest.url.startsWith("https://id.twitch.tv/oauth2/token?"));
    const params = new URL(tokenRequest.url).searchParams;
    assert.equal(params.get("client_id"), "cid");
    assert.equal(params.get("client_secret"), "shh");
    assert.equal(params.get("grant_type"), "client_credentials");
    assert.equal(sent[1]!.headers.authorization, "Bearer twitch-token-1");

    const stored = JSON.parse(await readFile(join(dir, "token.json"), "utf8")) as { accessToken: string; expiresAt: string };
    assert.equal(stored.accessToken, "twitch-token-1");
    assert.ok(Date.parse(stored.expiresAt) > Date.now(), "expiresAt is in the future");
    const { stat } = await import("node:fs/promises");
    const mode = (await stat(join(dir, "token.json"))).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a 401 on a games request refreshes the token once and retries; the retry succeeds", async () => {
  const dir = await tempDir();
  try {
    await seedToken(dir);
    const timer = new FakeTimer();
    const { fetch, sent } = fakeFetch({
      token: [fixture("igdb-token-refreshed.json")],
      games: [{ status: 401, body: fixture("igdb-unauthorized.json") }, fixture("igdb-search.json")],
    });
    const adapter = new IgdbAdapter({ env: { LIFE_IGDB_CLIENT_ID: "cid", LIFE_IGDB_CLIENT_SECRET: "shh" }, fetch, timer, dir });
    const candidates = await drain(adapter.search("game", "Half-Life"), timer);
    assert.equal(candidates.length, 2, "the retry succeeded and was mapped normally");
    assert.equal(sent.length, 3, "games (401), token refresh, games again");
    assert.equal(sent[0]!.headers.authorization, "Bearer cached-token");
    assert.ok(sent[1]!.url.startsWith("https://id.twitch.tv"));
    assert.equal(sent[2]!.headers.authorization, "Bearer twitch-token-2");

    const stored = JSON.parse(await readFile(join(dir, "token.json"), "utf8")) as { accessToken: string };
    assert.equal(stored.accessToken, "twitch-token-2", "the refreshed token replaced the stale one on disk");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a 401 that persists through the retry surfaces as HttpError, not a silent loop", async () => {
  const dir = await tempDir();
  try {
    await seedToken(dir);
    const timer = new FakeTimer();
    const { fetch } = fakeFetch({
      token: [fixture("igdb-token-refreshed.json")],
      games: [{ status: 401, body: fixture("igdb-unauthorized.json") }, { status: 401, body: fixture("igdb-unauthorized.json") }],
    });
    const adapter = new IgdbAdapter({ env: { LIFE_IGDB_CLIENT_ID: "cid", LIFE_IGDB_CLIENT_SECRET: "shh" }, fetch, timer, dir });
    await assert.rejects(drain(adapter.search("game", "Half-Life"), timer), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal((error as HttpError).status, 401);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing credentials: CatalogUnconfigured names the first missing variable, client id before secret", async () => {
  const dir = await tempDir();
  try {
    const timer = new FakeTimer();
    const { fetch } = fakeFetch();
    const noId = new IgdbAdapter({ env: { LIFE_IGDB_CLIENT_SECRET: "shh" }, fetch, timer, dir });
    await assert.rejects(noId.search("game", "x"), (error: unknown) => {
      assert.ok(error instanceof CatalogUnconfigured);
      assert.equal(error.variable, "LIFE_IGDB_CLIENT_ID");
      return true;
    });
    const noSecret = new IgdbAdapter({ env: { LIFE_IGDB_CLIENT_ID: "cid" }, fetch, timer, dir });
    await assert.rejects(noSecret.search("game", "x"), (error: unknown) => {
      assert.ok(error instanceof CatalogUnconfigured);
      assert.equal(error.variable, "LIFE_IGDB_CLIENT_SECRET");
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a medium this adapter does not cover throws before any request is sent", async () => {
  const dir = await tempDir();
  try {
    await seedToken(dir);
    const timer = new FakeTimer();
    const { fetch, sent } = fakeFetch();
    const adapter = new IgdbAdapter({ env: { LIFE_IGDB_CLIENT_ID: "cid", LIFE_IGDB_CLIENT_SECRET: "shh" }, fetch, timer, dir });
    assert.deepEqual(adapter.media, ["game"]);
    await assert.rejects(adapter.search("book", "x"), /igdb does not cover book/);
    assert.equal(sent.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("detail: no game at that id is an HttpError 404 naming the id, the same not-found the other sources produce, not the source being down", async () => {
  const dir = await tempDir();
  try {
    await seedToken(dir);
    const timer = new FakeTimer();
    const { fetch, sent } = fakeFetch({ games: [[]] });
    const adapter = new IgdbAdapter({ env: { LIFE_IGDB_CLIENT_ID: "cid", LIFE_IGDB_CLIENT_SECRET: "shh" }, fetch, timer, dir });
    await assert.rejects(drain(adapter.detail("game", "404404"), timer), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 404);
      assert.match(error.message, /no game with id 404404/);
      return true;
    });
    await assert.rejects(drain(adapter.detail("game", "not-a-number"), timer), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.match(error.message, /"not-a-number" is not an IGDB id/);
      return true;
    });
    assert.equal(sent.length, 1, "a malformed id is refused before any request");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("concurrent calls go through one lane: every send is at least 250ms after the last, token call included", async () => {
  const dir = await tempDir();
  try {
    const timer = new FakeTimer();
    const { fetch, sent } = fakeFetch({ token: [fixture("igdb-token.json")], games: [fixture("igdb-search.json"), fixture("igdb-search.json"), fixture("igdb-search.json")] });
    const sentAt: number[] = [];
    const stamped: FetchLike = (input, init) => {
      sentAt.push(timer.now());
      return fetch(input, init);
    };
    const adapter = new IgdbAdapter({ env: { LIFE_IGDB_CLIENT_ID: "cid", LIFE_IGDB_CLIENT_SECRET: "shh" }, fetch: stamped, timer, dir });
    const all = Promise.all([adapter.search("game", "a"), adapter.search("game", "b"), adapter.search("game", "c")]);
    const results = await drain(all, timer);
    assert.equal(results.length, 3);
    assert.equal(sent.length, 4, "one token call, then the three searches");
    assert.ok(sent[0]!.url.startsWith("https://id.twitch.tv"));
    assert.deepEqual(
      sent.slice(1).map((request) => /search "(\w)"/.exec(request.body ?? "")?.[1]).sort(),
      ["a", "b", "c"],
      "each caller sends once; asynchronous token-file reads may reorder callers",
    );
    for (let i = 1; i < sentAt.length; i++) assert.ok(sentAt[i]! - sentAt[i - 1]! >= IGDB_RATE_LIMIT_MS, `send ${i} came ${sentAt[i]! - sentAt[i - 1]!}ms after the previous`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readIgdbToken and igdbTokenFresh: the doctor's view of the token file, null for a missing or malformed file, fresh only with more than a day left", async () => {
  const dir = await tempDir();
  try {
    assert.equal(await readIgdbToken(dir), null, "no file yet");
    assert.equal(igdbTokenPath(dir), join(dir, "token.json"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(igdbTokenPath(dir), "{ not json", "utf8");
    assert.equal(await readIgdbToken(dir), null, "unreadable file");
    await writeFile(igdbTokenPath(dir), JSON.stringify({ accessToken: "t", expiresAt: "2026-09-14T12:00:00Z" }), "utf8");
    const token = await readIgdbToken(dir);
    assert.deepEqual(token, { accessToken: "t", expiresAt: "2026-09-14T12:00:00Z" });
    assert.equal(igdbTokenFresh(token!, new Date("2026-09-12T12:00:00Z")), true, "two days left");
    assert.equal(igdbTokenFresh(token!, new Date("2026-09-13T13:00:00Z")), false, "less than a day left counts as stale");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("availability accepts deprecated website categories and prefers the current type", () => {
  const url = "https://store.steampowered.com/app/123";
  const legacy = mapAvailability({ id: 123, websites: [{ category: 13, url }] }, "US");
  const current = mapAvailability({ id: 123, websites: [{ type: 13, category: 1, url }] }, "US");
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0]!.name, "Steam");
  assert.equal(legacy[0]!.url, url);
  assert.deepEqual(current, legacy);
});
