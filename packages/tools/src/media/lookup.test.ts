// lookup.ts: the two normalizations, the confidence rule and its failure
// messages, the Open Library edition-count rule, the category rule, resolve
// under a budget against FakeCatalog, applying a pull with `edited` and the
// hand-set series honoured, the quiet `pulledAt` stamp on an unchanged
// refresh, and ref resolution by id, name, alias, and substring. The
// operation-level checks (add warns and links, refresh honours edited) run
// against createTestDb() and FakeCatalog; nothing touches the network.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Ctx, Title } from "../contract.ts";
import { createTestDb, fixedClock, type TestDb } from "../db/testing.ts";
import { CatalogUnavailable, CatalogUnconfigured, FakeCatalog, HttpError, type Candidate } from "./catalog/adapter.ts";
import type { Catalogs } from "./catalog/index.ts";
import {
  CONFIDENCE,
  adoptName,
  applyPull,
  findByName,
  judge,
  markInLibrary,
  normalizeLookup,
  pullChanged,
  resolve,
  resolveTitle,
  type CatalogPull,
} from "./lookup.ts";
import { createTitles, type TitleOps, type TitleReceipt } from "./titles.ts";

const clock = fixedClock("2026-09-12T12:00:00Z");
const now = "2026-09-12T12:00:00Z";
const neel: Ctx = { actor: "neel" };

const candidate = (overrides: Partial<Candidate> & { externalId: string; name: string }): Candidate => ({
  source: "tmdb",
  year: null,
  creators: [],
  category: null,
  cover: null,
  editionCount: null,
  sourceRating: null,
  inLibrary: null,
  ...overrides,
});

function fakes(): { catalogs: Catalogs; tmdb: FakeCatalog; openlibrary: FakeCatalog; igdb: FakeCatalog } {
  const tmdb = new FakeCatalog({ source: "tmdb" });
  const openlibrary = new FakeCatalog({ source: "openlibrary" });
  const igdb = new FakeCatalog({ source: "igdb" });
  return { catalogs: { tmdb, openlibrary, igdb }, tmdb, openlibrary, igdb };
}

function okRecord(receipt: TitleReceipt, label = "receipt"): Title {
  assert.equal(receipt.ok, true, `${label}: ${JSON.stringify(receipt)}`);
  if (!receipt.ok) throw new Error("unreachable");
  return receipt.record;
}

const fixture = (overrides: Partial<Title> = {}): Title => ({
  id: "m_fixture001",
  medium: "movie",
  name: "Arrival",
  aliases: [],
  year: 2016,
  creators: [],
  cover: null,
  length: null,
  facts: null,
  catalog: null,
  edited: [],
  series: null,
  status: "curious",
  ownership: "none",
  ownershipDetail: null,
  priority: null,
  moodFit: [],
  timeFit: null,
  notes: null,
  detail: { format: null, platform: null, where: null },
  rating: null,
  review: null,
  liked: false,
  entries: [],
  origin: { actor: "neel", at: now, evidence: [] },
  version: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...overrides,
});

const pullOf = (overrides: Partial<CatalogPull["detail"]> = {}, extra: Partial<CatalogPull> = {}): CatalogPull => ({
  source: "tmdb",
  externalId: "329865",
  detail: {
    name: "Arrival",
    year: 2016,
    creators: ["Denis Villeneuve"],
    cover: "https://image.tmdb.org/t/p/w500/arrival.jpg",
    length: { minutes: 116 },
    facts: {
      synopsis: "A linguist is recruited by the military.",
      genres: ["Drama", "Science Fiction"],
      people: [{ role: "Director", name: "Denis Villeneuve" }],
      released: "2016-11-10",
      runtime: 116,
      pages: null,
      episodes: null,
      playtime: null,
      series: null,
      platforms: [],
      formats: [],
      language: "en",
      links: [],
      sourceRating: { value: 7.6, scale: 10, count: 15000 },
    },
    ...overrides,
  },
  availability: [{ kind: "stream", name: "Paramount+", url: "https://www.justwatch.com/us/movie/arrival", region: "US", price: null, constructed: false }],
  ...extra,
});

// ------------------------------------------------------------------ normalization and the confidence rule

test("normalizeLookup strips punctuation and a leading article; normalizeTitle keeps the article", () => {
  assert.equal(normalizeLookup("The Matrix"), "matrix");
  assert.equal(normalizeLookup("  Fire Emblem: Fortune's Weave! "), "fire emblem fortune s weave");
  assert.equal(normalizeLookup("A Memory Called Empire"), "memory called empire");
  assert.equal(normalizeLookup("An Absolutely Remarkable Thing"), "absolutely remarkable thing");
  assert.equal(normalizeLookup("Another Day"), "another day", "only a whole leading word is an article");
  assert.equal(normalizeLookup("Café Déjà-Vu"), "cafe deja vu");
});

test("judge auto-links a single exact match, names the failed test otherwise", () => {
  const arrival = candidate({ externalId: "1", name: "Arrival", year: 2016 });
  const arrival2 = candidate({ externalId: "2", name: "The Arrival", year: 1996 });
  const other = candidate({ externalId: "3", name: "Arrival of a Train", year: 1896 });

  const one = judge([other, arrival], "arrival");
  assert.ok(one.ok && one.candidate.externalId === "1", "one exact match, no year asked");
  const article = judge([arrival2], "The Arrival");
  assert.ok(article.ok && article.candidate.externalId === "2", "articles are stripped on both sides");

  assert.deepEqual(judge([other], "Arrival"), { ok: false, reason: CONFIDENCE.noExact });
  assert.deepEqual(judge([arrival, arrival2], "Arrival"), { ok: false, reason: CONFIDENCE.several }, "two exact matches without a year");
  const byYear = judge([arrival, arrival2], "Arrival", 2016);
  assert.ok(byYear.ok && byYear.candidate.externalId === "1", "the year picks one of several");
  assert.deepEqual(judge([arrival, arrival2], "Arrival", 2020), { ok: false, reason: CONFIDENCE.year });
  assert.deepEqual(judge([], "Arrival"), { ok: false, reason: CONFIDENCE.noExact });
});

test("judge: a DLC, expansion, remake, or unknown IGDB category never auto-links; main, remaster, and port do; TMDB and Open Library nulls pass", () => {
  const main = candidate({ source: "igdb", externalId: "10", name: "Hades", category: "main" });
  const dlc = candidate({ source: "igdb", externalId: "11", name: "Hades", category: "dlc" });
  const unknown = candidate({ source: "igdb", externalId: "12", name: "Hades", category: null });
  assert.ok(judge([main], "Hades").ok);
  assert.ok(judge([candidate({ source: "igdb", externalId: "13", name: "Hades", category: "remaster" })], "Hades").ok);
  assert.ok(judge([candidate({ source: "igdb", externalId: "14", name: "Hades", category: "port" })], "Hades").ok);
  for (const category of ["dlc", "expansion", "remake", "other"]) {
    const verdict = judge([candidate({ source: "igdb", externalId: "15", name: "Hades", category })], "Hades");
    assert.ok(!verdict.ok && verdict.reason.startsWith(CONFIDENCE.category) && verdict.reason.includes(category), `${category}: ${JSON.stringify(verdict)}`);
  }
  assert.ok(!judge([unknown], "Hades").ok, "IGDB without a category is not proven a main work");
  assert.deepEqual(judge([main, dlc], "Hades"), { ok: false, reason: CONFIDENCE.several }, "the DLC still counts as an exact match, so it is several, not a silent link to the base game");
  assert.ok(judge([candidate({ source: "openlibrary", externalId: "OL1W", name: "Skyward", category: null })], "Skyward").ok, "Open Library never says a category");
});

test("judge: the Open Library edition-count rule needs the top candidate to lead the second by three times", () => {
  const lead = candidate({ source: "openlibrary", externalId: "OL1W", name: "Skyward", editionCount: 30 });
  const dupe = candidate({ source: "openlibrary", externalId: "OL2W", name: "Skyward Flight", editionCount: 10 });
  const close = candidate({ source: "openlibrary", externalId: "OL2W", name: "Skyward Flight", editionCount: 11 });
  assert.ok(judge([lead, dupe], "Skyward").ok, "30 >= 3 * 10");
  assert.deepEqual(judge([lead, close], "Skyward"), { ok: false, reason: CONFIDENCE.editions }, "30 < 3 * 11");
  assert.deepEqual(judge([dupe, lead], "Skyward"), { ok: false, reason: CONFIDENCE.editions }, "the exact match must be the top candidate");
  assert.ok(judge([lead], "Skyward").ok, "alone, no runner-up to lead");
  assert.ok(judge([candidate({ source: "openlibrary", externalId: "OL3W", name: "Skyward", editionCount: null }), candidate({ source: "openlibrary", externalId: "OL4W", name: "Other", editionCount: null })], "Skyward").ok, "unknown counts on both sides do not block");
});

test("markInLibrary fills inLibrary from non-deleted titles linked to the same source and id", () => {
  const linked = fixture({ id: "m_linked0001", catalog: { source: "tmdb", externalId: "1", pulledAt: now } });
  const gone = fixture({ id: "m_linked0002", catalog: { source: "tmdb", externalId: "2", pulledAt: now }, deletedAt: now });
  const otherSource = fixture({ id: "m_linked0003", catalog: { source: "igdb", externalId: "3", pulledAt: now } });
  const marked = markInLibrary([candidate({ externalId: "1", name: "A" }), candidate({ externalId: "2", name: "B" }), candidate({ externalId: "3", name: "C" })], [linked, gone, otherSource]);
  assert.deepEqual(
    marked.map((c) => c.inLibrary),
    ["m_linked0001", null, null],
  );
});

// ------------------------------------------------------------------ resolve

test("resolve: search, confidence, detail, availability under one budget; the candidate rides along", async () => {
  const { catalogs, tmdb } = fakes();
  tmdb.seed("movie", [{ externalId: "329865", name: "Arrival", year: 2016, creators: ["Denis Villeneuve"], availability: [{ kind: "stream", name: "Paramount+", url: "https://jw/arrival", region: "US", price: null, constructed: false }, { kind: "stream", name: "Paramount+", url: "https://jw/arrival", region: "US", price: null, constructed: false }, { kind: "rent", name: "Apple TV", url: "https://tv.apple.com/arrival", region: "GB", price: null, constructed: false }] }]);
  const result = await resolve("movie", "arrival", { catalogs, region: "us" });
  assert.equal(result.outcome, "linked");
  if (result.outcome !== "linked") return;
  assert.equal(result.source, "tmdb");
  assert.equal(result.externalId, "329865");
  assert.equal(result.candidate?.name, "Arrival");
  assert.equal(result.detail.name, "Arrival");
  assert.deepEqual(result.availability.map((row) => row.url), ["https://jw/arrival"], "deduped by URL, region normalized to US");
  assert.deepEqual(tmdb.calls.map((call) => call.method), ["search", "detail", "availability"]);
  const region = tmdb.callsTo("availability")[0]!.region;
  assert.equal(region, "US");
  assert.equal(tmdb.callsTo("search")[0]!.year, null);
});

test("resolve: year mismatch, several exact matches, none, and a given id skip the search", async () => {
  const { catalogs, tmdb } = fakes();
  tmdb.seed("movie", [
    { externalId: "1", name: "Dune", year: 2021 },
    { externalId: "2", name: "Dune", year: 1984 },
  ]);
  const several = await resolve("movie", "Dune", { catalogs });
  assert.equal(several.outcome, "candidates");
  if (several.outcome === "candidates") {
    assert.equal(several.reason, CONFIDENCE.several);
    assert.match(several.message, /2 TMDB candidates for "Dune" \(several exact matches\); pass catalog with one of their ids, or year/);
    assert.equal(several.candidates.length, 2);
  }
  const mismatch = await resolve("movie", "Dune", { catalogs, year: 2000 });
  assert.equal(mismatch.outcome, "candidates");
  if (mismatch.outcome === "candidates") assert.equal(mismatch.reason, CONFIDENCE.year);
  assert.equal(tmdb.callsTo("search").at(-1)!.year, 2000, "the year reaches the source");
  const byYear = await resolve("movie", "Dune", { catalogs, year: 1984 });
  assert.equal(byYear.outcome, "linked");
  if (byYear.outcome === "linked") assert.equal(byYear.externalId, "2");
  const none = await resolve("movie", "Nothing Here", { catalogs });
  assert.deepEqual(none, { outcome: "none", source: "tmdb", message: 'no TMDB match for "Nothing Here"' });
  const calls = tmdb.calls.length;
  const given = await resolve("movie", "whatever", { catalogs, externalId: "2" });
  assert.equal(given.outcome, "linked");
  if (given.outcome === "linked") {
    assert.equal(given.candidate, null);
    assert.equal(given.detail.year, 1984);
  }
  assert.deepEqual(tmdb.calls.slice(calls).map((call) => call.method), ["detail", "availability"], "a given id searches nothing");
});

test("resolve: unconfigured, unavailable, a refused id, and an exhausted budget come back as failures, never throws", async () => {
  const { catalogs, tmdb, igdb } = fakes();
  tmdb.seed("movie", [{ externalId: "1", name: "Arrival", year: 2016 }]);

  tmdb.failNext(new CatalogUnconfigured("LIFE_TMDB_KEY"));
  const unconfigured = await resolve("movie", "Arrival", { catalogs });
  assert.equal(unconfigured.outcome, "failed");
  if (unconfigured.outcome === "failed") {
    assert.equal(unconfigured.failure, "unconfigured");
    assert.equal(unconfigured.message, "LIFE_TMDB_KEY is not set in the root .env");
  }

  tmdb.failNext(new CatalogUnavailable("TMDB is unavailable (HTTP 503): down", 503), "detail");
  const unavailable = await resolve("movie", "Arrival", { catalogs });
  assert.equal(unavailable.outcome, "failed");
  if (unavailable.outcome === "failed") {
    assert.equal(unavailable.failure, "unavailable");
    assert.match(unavailable.message, /HTTP 503/);
  }

  const refused = await resolve("movie", "Arrival", { catalogs, externalId: "999" });
  assert.equal(refused.outcome, "failed");
  if (refused.outcome === "failed") {
    assert.equal(refused.failure, "refused");
    assert.ok(refused.error instanceof HttpError && refused.error.status === 404);
    assert.equal(refused.message, 'no movie with id "999" at TMDB');
  }

  igdb.stallNext("search");
  const budget = await resolve("game", "Hades", { catalogs, budgetMs: 5 });
  assert.equal(budget.outcome, "failed");
  if (budget.outcome === "failed") {
    assert.equal(budget.failure, "budget");
    assert.match(budget.message, /lookup budget ran out/);
  }

  await assert.rejects(async () => {
    tmdb.failNext(new TypeError("a bug"));
    await resolve("movie", "Arrival", { catalogs });
  }, TypeError);
});

// ------------------------------------------------------------------ applying a pull

test("adoptName takes the catalog name when every typed word appears in it and keeps the typed name as an alias", () => {
  assert.deepEqual(adoptName("Fortune's Weave", [], "Fire Emblem: Fortune's Weave"), { name: "Fire Emblem: Fortune's Weave", aliases: ["Fortune's Weave"] });
  assert.deepEqual(adoptName("arrival", [], "Arrival"), { name: "Arrival", aliases: [] }, "a case difference is not an alias");
  assert.deepEqual(adoptName("FE Fortunes Weave", ["FEFW"], "Fire Emblem: Fortune's Weave"), { name: "FE Fortunes Weave", aliases: ["FEFW"] }, "a word the catalog lacks keeps the typed name");
  assert.deepEqual(adoptName("Fortune's Weave", ["fortune's weave", "Fire Emblem Fortune's Weave"], "Fire Emblem: Fortune's Weave"), { name: "Fire Emblem: Fortune's Weave", aliases: ["fortune's weave"] }, "no alias equal to the new name, no repeated alias");
});

test("applyPull writes every factual field not in edited, facts whole, and never the hand-set series; year keeps Neel's when the source has none", () => {
  const pull = pullOf({ facts: { ...pullOf().detail.facts, series: { name: "Arrival Saga", position: 1, entries: [] } } });
  const title = fixture({ name: "arrival", year: 2015, creators: ["Someone"], cover: "https://old", length: { minutes: 1 }, series: { name: "By hand", position: 3 } });
  const applied = applyPull(title, pull, now);
  assert.equal(applied.name, "Arrival");
  assert.equal(applied.year, 2016);
  assert.deepEqual(applied.creators, ["Denis Villeneuve"]);
  assert.equal(applied.cover, "https://image.tmdb.org/t/p/w500/arrival.jpg");
  assert.deepEqual(applied.length, { minutes: 116 });
  assert.deepEqual(applied.series, { name: "By hand", position: 3 }, "the hand-set series wins");
  assert.equal(applied.facts?.series?.name, "Arrival Saga", "the catalog's series lives in facts");
  assert.deepEqual(applied.facts?.availability, pull.availability);
  assert.deepEqual(applied.catalog, { source: "tmdb", externalId: "329865", pulledAt: now });

  const edited = applyPull(fixture({ name: "My Arrival", year: 2015, creators: ["Me"], cover: "https://mine", length: { minutes: 90 }, edited: ["name", "year", "creators", "cover", "length"] }), pull, now);
  assert.equal(edited.name, "My Arrival");
  assert.equal(edited.year, 2015);
  assert.deepEqual(edited.creators, ["Me"]);
  assert.equal(edited.cover, "https://mine");
  assert.deepEqual(edited.length, { minutes: 90 });
  assert.equal(edited.facts?.synopsis, pull.detail.facts.synopsis, "facts are still refreshed");

  const noYear = applyPull(fixture({ year: 2016 }), pullOf({ year: null }), now);
  assert.equal(noYear.year, 2016);
});

test("pullChanged ignores catalog.pulledAt and nothing else", () => {
  const before = applyPull(fixture(), pullOf(), "2026-09-01T00:00:00Z");
  const same = applyPull(before, pullOf(), now);
  assert.equal(pullChanged(before, same), false);
  const cover = applyPull(before, pullOf({ cover: "https://new" }), now);
  assert.equal(pullChanged(before, cover), true);
  const availability = applyPull(before, pullOf({}, { availability: [] }), now);
  assert.equal(pullChanged(before, availability), true);
  assert.equal(pullChanged(fixture(), before), true, "linking for the first time is a change");
});

// ------------------------------------------------------------------ ref resolution (pure part)

test("findByName: exact normalized name, else alias, else case-insensitive substring; each step only when the one before found nothing", () => {
  const skyward = fixture({ id: "m_book000001", medium: "book", name: "Skyward", aliases: ["Sky"] });
  const flight = fixture({ id: "m_book000002", medium: "book", name: "Skyward Flight", aliases: ["Flight"] });
  const sky = fixture({ id: "m_book000003", medium: "book", name: "The Sky Is Everywhere" });
  const titles = [skyward, flight, sky];
  assert.deepEqual(findByName(titles, " skyward ").map((t) => t.id), [skyward.id], "exact beats substring");
  assert.deepEqual(findByName(titles, "sky").map((t) => t.id), [skyward.id], "alias beats substring");
  assert.deepEqual(findByName(titles, "flight").map((t) => t.id), [flight.id]);
  assert.deepEqual(findByName(titles, "SKYWARD F").map((t) => t.id), [flight.id], "substring");
  assert.deepEqual(findByName(titles, "ward").map((t) => t.id), [skyward.id, flight.id], "several substrings");
  assert.deepEqual(findByName(titles, "!!!"), []);
});

// ------------------------------------------------------------------ against the database

let db: TestDb;
let catalogs: ReturnType<typeof fakes>;
let titles: TitleOps;
before(async () => {
  db = await createTestDb();
  catalogs = fakes();
  titles = createTitles(db.store, clock, { catalogs: catalogs.catalogs, region: "US" });
});
after(() => db.drop());

const logCount = () => db.store.read(async (tx) => (await tx.allLog()).length);
const history = (id: string) => db.store.read((tx) => tx.history("title", id));

test("resolveTitle: id (any medium unless scoped), exact name, alias, substring; several is a needs on ref; none names another medium", async () => {
  catalogs.tmdb.seed("movie", [{ externalId: "438631", name: "Dune", year: 2021, creators: ["Denis Villeneuve"] }]);
  const movie = okRecord(await titles.add({ medium: "movie", name: "dune", year: 2021 }, neel));
  assert.equal(movie.name, "Dune", "the catalog name");
  assert.deepEqual(movie.aliases, [], "a case-only difference is not an alias");
  const book = okRecord(await titles.add({ medium: "book", name: "Dune", lookup: false }, neel));
  const messiah = okRecord(await titles.add({ medium: "book", name: "Dune Messiah", lookup: false }, neel));
  okRecord(await titles.update(messiah.id, { aliases: ["DM"] }, neel));

  await db.store.read(async (tx) => {
    const byId = await resolveTitle(tx, movie.id);
    assert.ok(byId.ok && byId.title.id === movie.id);
    const wrongMedium = await resolveTitle(tx, movie.id, { medium: "book" });
    assert.ok(!wrongMedium.ok && wrongMedium.kind === "not_found");
    assert.match(wrongMedium.issues[0]!, /is a movie, not a book; use life movie/);
    const scoped = await resolveTitle(tx, "dune", { medium: "book" });
    assert.ok(scoped.ok && scoped.title.id === book.id, "exact name within the medium");
    const alias = await resolveTitle(tx, "dm", { medium: "book" });
    assert.ok(alias.ok && alias.title.id === messiah.id, "alias");
    const substring = await resolveTitle(tx, "messiah", { medium: "book" });
    assert.ok(substring.ok && substring.title.id === messiah.id, "substring");
    const across = await resolveTitle(tx, "Dune");
    assert.ok(!across.ok && across.kind === "ambiguous", "unscoped, the movie and the book both match exactly");
    if (!across.ok && across.kind === "ambiguous") {
      assert.deepEqual(across.needs.field, "ref");
      assert.deepEqual(new Set(across.needs.options), new Set([movie.id, book.id]));
      assert.equal(across.candidates.length, 2);
      assert.match(across.issues[0]!, /names 2 titles/);
    }
    const elsewhere = await resolveTitle(tx, "Dune Messiah", { medium: "game" });
    assert.ok(!elsewhere.ok && elsewhere.kind === "not_found");
    assert.equal(elsewhere.issues[0], `title: no game "Dune Messiah"; found as book ${messiah.id}; use life book`);
    const nowhere = await resolveTitle(tx, "Hyperion", { medium: "book" });
    assert.ok(!nowhere.ok && nowhere.kind === "not_found");
    assert.equal(nowhere.issues[0], 'title: no book "Hyperion"');
    const blank = await resolveTitle(tx, "   ");
    assert.ok(!blank.ok && blank.issues[0]!.startsWith("ref:"));
  });

  okRecord(await titles.delete(book.id, neel));
  await db.store.read(async (tx) => {
    const deleted = await resolveTitle(tx, book.id);
    assert.ok(!deleted.ok && deleted.kind === "deleted");
    const included = await resolveTitle(tx, book.id, { includeDeleted: true });
    assert.ok(included.ok);
    const byName = await resolveTitle(tx, "dune", { medium: "book" });
    assert.ok(byName.ok && byName.title.id === messiah.id, "names never find deleted titles: the exact match is gone, so the substring step finds Dune Messiah");
  });
});

test("add: auto-link on a single exact match fills the factual fields, facts, and catalog; the year narrows the search", async () => {
  catalogs.tmdb.seed("movie", [
    { externalId: "329865", name: "Arrival", year: 2016, creators: ["Denis Villeneuve"], cover: "https://c/arrival.jpg", length: { minutes: 116 }, facts: { synopsis: "Aliens.", runtime: 116 }, availability: [{ kind: "stream", name: "Paramount+", url: "https://jw/arrival", region: "US", price: null, constructed: false }] },
    { externalId: "1", name: "The Arrival", year: 1996 },
  ]);
  const receipt = await titles.add({ medium: "movie", name: "Arrival", year: 2016 }, neel);
  const title = okRecord(receipt);
  assert.equal(receipt.warnings, undefined);
  assert.deepEqual(title.catalog, { source: "tmdb", externalId: "329865", pulledAt: now });
  assert.equal(title.year, 2016);
  assert.deepEqual(title.creators, ["Denis Villeneuve"]);
  assert.equal(title.cover, "https://c/arrival.jpg");
  assert.deepEqual(title.length, { minutes: 116 });
  assert.equal(title.facts?.synopsis, "Aliens.");
  assert.deepEqual(title.facts?.availability.map((row) => row.name), ["Paramount+"]);
  assert.equal(title.status, "curious");
  assert.deepEqual(title.edited, []);
});

test("add: CatalogUnconfigured, CatalogUnavailable, no match, a bad key, and an exhausted budget create the title without a catalog and warn", async () => {
  catalogs.igdb.seed("game", [{ externalId: "1145360", name: "Hades", year: 2020 }]);

  catalogs.igdb.failNext(new CatalogUnconfigured("LIFE_IGDB_CLIENT_ID"));
  const unconfigured = await titles.add({ medium: "game", name: "Hades" }, neel);
  const hades = okRecord(unconfigured);
  assert.equal(hades.catalog, null);
  assert.equal(hades.facts, null);
  assert.deepEqual(unconfigured.warnings, ["Created without a catalog: LIFE_IGDB_CLIENT_ID is not set in the root .env; run life game refresh <ref> once it is"]);

  catalogs.igdb.failNext(new CatalogUnavailable("IGDB is unavailable (HTTP 503): down", 503));
  const unavailable = await titles.add({ medium: "game", name: "Hades II" }, neel);
  okRecord(unavailable);
  assert.match(unavailable.warnings![0]!, /^Created without a catalog: IGDB is unavailable \(HTTP 503\): down; run life game refresh/);

  const none = await titles.add({ medium: "game", name: "Aniimo" }, neel);
  okRecord(none);
  assert.deepEqual(none.warnings, ['Created without a catalog: no IGDB match for "Aniimo"']);

  catalogs.igdb.failNext(new HttpError("IGDB refused the request (HTTP 401): invalid client", 401, null));
  const badKey = await titles.add({ medium: "game", name: "Celeste" }, neel);
  okRecord(badKey);
  assert.match(badKey.warnings![0]!, /^Created without a catalog: IGDB refused the request \(HTTP 401\)/);

  const short = createTitles(db.store, clock, { catalogs: catalogs.catalogs, region: "US", budgetMs: 5 });
  catalogs.igdb.stallNext("search");
  const exhausted = await short.add({ medium: "game", name: "Tunic" }, neel);
  const tunic = okRecord(exhausted);
  assert.equal(tunic.catalog, null);
  assert.match(exhausted.warnings![0]!, /^Created without a catalog: The 0s lookup budget ran out/);

  for (const id of [hades.id, tunic.id]) assert.equal((await history(id)).length, 1, "created once, warnings never touch the log");
});

test("add: with lookup false nothing is asked; with a catalog id the search is skipped and a wrong id is a rejection, not a warning", async () => {
  const calls = catalogs.tmdb.calls.length;
  okRecord(await titles.add({ medium: "show", name: "Severance", lookup: false }, neel));
  assert.equal(catalogs.tmdb.calls.length, calls, "no call");

  catalogs.tmdb.seed("show", [{ externalId: "95396", name: "Severance", year: 2022, facts: { episodes: { seasons: 2, episodes: 19 } } }]);
  const given = await titles.add({ medium: "show", name: "Severance (Apple)", catalog: "95396", allowDuplicate: true }, neel);
  const severance = okRecord(given);
  assert.equal(severance.catalog?.externalId, "95396");
  assert.equal(severance.name, "Severance (Apple)", "a word the catalog name lacks keeps the typed name");
  assert.deepEqual(catalogs.tmdb.calls.slice(calls).map((call) => call.method), ["detail", "availability"]);

  const wrong = await titles.add({ medium: "show", name: "Nope", catalog: "0" }, neel);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.outcome, "rejected");
  assert.deepEqual(wrong.issues, ['catalog: no show with id "0" at TMDB']);
});

test("refresh honours edited and the hand-set series; an unchanged refresh writes only pulledAt with no log entry or version bump", async () => {
  catalogs.openlibrary.seed("book", [{ externalId: "OL1W", name: "Skyward", year: 2018, creators: ["Brandon Sanderson"], editionCount: 30, cover: "https://covers/1.jpg", facts: { pages: 510 }, length: { pages: 510 } }]);
  const first = await titles.add({ medium: "book", name: "Skyward" }, neel);
  const skyward = okRecord(first);
  assert.equal(skyward.catalog?.externalId, "OL1W");
  assert.equal(skyward.year, 2018);

  const edited = okRecord(await titles.update(skyward.id, { year: 2019, series: { name: "Skyward", position: 1 } }, neel));
  assert.deepEqual(edited.edited, ["year"]);

  // The source changed its mind about the cover and the year; the year is Neel's now.
  catalogs.openlibrary.seed("book", [{ externalId: "OL1W", name: "Skyward", year: 2017, creators: ["Brandon Sanderson"], editionCount: 31, cover: "https://covers/2.jpg", facts: { pages: 510, series: { name: "From the source", position: 9, entries: [] } }, length: { pages: 510 } }]);
  const later = fixedClock("2026-09-13T12:00:00Z");
  const laterOps = createTitles(db.store, later, { catalogs: catalogs.catalogs, region: "US" });
  const refreshed = await laterOps.catalog.refresh("Skyward", neel);
  const after = okRecord(refreshed);
  assert.equal(refreshed.outcome, "updated");
  assert.equal(after.year, 2019, "edited wins");
  assert.equal(after.cover, "https://covers/2.jpg", "not edited, so refreshed");
  assert.deepEqual(after.series, { name: "Skyward", position: 1 }, "the hand-set series wins");
  assert.equal(after.facts?.series?.name, "From the source", "the catalog's series stays in facts");
  assert.equal(after.catalog?.pulledAt, "2026-09-13T12:00:00Z");
  assert.equal(after.version, edited.version + 1);
  const logged = await history(skyward.id);
  assert.deepEqual(logged.map((entry) => entry.op), ["title.add", "title.update", "title.refresh"]);
  assert.ok("cover" in logged[2]!.patch && !("year" in logged[2]!.patch));

  // Nothing changed at the source: unchanged, pulledAt stamped quietly, no log entry, same version.
  const again = fixedClock("2026-09-14T12:00:00Z");
  const againOps = createTitles(db.store, again, { catalogs: catalogs.catalogs, region: "US" });
  const before = await logCount();
  const quiet = await againOps.catalog.refresh(skyward.id, neel);
  assert.equal(quiet.ok, true);
  assert.equal(quiet.outcome, "unchanged");
  assert.equal(await logCount(), before, "no log entry");
  const stored = await titles.get(skyward.id);
  assert.equal(stored?.catalog?.pulledAt, "2026-09-14T12:00:00Z", "pulledAt moved");
  assert.equal(stored?.version, after.version, "no version bump");
  assert.equal(stored?.updatedAt, after.updatedAt, "updatedAt untouched");
  assert.equal(quiet.ok && quiet.record.catalog?.pulledAt, "2026-09-14T12:00:00Z", "the receipt shows the stamped record");
});

test("refresh on a title without a catalog runs the full lookup with add's needs path, then links; source failures are catalog_unavailable rejections", async () => {
  catalogs.igdb.seed("game", [
    { externalId: "1", name: "Celeste", year: 2018, category: "main" },
    { externalId: "2", name: "Celeste", year: 2024, category: "main" },
  ]);
  const celeste = (await titles.list({ medium: "game", text: "celeste", full: true })) as Title[];
  assert.equal(celeste.length, 1);
  const id = celeste[0]!.id;
  assert.equal(celeste[0]!.catalog, null);

  const several = await titles.catalog.refresh(id, neel);
  assert.equal(several.ok, false);
  assert.equal(several.outcome, "rejected");
  if (several.ok || several.outcome !== "rejected") return;
  assert.equal(several.needs?.field, "catalog");
  assert.deepEqual(several.needs?.options, ["1", "2"]);
  assert.match(several.needs!.message, /several exact matches/);
  assert.equal(several.candidateKind, "catalog");
  assert.equal(several.candidates?.length, 2);

  okRecord(await titles.update(id, { year: 2018 }, neel));
  const linked = await titles.catalog.refresh(id, neel);
  const record = okRecord(linked);
  assert.equal(record.catalog?.externalId, "1", "the title's year narrows the lookup");
  assert.equal(record.year, 2018);
  assert.deepEqual(record.edited, ["year"]);

  catalogs.igdb.failNext(new CatalogUnavailable("IGDB is unavailable (HTTP 502): bad gateway", 502));
  const down = await titles.catalog.refresh(id, neel);
  assert.equal(down.ok, false);
  assert.deepEqual(down.issues, ["catalog_unavailable: IGDB is unavailable (HTTP 502): bad gateway"]);

  catalogs.igdb.failNext(new CatalogUnconfigured("LIFE_IGDB_CLIENT_ID"));
  const missing = await titles.catalog.refresh(id, neel);
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.issues, ["catalog: LIFE_IGDB_CLIENT_ID is not set in the root .env"]);

  const nowhere = await titles.catalog.refresh("m_0000000000", neel);
  assert.equal(nowhere.ok, false);
  assert.deepEqual(nowhere.issues, ['title: no title "m_0000000000"']);
});

test("link honours edited, fills the rest, and refuses an id another title already carries", async () => {
  catalogs.tmdb.seed("movie", [{ externalId: "27205", name: "Inception", year: 2010, creators: ["Christopher Nolan"], cover: "https://c/inception.jpg", length: { minutes: 148 } }]);
  const typed = okRecord(await titles.add({ medium: "movie", name: "Inception", lookup: false }, neel));
  okRecord(await titles.update(typed.id, { creators: ["Nolan"] }, neel));
  const linked = await titles.catalog.link(typed.id, "27205", neel);
  const record = okRecord(linked);
  assert.equal(linked.outcome, "updated");
  assert.deepEqual(record.creators, ["Nolan"], "edited");
  assert.equal(record.year, 2010);
  assert.equal(record.cover, "https://c/inception.jpg");
  assert.deepEqual(record.length, { minutes: 148 });
  assert.equal(record.catalog?.externalId, "27205");

  const other = okRecord(await titles.add({ medium: "movie", name: "Inception copy", lookup: false }, neel));
  const clash = await titles.catalog.link(other.id, "27205", neel);
  assert.equal(clash.ok, false);
  assert.match(clash.issues[0]!, new RegExp(`^catalog: tmdb 27205 is already linked to ${typed.id}`));
  const missing = await titles.catalog.link(other.id, "no-such-id", neel);
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.issues, ['catalog: no movie with id "no-such-id" at TMDB']);
});
