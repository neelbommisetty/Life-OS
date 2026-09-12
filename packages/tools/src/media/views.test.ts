// views.ts against createTestDb() and FakeCatalog: summaries by default and
// full records on request; now's order; backlog's startable rule and its
// filters, wanted-again included; buy with the lowest price; the shelf's four
// buckets; the diary newest first without unknown dates and clipped by
// since/until; time by ISO week with clipping, spend by kind, and the unplaced
// count; year at any known precision with the again count; the wide search;
// list --text over aliases; and the input each view refuses.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Ctx, Title, TitleSummary } from "../contract.ts";
import type { Clock } from "../core.ts";
import { createTestDb, fixedClock, type TestDb } from "../db/testing.ts";
import { FakeCatalog } from "./catalog/adapter.ts";
import type { Catalogs } from "./catalog/index.ts";
import { parseOn } from "./on.ts";
import { createTitles, type TitleOps, type TitleReceipt } from "./titles.ts";
import { BUY_KINDS, DEFAULT_TIME_WEEKS, MAX_TIME_WEEKS, createMediaViews, lowestPrice, type MediaViews, type ViewTitle } from "./views.ts";

// 2026-09-12T12:00Z is 05:00 in Los Angeles, so today is 2026-09-12 (a Saturday; its ISO week is 2026-09-07 to 2026-09-13).
const clock = fixedClock("2026-09-12T12:00:00Z");
const neel: Ctx = { actor: "neel" };

// Writes go through a clock that steps a minute per call, so "newest first by `at`" is observable; the views read today from the fixed clock.
let tick = Date.parse("2026-09-12T12:00:00Z");
const stepping: Clock = { now: () => new Date(tick), timezone: "America/Los_Angeles" };
const step = (): void => {
  tick += 60_000;
};

const on = (text: string) => {
  const parsed = parseOn(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.on;
};

let db: TestDb;
let tmdb: FakeCatalog;
let catalogs: Catalogs;
let titles: TitleOps;
let views: MediaViews;

function okRecord(receipt: TitleReceipt, label = "receipt"): Title {
  assert.equal(receipt.ok, true, `${label}: ${JSON.stringify(receipt)}`);
  if (!receipt.ok) throw new Error("unreachable");
  return receipt.record;
}

/** A fixture title with no lookup; every write steps the clock afterwards. */
async function mk(medium: Title["medium"], name: string, extra: Record<string, unknown> = {}): Promise<Title> {
  const title = okRecord(await titles.add({ medium, name, lookup: false, allowDuplicate: true, ...extra }, neel), name);
  step();
  return title;
}

/** One entry op, stepping the clock afterwards. */
async function log(run: () => Promise<TitleReceipt>, label: string): Promise<Title> {
  const record = okRecord(await run(), label);
  step();
  return record;
}

const ids = (rows: ViewTitle[]): string[] => rows.map((row) => row.id);
const isSummary = (row: ViewTitle): row is TitleSummary => !("entries" in row);
const SUMMARY_KEYS = ["id", "medium", "name", "year", "status", "ownership", "priority", "rating", "liked", "timeFit", "moodFit", "lastEntry"];

// The fixture set. Only the `time` fixtures carry minutes or spend; only the `year` fixtures are books with finishes in 2026.
let alpha: Title; // game, active, started first
let beta: Title; // game, active, started second, progressed last
let gamma: Title; // game, paused
let ownedGame: Title; // backlog, owned, low-energy, short, priority now
let onNetflix: Title; // movie linked to tmdb, backlog, service, availability names Netflix
let toBuy: Title; // movie linked to tmdb, backlog, ownership none, availability with prices
let bare: Title; // movie, backlog, ownership none, no catalog
let noticed: Title; // game, curious
let replay: Title; // game, done in 2024 with a priority: wanted again
let doneQuiet: Title; // game, done in 2024, no priority
let audio: Title; // book, backlog, owned, wanted format audiobook
let shelfDone: Title; // movie, owned, done 2023
let shelfActive: Title; // movie, owned, active
let shelfPaused: Title; // movie, owned, paused
let shelfWanted: Title; // movie, owned, backlog
let shelfBought: Title; // movie, owned, curious (bought, never wanted)
let shelfDropped: Title; // movie, owned, dropped
let timeGame: Title;
let timeShow: Title;
let yearA: Title;
let yearB: Title;
let yearC: Title;
let yearD: Title;
let yearE: Title;
let yearF: Title;
let yearG: Title;
let searchable: Title; // show with a distinctive note, review, alias, creator, and notes
let gone: Title; // deleted show with the same distinctive words

before(async () => {
  db = await createTestDb();
  tmdb = new FakeCatalog({ source: "tmdb" });
  catalogs = { tmdb, openlibrary: new FakeCatalog({ source: "openlibrary" }), igdb: new FakeCatalog({ source: "igdb" }) };
  titles = createTitles(db.store, stepping, { catalogs, region: "US" });
  views = createMediaViews(db.store, clock, titles);

  // now
  alpha = await mk("game", "Alpha Quest", { started: true });
  beta = await mk("game", "Beta Quest", { started: true });
  gamma = await mk("game", "Gamma Quest", { started: true });
  gamma = await log(() => titles.pause(gamma.id, {}, neel), "pause gamma");

  // backlog and buy
  ownedGame = await mk("game", "Owned Backlog Game", { want: true, priority: "now", moodFit: ["low-energy"], timeFit: "short", detail: { platform: "Switch 2" } });
  ownedGame = await log(() => titles.buy(ownedGame.id, { where: "Nintendo eShop" }, neel), "buy owned game");
  tmdb.seed("movie", [
    {
      externalId: "1001",
      name: "Streaming Somewhere",
      year: 2024,
      creators: ["Some Director"],
      availability: [
        { kind: "stream", name: "Netflix", url: "https://netflix.example/1001", region: "US", price: null, constructed: false },
        { kind: "buy", name: "Apple TV", url: "https://tv.apple.example/1001", region: "US", price: { amount: 14.99, currency: "USD" }, constructed: false },
      ],
    },
    {
      externalId: "1002",
      name: "Priced Everywhere",
      year: 2025,
      creators: ["Another Director"],
      availability: [
        { kind: "stream", name: "Hulu", url: "https://hulu.example/1002", region: "US", price: null, constructed: false },
        { kind: "rent", name: "Apple TV", url: "https://tv.apple.example/1002", region: "US", price: { amount: 3.99, currency: "USD" }, constructed: false },
        { kind: "buy", name: "Amazon", url: "https://amazon.example/1002", region: "US", price: { amount: 14.99, currency: "USD" }, constructed: false },
        { kind: "buy", name: "Vudu", url: "https://vudu.example/1002", region: "US", price: { amount: 9.99, currency: "USD" }, constructed: false },
        { kind: "rent", name: "Elsewhere", url: "https://elsewhere.example/1002", region: "DE", price: { amount: 0.99, currency: "EUR" }, constructed: false },
      ],
    },
  ]);
  onNetflix = okRecord(await titles.add({ medium: "movie", name: "Streaming Somewhere", want: true, priority: "soon" }, neel), "add Streaming Somewhere");
  step();
  onNetflix = await log(() => titles.service(onNetflix.id, { where: "Netflix" }, neel), "service onNetflix");
  toBuy = okRecord(await titles.add({ medium: "movie", name: "Priced Everywhere", want: true, priority: "now" }, neel), "add Priced Everywhere");
  step();
  bare = await mk("movie", "Bare Backlog Movie", { want: true });
  noticed = await mk("game", "Merely Noticed");
  replay = await mk("game", "Replay Me", { finished: { on: on("2024-05-01"), rating: 5 }, priority: "later", moodFit: ["comfort"] });
  doneQuiet = await mk("game", "Done And Quiet", { finished: { on: on("2024-06-01") } });
  audio = await mk("book", "Audio Backlog Book", { want: true, detail: { format: "audiobook" } });
  audio = await log(() => titles.buy(audio.id, { where: "Audible" }, neel), "buy audio");

  // shelf: every one bought, in every progress state
  shelfDone = await mk("movie", "Shelf Done", { finished: { on: on("2023-01-01") } });
  shelfDone = await log(() => titles.buy(shelfDone.id, {}, neel), "buy shelfDone");
  shelfActive = await mk("movie", "Shelf Active", { started: true });
  shelfActive = await log(() => titles.buy(shelfActive.id, {}, neel), "buy shelfActive");
  shelfPaused = await mk("movie", "Shelf Paused", { started: true });
  await log(() => titles.pause(shelfPaused.id, {}, neel), "pause shelfPaused");
  shelfPaused = await log(() => titles.buy(shelfPaused.id, {}, neel), "buy shelfPaused");
  shelfWanted = await mk("movie", "Shelf Wanted", { want: true });
  shelfWanted = await log(() => titles.buy(shelfWanted.id, {}, neel), "buy shelfWanted");
  shelfBought = await mk("movie", "Shelf Bought");
  shelfBought = await log(() => titles.buy(shelfBought.id, {}, neel), "buy shelfBought");
  shelfDropped = await mk("movie", "Shelf Dropped", { started: { on: on("2023-02-01") } });
  await log(() => titles.drop(shelfDropped.id, { text: "not for me", on: on("2023-02-02") }, neel), "drop shelfDropped");
  shelfDropped = await log(() => titles.buy(shelfDropped.id, {}, neel), "buy shelfDropped");

  // time: the only fixtures with minutes or spend
  timeGame = await mk("game", "Time Game", { started: { on: on("2026-09-08"), minutes: 120, progress: "first sitting" } });
  await log(() => titles.progress(timeGame.id, { on: on("2026-09-10"), minutes: 60, progress: "second sitting" }, neel), "progress 09-10");
  await log(() => titles.progress(timeGame.id, { on: on("2026-08"), minutes: 100, progress: "some time in August" }, neel), "progress August");
  await log(() => titles.progress(timeGame.id, { on: on("?"), minutes: 10, progress: "once", text: "who knows when" }, neel), "progress unknown");
  await log(() => titles.progress(timeGame.id, { on: on("2026-01-05"), minutes: 999, progress: "long before the range" }, neel), "progress January");
  await log(() => titles.progress(timeGame.id, { on: on("2025"), minutes: 5, progress: "last year" }, neel), "progress 2025");
  await log(() => titles.buy(timeGame.id, { on: on("2026-09-09"), where: "Nintendo eShop", spend: { amount: 59.99, currency: "USD", kind: "purchase" } }, neel), "buy purchase");
  await log(() => titles.buy(timeGame.id, { on: on("2026-09-11"), spend: { amount: 4.99, currency: "USD", kind: "iap" } }, neel), "buy iap");
  timeShow = await mk("show", "Time Show", { started: { on: on("2026-09-02"), minutes: 45, progress: "S1E1" } });
  await log(() => titles.progress(timeShow.id, { on: on("2026-09-07~w"), minutes: 30, progress: "S1E2" }, neel), "progress week");
  await log(() => titles.buy(timeShow.id, { on: on("2026-09-03"), spend: { amount: 3.99, currency: "EUR", kind: "rental" } }, neel), "buy rental");

  // year: books only
  yearA = await mk("book", "Year Book A", { finished: { on: on("2026-03-15"), rating: 4, text: "solid" } });
  yearB = await mk("book", "Year Book B", { finished: { on: on("2026-06-10~w"), rating: 5 } });
  yearC = await mk("book", "Year Book C", { finished: { on: on("2026-02") } });
  yearD = await mk("book", "Year Book D", { finished: { on: on("2026"), rating: 3 } });
  yearE = await mk("book", "Year Book E", { seenBefore: true, finished: { on: on("2026-08-01"), rating: 4 } });
  yearF = await mk("book", "Year Book F", { finished: { on: on("2025-12-31"), rating: 1 } });
  yearG = await mk("book", "Year Book G", { want: true, started: { on: on("2026-04-01") } });
  yearG = await log(() => titles.drop(yearG.id, { text: "boring", rating: 1, on: on("2026-04-20") }, neel), "drop yearG");

  // search
  searchable = await mk("show", "Searchable Show", { notes: "Standing zebrafish note", started: true });
  await log(() => titles.update(searchable.id, { aliases: ["Sechs"], creators: ["Quokka Director"] }, neel), "update searchable");
  await log(() => titles.note(searchable.id, { text: "the pangolin episode was great" }, neel), "note searchable");
  searchable = await log(() => titles.finish(searchable.id, { text: "an axolotl of a finale", rating: 4 }, neel), "finish searchable");
  gone = await mk("show", "Gone Zebrafish Show", { notes: "pangolin axolotl quokka" });
  gone = await log(() => titles.delete(gone.id, neel), "delete gone");
});
after(() => db.drop());

// ------------------------------------------------------------------ summaries and full

test("views return summaries by default and full records with full", async () => {
  const rows = await views.now("game");
  assert.ok(rows.length >= 3);
  for (const row of rows) {
    assert.ok(isSummary(row), "a summary has no entries");
    assert.deepEqual(Object.keys(row), SUMMARY_KEYS);
  }
  const full = await views.now("game", { full: true });
  assert.deepEqual(ids(full), ids(rows), "the same titles in the same order");
  for (const row of full) {
    assert.ok(!isSummary(row));
    assert.ok(Array.isArray(row.entries) && row.entries.length >= 1);
  }
  const alphaRow = rows.find((row) => row.id === alpha.id);
  assert.ok(alphaRow && isSummary(alphaRow));
  assert.deepEqual(alphaRow.lastEntry, { type: "start", on: on("2026-09-12"), text: null });

  assert.ok(isSummary((await views.curious())[0]!));
  assert.ok(!isSummary((await views.curious(undefined, { full: true }))[0]!));
  assert.ok(isSummary((await views.backlog())[0]!));
  assert.ok(!isSummary((await views.backlog(undefined, { full: true }))[0]!));
  assert.ok(isSummary((await views.buy())[0]!.title));
  assert.ok(!isSummary((await views.buy(undefined, { full: true }))[0]!.title));
  assert.ok(isSummary((await views.shelf("movie")).done[0]!));
  assert.ok(!isSummary((await views.shelf("movie", { full: true })).done[0]!));
  assert.ok(isSummary((await views.year(2026, "book")).finished[0]!.title));
  assert.ok(!isSummary((await views.year(2026, "book", { full: true })).finished[0]!.title));
  assert.ok(isSummary((await views.search("zebrafish"))[0]!));
  assert.ok(!isSummary((await views.search("zebrafish", { full: true }))[0]!));
});

// ------------------------------------------------------------------ now

test("now lists active then paused titles, each group by the last entry's at, newest first", async () => {
  const mine = new Set([alpha.id, beta.id, gamma.id]);
  const before = ids(await views.now("game")).filter((id) => mine.has(id));
  assert.deepEqual(before, [beta.id, alpha.id, gamma.id], "beta started after alpha; gamma is paused and last");

  await log(() => titles.progress(alpha.id, { progress: "level 3" }, neel), "progress alpha");
  const after = ids(await views.now("game")).filter((id) => mine.has(id));
  assert.deepEqual(after, [alpha.id, beta.id, gamma.id], "the newest entry moves alpha up; paused still last");

  const everywhere = await views.now();
  assert.ok(everywhere.some((row) => row.id === shelfActive.id) && everywhere.some((row) => row.id === shelfPaused.id), "no medium: every medium");
  for (const row of everywhere) assert.ok(row.status === "active" || row.status === "paused", `${row.name} is ${row.status}`);
  const statuses = everywhere.map((row) => row.status);
  assert.equal(statuses.lastIndexOf("active") < statuses.indexOf("paused") || !statuses.includes("paused"), true, "every active before every paused");
  assert.ok(!everywhere.some((row) => row.id === ownedGame.id), "backlog is not now");
});

// ------------------------------------------------------------------ curious

test("curious lists curious titles only, newest first", async () => {
  const rows = await views.curious("game");
  assert.ok(rows.some((row) => row.id === noticed.id));
  for (const row of rows) assert.equal(row.status, "curious");
  assert.ok(!rows.some((row) => row.id === ownedGame.id), "wanted titles are not curious");

  const movies = await views.curious("movie");
  assert.deepEqual(ids(movies), [shelfBought.id], "bought but never wanted is still curious");
  const all = await views.curious(undefined, { full: true }) as Title[];
  for (let i = 1; i < all.length; i += 1) assert.ok(all[i - 1]!.createdAt >= all[i]!.createdAt, "newest first");
});

// ------------------------------------------------------------------ backlog

test("backlog is backlog titles he can start (ownership not none), plus done titles with a priority when wantedAgain; filters narrow it; priority then name", async () => {
  const games = await views.backlog("game");
  assert.deepEqual(ids(games), [ownedGame.id], "ownership none, curious, and done are out");

  const again = await views.backlog("game", { wantedAgain: true });
  assert.deepEqual(ids(again), [ownedGame.id, replay.id], "a done title with a priority joins when asked; one without stays out");
  assert.ok(!ids(again).includes(doneQuiet.id));

  assert.deepEqual(ids(await views.backlog("game", { mood: "low-energy" })), [ownedGame.id]);
  assert.deepEqual(ids(await views.backlog("game", { mood: "comfort" })), []);
  assert.deepEqual(ids(await views.backlog("game", { mood: "comfort", wantedAgain: true })), [replay.id], "filters apply to the wanted-again titles too");
  assert.deepEqual(ids(await views.backlog("game", { fit: "short" })), [ownedGame.id]);
  assert.deepEqual(ids(await views.backlog("game", { fit: "long" })), []);
  assert.deepEqual(ids(await views.backlog("book", { format: "audiobook" })), [audio.id]);
  assert.deepEqual(ids(await views.backlog("book", { format: "kindle" })), []);
  assert.deepEqual(ids(await views.backlog("movie", { service: "netflix" })), [onNetflix.id], "service matches facts.availability names, case-insensitively");
  assert.deepEqual(ids(await views.backlog("movie", { service: "Hulu" })), [], "Priced Everywhere is on Hulu but not startable (ownership none)");
  assert.deepEqual(ids(await views.backlog(undefined, { service: "flix" })), [onNetflix.id], "a substring is enough");

  const all = await views.backlog();
  const expected = [ownedGame.id, audio.id, shelfWanted.id, onNetflix.id];
  assert.deepEqual(ids(all).filter((id) => expected.includes(id)), [ownedGame.id, onNetflix.id, audio.id, shelfWanted.id], "priority (now, soon, none) then name");
  assert.ok(!ids(all).includes(bare.id) && !ids(all).includes(toBuy.id), "ownership none is the buy list's");
});

// ------------------------------------------------------------------ buy

test("buy lists backlog titles with ownership none, each with the ways to get it and the lowest price", async () => {
  const rows = await views.buy("movie");
  assert.deepEqual(rows.map((row) => row.title.id), [toBuy.id, bare.id], "priority now before none");

  const priced = rows[0]!;
  assert.deepEqual(priced.availability.map((row) => `${row.kind}:${row.name}`), ["rent:Apple TV", "buy:Amazon", "buy:Vudu"], "stream is not a way to get it; the DE row was never pulled for US");
  for (const row of priced.availability) assert.ok(BUY_KINDS.includes(row.kind));
  assert.deepEqual(priced.lowestPrice, { amount: 3.99, currency: "USD" });

  const plain = rows[1]!;
  assert.deepEqual(plain.availability, [], "no catalog: nothing listed");
  assert.equal(plain.lowestPrice, null);

  assert.deepEqual((await views.buy()).map((row) => row.title.id).filter((id) => [toBuy.id, bare.id, ownedGame.id, onNetflix.id].includes(id)), [toBuy.id, bare.id], "owned and on-service titles are not to buy");
  assert.equal(lowestPrice([]), null);
  assert.deepEqual(lowestPrice([{ kind: "buy", name: "A", url: "u", region: "US", price: { amount: 5, currency: "USD" }, constructed: false }, { kind: "rent", name: "B", url: "v", region: "US", price: null, constructed: true }]), { amount: 5, currency: "USD" });
});

// ------------------------------------------------------------------ shelf

test("shelf groups owned titles into done, inProgress, untouched, and dropped", async () => {
  const shelf = await views.shelf("movie");
  assert.deepEqual(Object.keys(shelf), ["done", "inProgress", "untouched", "dropped"]);
  assert.deepEqual(ids(shelf.done), [shelfDone.id]);
  assert.deepEqual(ids(shelf.inProgress), [shelfActive.id, shelfPaused.id], "active before paused, like list");
  assert.deepEqual(ids(shelf.untouched), [shelfWanted.id, shelfBought.id], "backlog before curious, like list");
  assert.deepEqual(ids(shelf.dropped), [shelfDropped.id]);
  for (const bucket of Object.values(shelf)) for (const row of bucket) assert.equal(row.ownership, "owned");

  const all = await views.shelf();
  assert.ok(ids(all.untouched).includes(ownedGame.id) && ids(all.untouched).includes(audio.id), "every medium without one");
  assert.ok(!ids(all.untouched).includes(onNetflix.id), "on a service is not owned");
  assert.ok(!ids(all.untouched).includes(bare.id), "ownership none is not owned");
  const shows = await views.shelf("show");
  assert.deepEqual([ids(shows.done), ids(shows.inProgress), ids(shows.untouched), ids(shows.dropped)], [[], [timeShow.id], [], []], "a rental is a buy entry, so Time Show is owned and active");
  assert.deepEqual(await views.shelf("book", { full: true }), { done: [], inProgress: [], untouched: [await titles.get(audio.id)], dropped: [] });
});

// ------------------------------------------------------------------ diary

test("diary lists entries across titles newest first by on then at, tagged with their title, unknown dates excluded, clipped by since and until, cut by limit", async () => {
  const mine = new Set([timeGame.id, timeShow.id]);
  const all = (await views.diary()).entries.filter((entry) => mine.has(entry.titleId));
  assert.deepEqual(
    all.map((entry) => `${entry.type}@${entry.on.date}/${entry.on.precision}`),
    ["buy@2026-09-11/day", "progress@2026-09-10/day", "buy@2026-09-09/day", "start@2026-09-08/day", "progress@2026-09-07/week", "buy@2026-09-03/day", "start@2026-09-02/day", "progress@2026-08/month", "progress@2026-01-05/day", "progress@2025/year"],
    "newest first; a week sorts by its Monday; the unknown entry is gone",
  );
  const first = all[0]!;
  assert.equal(first.titleId, timeGame.id);
  assert.equal(first.titleName, "Time Game");
  assert.equal(first.medium, "game");
  assert.equal(first.spend?.kind, "iap");
  assert.ok(!all.some((entry) => entry.on.precision === "unknown"));

  const shows = (await views.diary({ medium: "show" })).entries.filter((entry) => mine.has(entry.titleId));
  assert.deepEqual(shows.map((entry) => entry.on.date), ["2026-09-07", "2026-09-03", "2026-09-02"]);

  const september = (await views.diary({ since: on("2026-09") })).entries.filter((entry) => mine.has(entry.titleId));
  assert.deepEqual(september.map((entry) => entry.on.date), ["2026-09-11", "2026-09-10", "2026-09-09", "2026-09-08", "2026-09-07", "2026-09-03", "2026-09-02"]);
  const window = (await views.diary({ since: on("2026-09-08"), until: on("2026-09-10") })).entries.filter((entry) => mine.has(entry.titleId));
  assert.deepEqual(window.map((entry) => entry.on.date), ["2026-09-10", "2026-09-09", "2026-09-08", "2026-09-07"], "the week entry overlaps the window, so it is in");
  const august = (await views.diary({ until: on("2026-08") })).entries.filter((entry) => mine.has(entry.titleId));
  assert.deepEqual(august.map((entry) => entry.on.date), ["2026-08", "2026-01-05", "2025"]);
  const limited = await views.diary({ medium: "game", limit: 2 });
  assert.equal(limited.entries.length, 2);
  assert.deepEqual(limited.entries.map((e) => e.on.date), (await views.diary({ medium: "game" })).entries.slice(0, 2).map((e) => e.on.date));

  // Same day: the later `at` first; the same `at` falls to the diary order reversed.
  const sameDay = (await views.diary({ medium: "game", since: on("2026-09-12"), until: on("2026-09-12") })).entries;
  for (let i = 1; i < sameDay.length; i += 1) assert.ok(sameDay[i - 1]!.at >= sameDay[i]!.at, "newest at first on one day");

  await assert.rejects(views.diary({ since: on("?") }), /diary: since.*unknown date cannot bound/i);
  await assert.rejects(views.diary({ since: on("2026-09-10"), until: on("2026-09-01") }), /diary: since: 2026-09-10 is after until 2026-09-01/);
  await assert.rejects(views.diary({ limit: 0 }), /diary: limit/);
  await assert.rejects(views.diary({ medium: "podcast" as unknown as "book" }), /diary: medium/);
});

// ------------------------------------------------------------------ time

test("time buckets minutes by medium and spend by currency and kind into ISO weeks, the last 8 by default, with the titles and the unplaced count", async () => {
  const view = await views.time();
  assert.equal(view.from, "2026-07-20", "8 weeks back from the current week's Monday");
  assert.equal(view.to, "2026-09-13", "the current week's Sunday");
  assert.equal(view.weeks.length, DEFAULT_TIME_WEEKS);
  assert.deepEqual(view.weeks.map((week) => week.from), ["2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07"]);
  assert.deepEqual(view.weeks.map((week) => week.to), ["2026-07-26", "2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23", "2026-08-30", "2026-09-06", "2026-09-13"]);

  const current = view.weeks[7]!;
  assert.deepEqual(current.minutes, { show: 30, game: 180 }, "medium order; the week-precision show entry lands in its week");
  assert.deepEqual(current.spend, { USD: { purchase: 59.99, iap: 4.99, rental: 0 } });
  assert.deepEqual(current.titles, [{ id: timeGame.id, name: "Time Game", minutes: 180 }, { id: timeShow.id, name: "Time Show", minutes: 30 }]);
  const previous = view.weeks[6]!;
  assert.deepEqual(previous.minutes, { show: 45 });
  assert.deepEqual(previous.spend, { EUR: { purchase: 0, iap: 0, rental: 3.99 } });
  assert.deepEqual(previous.titles, [{ id: timeShow.id, name: "Time Show", minutes: 45 }]);
  for (const week of view.weeks.slice(0, 6)) assert.deepEqual(week, { from: week.from, to: week.to, minutes: {}, spend: {}, titles: [] });

  assert.deepEqual(view.total.minutes, { show: 75, game: 180 });
  assert.deepEqual(view.total.spend, { EUR: { purchase: 0, iap: 0, rental: 3.99 }, USD: { purchase: 59.99, iap: 4.99, rental: 0 } }, "currencies alphabetical");
  assert.deepEqual(view.total.titles, [{ id: timeGame.id, name: "Time Game", minutes: 180 }, { id: timeShow.id, name: "Time Show", minutes: 75 }]);
  assert.equal(view.unplaced, 2, "the August (month) entry and the unknown one; January and 2025 are outside the range");

  const games = await views.time({ medium: "game" });
  assert.deepEqual(games.total.minutes, { game: 180 });
  assert.deepEqual(games.total.spend, { USD: { purchase: 59.99, iap: 4.99, rental: 0 } });
  assert.equal(games.unplaced, 2);
  const shows = await views.time({ medium: "show" });
  assert.deepEqual(shows.total.minutes, { show: 75 });
  assert.equal(shows.unplaced, 0);
});

test("time clips the range to since and until so a month is answerable; total sums the clipped range; unplaced counts what may fall in it", async () => {
  const month = await views.time({ since: on("2026-09") });
  assert.equal(month.from, "2026-09-01");
  assert.equal(month.to, "2026-09-13", "to the end of the current week");
  assert.deepEqual(month.weeks.map((week) => [week.from, week.to]), [["2026-09-01", "2026-09-06"], ["2026-09-07", "2026-09-13"]], "the first week is clipped");
  assert.deepEqual(month.weeks[0]!.minutes, { show: 45 });
  assert.deepEqual(month.total.minutes, { show: 75, game: 180 });
  assert.equal(month.unplaced, 1, "August no longer overlaps; the unknown entry always might");

  const window = await views.time({ since: on("2026-09-08"), until: on("2026-09-10") });
  assert.deepEqual([window.from, window.to], ["2026-09-08", "2026-09-10"]);
  assert.equal(window.weeks.length, 1);
  assert.deepEqual(window.weeks[0]!.minutes, { show: 30, game: 180 }, "day entries inside the window; the week entry's week is the bucket, so it counts whole");
  assert.deepEqual(window.weeks[0]!.spend, { USD: { purchase: 59.99, iap: 0, rental: 0 } }, "the iap on the 11th is outside");
  const { from: _from, to: _to, ...clipped } = window.weeks[0]!;
  assert.deepEqual(window.total, clipped, "total is the sum over the clipped range");
  assert.equal(window.unplaced, 1);

  const until = await views.time({ until: on("2026-09-06"), weeks: 2 });
  assert.deepEqual([until.from, until.to], ["2026-08-24", "2026-09-06"]);
  assert.deepEqual(until.weeks.map((week) => [week.from, week.to]), [["2026-08-24", "2026-08-30"], ["2026-08-31", "2026-09-06"]]);
  assert.deepEqual(until.total.minutes, { show: 45 });
  assert.equal(until.unplaced, 2, "August overlaps again; the unknown entry too");

  const year = await views.time({ since: on("2026"), until: on("2026-01") });
  assert.deepEqual([year.from, year.to], ["2026-01-01", "2026-01-31"]);
  assert.deepEqual(year.total.minutes, { game: 999 });
  assert.equal(year.unplaced, 1);

  const future = await views.time({ since: on("2027-01-05") });
  assert.deepEqual([future.from, future.to], ["2027-01-05", "2027-01-10"], "a since after today covers its own week");

  await assert.rejects(views.time({ weeks: 0 }), /time: weeks/);
  await assert.rejects(views.time({ weeks: MAX_TIME_WEEKS + 1 }), /time: weeks/);
  await assert.rejects(views.time({ until: on("?") }), /time: until.*unknown date cannot bound/i);
  await assert.rejects(views.time({ since: on("2026-09-10"), until: on("2026-09-01") }), /time: since: 2026-09-10 is after until 2026-09-01/);
});

// ------------------------------------------------------------------ year

test("year places finishes and drops by their on's year at any precision but unknown, counts rewatches as again, and averages ratings by medium", async () => {
  const view = await views.year(2026, "book");
  assert.equal(view.year, 2026);
  assert.deepEqual(
    view.finished.map((item) => `${item.title.name} ${item.entry.on.date ?? "?"}`),
    ["Year Book D 2026", "Year Book C 2026-02", "Year Book A 2026-03-15", "Year Book B 2026-06-08", "Year Book E 2026-08-01"],
    "oldest first; year, month, week, and day precision all place; the coarser first on a shared start",
  );
  assert.ok(!view.finished.some((item) => item.title.id === yearF.id), "2025 is not 2026");
  assert.ok(!view.finished.some((item) => item.entry.on.precision === "unknown"), "the seen-before finish has no year");
  assert.deepEqual(view.dropped.map((item) => [item.title.id, item.entry.type, item.entry.text]), [[yearG.id, "drop", "boring"]]);
  assert.equal(view.again, 1, "Year Book E had a finish before this one");
  assert.deepEqual(view.byMedium, { book: { count: 5, avgRating: 4 } }, "(4 + 5 + 3 + 4) / 4 over the rated finishes; C is unrated");
  assert.ok(!("titleId" in view.finished[0]!.entry), "the entry is the entry, not a diary row");
  for (const id of [yearA.id, yearB.id, yearC.id, yearD.id, yearE.id]) assert.ok(view.finished.some((item) => item.title.id === id));

  const last = await views.year(2025, "book");
  assert.deepEqual(last.finished.map((item) => item.title.id), [yearF.id]);
  assert.deepEqual(last.byMedium, { book: { count: 1, avgRating: 1 } });
  assert.equal(last.again, 0);

  const none = await views.year(1999);
  assert.deepEqual(none, { year: 1999, finished: [], dropped: [], again: 0, byMedium: {} });

  const all = await views.year(2026);
  assert.ok(all.byMedium.show?.count === 1, "Searchable Show finished today");
  assert.ok(all.byMedium.book?.count === 5);
  await assert.rejects(views.year(0), /year: year/);
  await assert.rejects(views.year(2026.5), /year: year/);
  await assert.rejects(views.year(2026, "album" as unknown as "book"), /year: medium/);
});

// ------------------------------------------------------------------ search

test("search matches name, aliases, creators, notes, review, and any entry text, case-insensitively, over non-deleted titles of any status", async () => {
  assert.deepEqual(ids(await views.search("searchable")), [searchable.id], "name");
  assert.deepEqual(ids(await views.search("SECHS")), [searchable.id], "alias");
  assert.deepEqual(ids(await views.search("quokka")), [searchable.id], "creator; the deleted show with the word in its notes stays out");
  assert.deepEqual(ids(await views.search("zebrafish")), [searchable.id], "notes");
  assert.deepEqual(ids(await views.search("axolotl")), [searchable.id], "the review, which is the finish entry's text");
  assert.deepEqual(ids(await views.search("pangolin")), [searchable.id], "a note entry's text");
  assert.deepEqual(ids(await views.search("who knows when")), [timeGame.id], "a progress entry's text");
  assert.deepEqual(ids(await views.search("boring")), [yearG.id], "a dropped title is found: search is wide");
  assert.deepEqual(ids(await views.search("nothing matches this")), []);
  assert.ok(ids(await views.search("Year Book")).length === 7, "sorted like list");
  await assert.rejects(views.search("   "), /search: text is required/);
});

// ------------------------------------------------------------------ list --text over aliases

test("list --text matches aliases as well as names and creators, and nothing else", async () => {
  const dpt = await mk("movie", "Alias Bearing Movie");
  await log(() => titles.update(dpt.id, { aliases: ["ABM"], creators: ["Wombat Director"] }, neel), "alias");
  await log(() => titles.note(dpt.id, { text: "a capybara remark" }, neel), "note");
  assert.deepEqual(ids(await titles.list({ text: "abm" })), [dpt.id], "alias, case-insensitively");
  assert.deepEqual(ids(await titles.list({ text: "wombat" })), [dpt.id], "creator");
  assert.deepEqual(ids(await titles.list({ text: "alias bearing" })), [dpt.id], "name");
  assert.deepEqual(ids(await titles.list({ text: "capybara" })), [], "entry text is search's, not list's");
  assert.deepEqual(ids(await views.search("capybara")), [dpt.id]);
});

// ------------------------------------------------------------------ series and refusals

test("series reads through the title operations; a bad medium is refused by every view", async () => {
  assert.equal(await views.series(alpha.id), null, "not in a series");
  assert.equal(await views.series("no such title"), null);
  const first = await mk("book", "Beware of Chicken 1");
  await log(() => titles.update(first.id, { series: { name: "Beware of Chicken", position: 1 } }, neel), "series 1");
  const second = await mk("book", "Beware of Chicken 2");
  await log(() => titles.update(second.id, { series: { name: "Beware of Chicken", position: 2 } }, neel), "series 2");
  const series = await views.series(first.id);
  assert.deepEqual(series, await titles.series(first.id));
  assert.deepEqual(series?.entries.map((entry) => entry.title?.id), [first.id, second.id]);

  const bad = "vinyl" as unknown as "book";
  await assert.rejects(views.now(bad), /now: medium/);
  await assert.rejects(views.curious(bad), /curious: medium/);
  await assert.rejects(views.backlog(bad), /backlog: medium/);
  await assert.rejects(views.buy(bad), /buy: medium/);
  await assert.rejects(views.shelf(bad), /shelf: medium/);
  await assert.rejects(views.backlog("game", { mood: "sleepy" as unknown as "comfort" }), /backlog: mood/);
  await assert.rejects(views.backlog("game", { service: "" }), /backlog: service/);
  await assert.rejects(views.now("game", { full: "yes" as unknown as boolean }), /now: full/);
});
