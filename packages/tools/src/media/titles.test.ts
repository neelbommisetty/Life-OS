// titles.ts against createTestDb() and FakeCatalog: refs by id, name, alias,
// and substring with the needs and the other-medium hint; add with its three
// steps and the composed diary; the entry operations judged by allowed with
// their warnings; again --finished and finish --queue-next in one transaction;
// the corrections; the take; the catalog operations including name adoption on
// link, unlink, availability over the backlog; series and next; merge, delete,
// restore, history. Every mutation is checked against the log: once per
// change, nothing for unchanged, nothing for a warning.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Ctx, Title, TitleSummary } from "../contract.ts";
import { ITEM_KEY_SEPARATOR } from "../core.ts";
import { createTestDb, fixedClock, type TestDb } from "../db/testing.ts";
import { CatalogUnavailable, CatalogUnconfigured, FakeCatalog } from "./catalog/adapter.ts";
import type { Catalogs } from "./catalog/index.ts";
import { cycles } from "./derive.ts";
import { parseOn } from "./on.ts";
import { STATUS_ORDER, createTitles, findDuplicateTitles, nextOf, seriesOf, sortTitles, summarize, type TitleOps, type TitleReceipt } from "./titles.ts";

// 2026-09-12T12:00Z is 05:00 in Los Angeles, so today is 2026-09-12 (a Saturday; the ISO week starts 2026-09-07).
const clock = fixedClock("2026-09-12T12:00:00Z");
const now = "2026-09-12T12:00:00Z";
const today = { date: "2026-09-12", precision: "day" as const };
const neel: Ctx = { actor: "neel" };
const codex: Ctx = { actor: "codex", evidence: ['chat:2026-09-12 "finished it"'] };

const on = (text: string) => {
  const parsed = parseOn(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.on;
};

let db: TestDb;
let tmdb: FakeCatalog;
let openlibrary: FakeCatalog;
let igdb: FakeCatalog;
let catalogs: Catalogs;
let titles: TitleOps;
before(async () => {
  db = await createTestDb();
  tmdb = new FakeCatalog({ source: "tmdb" });
  openlibrary = new FakeCatalog({ source: "openlibrary" });
  igdb = new FakeCatalog({ source: "igdb" });
  catalogs = { tmdb, openlibrary, igdb };
  titles = createTitles(db.store, clock, { catalogs, region: "US" });
});
after(() => db.drop());

function okRecord(receipt: TitleReceipt, label = "receipt"): Title {
  assert.equal(receipt.ok, true, `${label}: ${JSON.stringify(receipt)}`);
  if (!receipt.ok) throw new Error("unreachable");
  return receipt.record;
}

function rejectedWith(receipt: TitleReceipt, pattern: RegExp): Extract<TitleReceipt, { outcome: "rejected" }> {
  assert.equal(receipt.ok, false, JSON.stringify(receipt));
  assert.equal(receipt.outcome, "rejected", JSON.stringify(receipt));
  assert.match(receipt.issues.join("\n"), pattern);
  return receipt as Extract<TitleReceipt, { outcome: "rejected" }>;
}

function duplicateOf(receipt: TitleReceipt): Extract<TitleReceipt, { outcome: "duplicate" }> {
  assert.equal(receipt.ok, false, JSON.stringify(receipt));
  assert.equal(receipt.outcome, "duplicate", JSON.stringify(receipt));
  return receipt as Extract<TitleReceipt, { outcome: "duplicate" }>;
}

/** A fixture title with no lookup; `allowDuplicate` keeps fixtures from tripping the duplicate check across tests. */
const mk = async (medium: Title["medium"], name: string, extra: Record<string, unknown> = {}, ctx: Ctx = neel): Promise<Title> =>
  okRecord(await titles.add({ medium, name, lookup: false, allowDuplicate: true, ...extra }, ctx), name);
const history = (id: string) => db.store.read((tx) => tx.history("title", id));
const ops = async (id: string) => (await history(id)).map((e) => e.op);
const logCount = () => db.store.read(async (tx) => (await tx.allLog()).length);
const types = (title: Title): string[] => title.entries.map((e) => e.type);
const get = async (id: string): Promise<Title> => {
  const title = await titles.get(id);
  assert.ok(title, `title ${id} exists`);
  return title;
};

// ------------------------------------------------------------------ refs

test("refs: id, exact name, alias, substring; ambiguous is a needs on ref with title candidates; another medium is named in the hint", async () => {
  const book = await mk("book", "Skyward", { detail: { format: "audiobook" } });
  const flight = await mk("book", "Skyward Flight");
  okRecord(await titles.update(flight.id, { aliases: ["SF"] }, neel));
  const games = titles.scoped("game");
  const books = titles.scoped("book");

  assert.equal((await titles.get(book.id))?.id, book.id);
  assert.equal((await books.get("skyward"))?.id, book.id, "exact normalized name");
  assert.equal((await books.get("sf"))?.id, flight.id, "alias");
  assert.equal((await books.get("ward fl"))?.id, flight.id, "substring");
  assert.equal(await books.get("Hyperion"), null);
  await assert.rejects(books.get("ward"), /get: ref: "ward" names 2 books/);
  assert.equal(await games.get(book.id), null, "an id of another medium is not this group's");

  const ambiguous = await books.start("ward", {}, neel);
  const rejection = rejectedWith(ambiguous, /"ward" names 2 books/);
  assert.equal(rejection.needs?.field, "ref");
  assert.deepEqual(new Set(rejection.needs?.options), new Set([book.id, flight.id]));
  assert.equal(rejection.candidateKind, "title");
  assert.deepEqual(new Set((rejection.candidates as Title[]).map((t) => t.id)), new Set([book.id, flight.id]));

  const elsewhere = rejectedWith(await games.start("Skyward", {}, neel), /no game "Skyward"; found as book m_[a-z0-9]{10}; use life book/);
  assert.equal(elsewhere.candidates, undefined);
  rejectedWith(await books.start(book.id + "x", {}, neel), /no book "m_/);
  rejectedWith(await titles.start("   ", {}, neel), /^ref: /);

  const resolved = await titles.resolve("ward", { medium: "book" });
  assert.ok(!resolved.ok && resolved.kind === "ambiguous" && resolved.candidates.length === 2);
  const found = await books.resolve("sf");
  assert.ok(found.ok && found.title.id === flight.id);
});

// ------------------------------------------------------------------ add

test("add: curious by default; want, started, finished, liked compose the diary; a book's detail.format becomes the entry's format; finished alone is a cycle of one", async () => {
  const curious = await mk("game", "Aniimo", {}, codex);
  assert.equal(curious.status, "curious");
  assert.deepEqual(curious.entries, []);
  assert.deepEqual(curious.origin, { actor: "codex", at: now, evidence: codex.evidence });
  assert.deepEqual(await ops(curious.id), ["title.add"]);

  const wanted = await mk("game", "Fire Emblem: Fortune's Weave", { want: true, priority: "soon", detail: { platform: "Switch 2" } });
  assert.equal(wanted.status, "backlog");
  assert.deepEqual(types(wanted), ["want"]);
  assert.deepEqual(wanted.entries[0]!.on, today);
  assert.equal(wanted.priority, "soon");
  assert.equal(wanted.detail.platform, "Switch 2");

  const started = await mk("book", "Starsight", { started: { progress: "chapter 3", minutes: 40 }, detail: { format: "audiobook" } });
  assert.equal(started.status, "active");
  assert.deepEqual(types(started), ["start"]);
  assert.equal(started.entries[0]!.format, "audiobook", "the wanted format is the entry's format");
  assert.equal(started.entries[0]!.progress, "chapter 3");
  assert.equal(started.entries[0]!.minutes, 40);

  const finished = await mk("movie", "Korean Kanakaraju", { finished: { on: on("2026-09-11"), rating: 2, text: "A novel idea, but a very bad movie." }, liked: false });
  assert.equal(finished.status, "done");
  assert.equal(finished.rating, 2);
  assert.equal(finished.review, "A novel idea, but a very bad movie.");
  assert.deepEqual(finished.entries[0]!.on, on("2026-09-11"));
  const one = cycles(finished.entries);
  assert.equal(one.length, 1);
  assert.equal(one[0]!.opened, null);

  const both = await mk("book", "Skyward", { want: true, started: { on: on("2026-09-10") }, finished: { on: on("2026-09-12"), rating: 4.5 }, liked: true, detail: { format: "audiobook" } });
  assert.deepEqual(types(both), ["want", "start", "finish"]);
  assert.equal(both.status, "done");
  assert.equal(both.liked, true);
  assert.equal(both.rating, 4.5);
  assert.equal(cycles(both.entries)[0]!.format, "audiobook");
  assert.deepEqual(await ops(both.id), ["title.add"], "one log entry for the whole add");

  const literal = await mk("movie", "Literal true", { started: true });
  assert.deepEqual(types(literal), ["start"]);
  assert.deepEqual(literal.entries[0]!.on, today);

  rejectedWith(await titles.add({ medium: "book", name: "Bad", lookup: false, detail: { platform: "Switch" } }, neel), /detail\.platform: A book has no platform/);
  rejectedWith(await titles.add({ medium: "game", name: "Bad", lookup: false, want: true, started: { rating: 5 } }, neel), /start: rating: Only a finish or drop carries a rating/);
  rejectedWith(await titles.add({ medium: "game", name: "Bad", lookup: false }, { actor: "nobody" }), /actor/);
});

test("add: seenBefore writes a finish dated as given (default ?) before the others; a start after it is an again", async () => {
  const rewatch = await mk("movie", "Arrival", { seenBefore: true, finished: { rating: 5, text: "still a 5" }, liked: true });
  assert.deepEqual(types(rewatch), ["finish", "finish"]);
  assert.deepEqual(rewatch.entries[0]!.on, { date: null, precision: "unknown" });
  assert.deepEqual(rewatch.entries[1]!.on, today);
  assert.equal(rewatch.status, "done");
  assert.equal(rewatch.rating, 5);
  assert.equal(cycles(rewatch.entries).length, 2, "two cycles of one");

  const replaying = await mk("game", "Hades", { seenBefore: on("2021"), started: { on: on("2026-09-10") } });
  assert.deepEqual(types(replaying), ["finish", "again"]);
  assert.deepEqual(replaying.entries[0]!.on, on("2021"));
  assert.equal(replaying.status, "active");
});

test("add: the name duplicate check runs in a read before any lookup, by name or alias, unless allowDuplicate; the external id check runs in the transaction", async () => {
  tmdb.seed("movie", [{ externalId: "27205", name: "Inception", year: 2010, creators: ["Christopher Nolan"] }]);
  const first = okRecord(await titles.add({ medium: "movie", name: "Inception" }, neel));
  assert.equal(first.catalog?.externalId, "27205");
  const searches = tmdb.callsTo("search").length;

  const dup = duplicateOf(await titles.add({ medium: "movie", name: "  inception " }, neel));
  assert.deepEqual(dup.candidates.map((t) => t.id), [first.id]);
  assert.equal(dup.candidateKind, "title");
  assert.match(dup.issues[0]!, /pass allowDuplicate/);
  assert.equal(tmdb.callsTo("search").length, searches, "no lookup was spent on a duplicate");
  assert.equal((await mk("movie", "Inception", { lookup: false })).medium, "movie", "allowDuplicate adds anyway");

  okRecord(await titles.update(first.id, { aliases: ["That Nolan dream one"] }, neel));
  duplicateOf(await titles.add({ medium: "movie", name: "that nolan dream one" }, neel));
  assert.equal((await titles.add({ medium: "book", name: "Inception", lookup: false }, neel)).ok, true, "another medium is not a duplicate");

  // Same work under another spelling: the search links it to 27205, which the first title already carries.
  const byId = duplicateOf(await titles.add({ medium: "movie", name: "Inception (2010)", catalog: "27205" }, neel));
  assert.deepEqual(byId.candidates.map((t) => t.id), [first.id]);
  assert.match(byId.issues[0]!, /already linked to tmdb 27205/);
  assert.equal(byId.candidateKind, "title");
  assert.deepEqual(findDuplicateTitles("inception", [first], "movie").map((t) => t.id), [first.id]);
  assert.deepEqual(findDuplicateTitles("inception", [{ ...first, deletedAt: now }], "movie"), []);
});

// ------------------------------------------------------------------ entries

test("entry ops: allowed judges the current state and rejects with the hint; progress and note on a title he is not on warn", async () => {
  const title = await mk("game", "Celeste");
  const before = await logCount();

  const noted = await titles.note(title.id, { text: "looks lovely" }, codex);
  okRecord(noted);
  assert.deepEqual(noted.warnings, ["title is curious; use start if he is on it"]);
  rejectedWith(await titles.progress(title.id, {}, neel), /^progress: Required/);
  rejectedWith(await titles.note(title.id, {}, neel), /^text: Required/);
  rejectedWith(await titles.drop(title.id, { text: "meh" }, neel), /^drop: title is curious; never wanted; use delete to dismiss$/);
  rejectedWith(await titles.pause(title.id, {}, neel), /^pause: title is curious; not active$/);
  rejectedWith(await titles.resume(title.id, {}, neel), /^resume: title is curious; not paused; use start$/);
  rejectedWith(await titles.again(title.id, {}, neel), /^again: title is curious; not finished; use start$/);
  rejectedWith(await titles.return(title.id, {}, neel), /^return: ownership is none; nothing to return$/);

  okRecord(await titles.want(title.id, {}, neel));
  rejectedWith(await titles.want(title.id, {}, neel), /^want: title is backlog; already wanted; use start$/);
  const started = await titles.start(title.id, { progress: "2 hours in", minutes: 120, text: "first sitting" }, neel);
  const active = okRecord(started);
  assert.equal(active.status, "active");
  assert.equal(started.warnings, undefined);
  const entry = active.entries.at(-1)!;
  assert.equal(entry.progress, "2 hours in");
  assert.equal(entry.minutes, 120);
  assert.equal(entry.text, "first sitting");
  assert.deepEqual(entry.evidence, [], "no evidence given");
  rejectedWith(await titles.start(title.id, {}, neel), /^start: title is active; already active$/);
  const progressed = await titles.progress(title.id, { progress: "chapter 4" }, codex);
  assert.equal(progressed.warnings, undefined, "active: no warning");
  assert.deepEqual(okRecord(progressed).entries.at(-1)!.evidence, codex.evidence, "the ctx evidence lands on the entry when the input gives none");
  okRecord(await titles.pause(title.id, {}, neel));
  rejectedWith(await titles.pause(title.id, {}, neel), /^pause: title is paused; not active$/);
  okRecord(await titles.resume(title.id, {}, neel));
  const finished = okRecord(await titles.finish(title.id, { rating: 4, text: "great", liked: true }, neel));
  assert.equal(finished.status, "done");
  assert.equal(finished.rating, 4);
  assert.equal(finished.review, "great");
  assert.equal(finished.liked, true);
  rejectedWith(await titles.finish(title.id, {}, neel), /^finish: title is done; already done; use again$/);
  rejectedWith(await titles.want(title.id, {}, neel), /^want: title is done; already done; use update --priority to want it again$/);
  rejectedWith(await titles.start(title.id, {}, neel), /^start: title is done; already done; use again$/);
  rejectedWith(await titles.finish(title.id, { minutes: 0 }, neel), /minutes/);

  const logged = await ops(title.id);
  assert.deepEqual(logged, ["title.add", "title.note", "title.want", "title.start", "title.progress", "title.pause", "title.resume", "title.finish"]);
  assert.equal((await logCount()) - before, 7, "every rejection logged nothing");
});

test("ownership entries: buy carries spend and where, borrow and service need where, return needs something to return; progress never changes", async () => {
  const title = await mk("game", "Fortune's Weave (owned)", { want: true });
  rejectedWith(await titles.borrow(title.id, {}, neel), /^where: Required/);
  rejectedWith(await titles.service(title.id, {}, neel), /^where: Required/);
  rejectedWith(await titles.buy(title.id, { minutes: 5 }, neel), /minutes: Only a progress-facet entry/);
  const bought = okRecord(await titles.buy(title.id, { where: "Nintendo eShop", spend: { amount: 59.99, currency: "USD", kind: "purchase" }, on: on("2026-09-08") }, neel));
  assert.equal(bought.ownership, "owned");
  assert.equal(bought.status, "backlog", "buying does not start");
  assert.deepEqual(bought.ownershipDetail, { where: "Nintendo eShop", since: on("2026-09-08"), price: { amount: 59.99, currency: "USD" } });
  // The clock is fixed, so every entry shares one `at` and same-day ties fall to the type rank; distinct days keep the sequence as spoken.
  const iap = okRecord(await titles.buy(title.id, { spend: { amount: 4.99, currency: "USD", kind: "iap" }, on: on("2026-09-09") }, neel));
  assert.equal(iap.ownershipDetail?.price, null, "an iap is not the purchase price");
  const returned = okRecord(await titles.return(title.id, { on: on("2026-09-10") }, neel));
  assert.equal(returned.ownership, "none");
  assert.equal(returned.ownershipDetail, null);
  const service = okRecord(await titles.service(title.id, { where: "Game Pass", on: on("2026-09-11") }, neel));
  assert.equal(service.ownership, "service");
  assert.equal(service.ownershipDetail?.where, "Game Pass");
  const borrowed = okRecord(await titles.borrow(title.id, { where: "Arjun" }, neel));
  assert.equal(borrowed.ownership, "borrowed");
  assert.equal(borrowed.status, "backlog");
});

test("a backdated entry warns with the derived state and the entry that decides it; the record never carries the warning", async () => {
  const title = await mk("book", "Ilium", { seenBefore: on("2020") });
  const early = await titles.again(title.id, { on: on("2019") }, neel);
  const record = okRecord(early);
  assert.equal(record.status, "done", "the 2020 finish still decides");
  assert.deepEqual(early.warnings, [`again on 2019 is not the latest entry: status is done, decided by finish on 2020 (${title.entries[0]!.id})`]);
  assert.equal(JSON.stringify(record).includes("not the latest"), false);
  const note = await titles.note(title.id, { text: "a reflection from before", on: on("2026-09-05") }, neel);
  okRecord(note);
  assert.deepEqual(note.warnings, ["title is done; use start if he is on it"], "a note carries no transition, so only the status warning");
  const bought = await titles.buy(title.id, { on: on("2018") }, neel);
  okRecord(bought);
  assert.equal(bought.warnings, undefined, "the only ownership entry is the latest of its facet");
});

test("again --finished opens and closes a cycle in one transaction with one log entry; the opener takes the format, the closer the rating, text, and minutes", async () => {
  const title = await mk("movie", "Arrival", { finished: { on: on("2016") } });
  const before = await logCount();
  const receipt = await titles.again(title.id, { rating: 5, text: "still a 5", minutes: 116, liked: true }, neel, { finished: true });
  const record = okRecord(receipt);
  assert.deepEqual(types(record), ["finish", "again", "finish"]);
  assert.equal(record.status, "done");
  assert.equal(record.rating, 5);
  assert.equal(record.review, "still a 5");
  assert.equal(record.liked, true);
  assert.equal(record.version, title.version + 1);
  const [, again, finish] = record.entries;
  assert.equal(again!.rating, null);
  assert.equal(again!.text, null);
  assert.equal(again!.minutes, null);
  assert.equal(finish!.rating, 5);
  assert.equal(finish!.minutes, 116);
  assert.equal(cycles(record.entries).length, 2);
  assert.equal((await logCount()) - before, 1);
  assert.deepEqual(await ops(title.id), ["title.add", "title.again"]);

  const book = await mk("book", "Warbreaker", { finished: { on: on("2019") } });
  const reread = okRecord(await titles.again(book.id, { format: "audiobook", progress: "chapter 1" }, neel));
  assert.equal(reread.status, "active");
  assert.equal(reread.entries.at(-1)!.format, "audiobook");
  assert.equal(reread.entries.at(-1)!.progress, "chapter 1");
  rejectedWith(await titles.again(book.id, {}, neel, { finished: "yes" as unknown as boolean }), /finished/);
});

test("drop requires text, which is the review; rating and liked ride along; a dropped title starts again with start", async () => {
  const title = await mk("game", "Xenoblade", { started: { on: on("2026-09-01") } });
  rejectedWith(await titles.drop(title.id, {}, neel), /^text: Required/);
  const dropped = okRecord(await titles.drop(title.id, { text: "not fun anymore, the difficulty spikes are the problem", rating: 2.5, liked: false, on: on("2026-09-10") }, neel));
  assert.equal(dropped.status, "dropped");
  assert.equal(dropped.review, "not fun anymore, the difficulty spikes are the problem");
  assert.equal(dropped.rating, 2.5);
  rejectedWith(await titles.drop(title.id, { text: "again" }, neel), /^drop: title is dropped; already dropped$/);
  assert.equal(okRecord(await titles.start(title.id, {}, neel)).status, "active");
});

// ------------------------------------------------------------------ corrections

test("amend changes any field including type and on, skips allowed, re-derives; an empty or invalid patch is rejected", async () => {
  const title = await mk("book", "Mistborn", { started: { on: on("2026-09-01") } });
  const start = title.entries[0]!;
  rejectedWith(await titles.amend(title.id, start.id, {}, neel), /Nothing to amend/);
  rejectedWith(await titles.amend(title.id, "n_nope", {}, neel), /not an entry id/);
  rejectedWith(await titles.amend(title.id, "n_0000000000", { text: "x" }, neel), /no entry "n_0000000000"/);
  rejectedWith(await titles.amend(title.id, start.id, { rating: 3 }, neel), /rating: Only a finish or drop carries a rating/);
  const amended = okRecord(await titles.amend(title.id, start.id, { type: "finish", on: on("2026-09-05~w"), rating: 4, text: "good" }, neel));
  assert.equal(amended.status, "done", "re-derived from the corrected diary");
  assert.equal(amended.rating, 4);
  assert.equal(amended.review, "good");
  assert.deepEqual(amended.entries[0]!.on, { date: "2026-08-31", precision: "week" });
  assert.equal(amended.entries[0]!.id, start.id, "the id is kept");
  const same = await titles.amend(title.id, start.id, { rating: 4 }, neel);
  assert.equal(same.outcome, "unchanged");
  const cleared = okRecord(await titles.amend(title.id, start.id, { rating: null, text: null }, neel));
  assert.equal(cleared.rating, null);
  assert.equal(cleared.review, null);
  assert.deepEqual(await ops(title.id), ["title.add", "title.amend", "title.amend"], "unchanged logged nothing");
});

test("unlog removes the entry, returns it as removed, and re-derives; unlogging the only start leaves the progress entries", async () => {
  const title = await mk("game", "Tunic", { started: true });
  okRecord(await titles.progress(title.id, { progress: "the first key" }, neel));
  const start = title.entries[0]!;
  const receipt = await titles.unlog(title.id, start.id, { ...neel, reason: "never started it" });
  const record = okRecord(receipt);
  assert.deepEqual(receipt.removed, start);
  assert.deepEqual(types(record), ["progress"]);
  assert.equal(record.status, "curious");
  assert.equal(JSON.stringify(record).includes(start.id), false);
  rejectedWith(await titles.unlog(title.id, start.id, neel), /no entry/);
  const entry = (await history(title.id)).at(-1)!;
  assert.equal(entry.op, "title.unlog");
  assert.equal(entry.reason, "never started it");
});

test("relog moves an entry to another title of the same medium in one transaction and re-derives both", async () => {
  const starsight = await mk("book", "Starsight");
  const skyward = await mk("book", "Skyward (relog)", { started: { on: on("2026-08") } });
  const wrong = okRecord(await titles.finish(starsight.id, { rating: 4.5, text: "loved the ending" }, neel));
  assert.equal(wrong.status, "done");
  const finish = wrong.entries[0]!;
  const before = await logCount();
  const receipt = await titles.relog(starsight.id, finish.id, "Skyward (relog)", { ...neel, reason: "the finish went on the wrong title" });
  const source = okRecord(receipt);
  assert.equal(source.id, starsight.id);
  assert.equal(source.status, "curious", "the source re-derives without the finish");
  assert.equal(source.rating, null);
  const target = await get(skyward.id);
  assert.equal(target.status, "done", "the target re-derives with it");
  assert.equal(target.rating, 4.5);
  assert.equal(target.review, "loved the ending");
  assert.deepEqual(target.entries.map((e) => e.id), [skyward.entries[0]!.id, finish.id], "the id is kept");
  assert.equal((await logCount()) - before, 2, "one entry per title, one transaction");
  assert.deepEqual(await ops(skyward.id), ["title.add", "title.relog"]);
  assert.equal((await history(skyward.id)).at(-1)!.reason, "the finish went on the wrong title");
  assert.ok(receipt.warnings?.some((w) => w.startsWith(`Moved finish ${finish.id} to Skyward (relog)`)));

  const movie = await mk("movie", "Starsight (movie)");
  rejectedWith(await titles.relog(skyward.id, finish.id, movie.id, neel), /^into: "Starsight \(movie\)" is a movie, not a book/);
  rejectedWith(await titles.relog(skyward.id, finish.id, skyward.id, neel), /^into: .* is the same title/);
  rejectedWith(await titles.relog(skyward.id, finish.id, "m_0000000000", neel), /^into: no title "m_0000000000"/);
  rejectedWith(await titles.relog(skyward.id, "n_0000000000", starsight.id, neel), /no entry "n_0000000000"/);
});

// ------------------------------------------------------------------ the take

test("rate, unrate, and review address the last closing entry or the named one; with none the hint says finish or drop first", async () => {
  const title = await mk("book", "Elantris", { started: { on: on("2026-09-01") } });
  rejectedWith(await titles.rate(title.id, 4, neel), /^rating: nothing to rate; finish or drop first$/);
  rejectedWith(await titles.review(title.id, "great", neel), /^review: nothing to review; finish or drop first$/);
  rejectedWith(await titles.rate(title.id, 4.25 as never, neel), /^rating: Use half stars from 0\.5 to 5$/);
  const start = title.entries[0]!;
  rejectedWith(await titles.rate(title.id, 4, neel, { entry: start.id }), /is a start; only a finish or drop carries a rating/);

  okRecord(await titles.finish(title.id, { on: on("2026-09-05") }, neel));
  const first = (await get(title.id)).entries.at(-1)!;
  const rated = okRecord(await titles.rate(title.id, 3.5, neel));
  assert.equal(rated.rating, 3.5);
  assert.equal(rated.entries.find((e) => e.id === first.id)!.rating, 3.5);
  const same = await titles.rate(title.id, 3.5, neel);
  assert.equal(same.outcome, "unchanged");

  okRecord(await titles.again(title.id, { rating: 5, text: "better the second time" }, neel, { finished: true }));
  const second = (await get(title.id)).entries.at(-1)!;
  assert.equal((await get(title.id)).rating, 5);
  const unrated = okRecord(await titles.unrate(title.id, neel));
  assert.equal(unrated.rating, 3.5, "the title falls back to the earlier cycle's rating");
  assert.equal(unrated.entries.find((e) => e.id === second.id)!.rating, null);
  const reviewed = okRecord(await titles.review(title.id, "solid first read", neel, { entry: first.id }));
  assert.equal(reviewed.entries.find((e) => e.id === first.id)!.text, "solid first read");
  assert.equal(reviewed.review, "better the second time", "the latest closing text is still the title's");
  rejectedWith(await titles.review(title.id, "   ", neel), /^text: Required/);
  rejectedWith(await titles.rate(title.id, 4, neel, { entry: "n_0000000000" }), /no entry/);
  assert.deepEqual(await ops(title.id), ["title.add", "title.finish", "title.rate", "title.again", "title.unrate", "title.review"]);
});

test("like and unlike set liked on the title; a repeat is unchanged and logs nothing", async () => {
  const title = await mk("movie", "Liked movie");
  const liked = okRecord(await titles.like("Liked movie", neel));
  assert.equal(liked.liked, true);
  assert.equal((await titles.like(title.id, neel)).outcome, "unchanged");
  assert.equal(okRecord(await titles.unlike(title.id, neel)).liked, false);
  assert.deepEqual(await ops(title.id), ["title.add", "title.like", "title.unlike"]);
});

// ------------------------------------------------------------------ update and list

test("update: content fields, null clears, aliases, the medium block, and edited bookkeeping for the five factual fields", async () => {
  const title = await mk("book", "The Way of Kings", { detail: { format: "kindle" } });
  const updated = okRecord(await titles.update(title.id, { year: 2010, creators: ["Brandon Sanderson"], priority: "now", moodFit: ["immersive", "immersive"], timeFit: "long", notes: "next action: chapter 1", series: { name: "The Stormlight Archive", position: 1 }, aliases: ["WoK", "wok"], detail: { format: "audiobook" } }, neel));
  assert.deepEqual(updated.edited, ["year", "creators"]);
  assert.deepEqual(updated.moodFit, ["immersive"]);
  assert.deepEqual(updated.aliases, ["WoK"]);
  assert.equal(updated.detail.format, "audiobook");
  assert.deepEqual(updated.series, { name: "The Stormlight Archive", position: 1 });
  const cleared = okRecord(await titles.update(title.id, { priority: null, timeFit: null, notes: null, series: null, year: null, cover: "https://c/wok.jpg", length: { pages: 1007 }, name: "Way of Kings" }, neel));
  assert.equal(cleared.priority, null);
  assert.equal(cleared.series, null);
  assert.equal(cleared.year, null);
  assert.deepEqual(cleared.edited, ["year", "creators", "name", "cover", "length"]);
  assert.equal((await titles.update(title.id, { name: "Way of Kings" }, neel)).outcome, "unchanged", "the same value is no change and adds nothing");
  rejectedWith(await titles.update(title.id, { detail: { platform: "PC" } }, neel), /^detail\.platform: A book has no platform$/);
  rejectedWith(await titles.update(title.id, { year: 2010 }, { ...neel, ifVersion: 1 }), /^version: expected 1, current is 3$/);
  rejectedWith(await titles.update(title.id, { bogus: 1 } as never, neel), /bogus/);
  assert.deepEqual(await ops(title.id), ["title.add", "title.update", "title.update"]);
});

test("list: hides deleted and dropped by default, filters, text over name, aliases, and creators, summaries unless full, sorted status then priority then name", async () => {
  const listing = titles.scoped("show");
  const active = await mk("show", "Zeta Active", { started: true });
  const paused = await mk("show", "Alpha Paused", { started: true, priority: "later" });
  okRecord(await titles.pause(paused.id, {}, neel));
  const soon = await mk("show", "Beta Backlog", { want: true, priority: "soon", moodFit: ["comfort"] });
  const nowP = await mk("show", "Gamma Backlog", { want: true, priority: "now", timeFit: "short" });
  const curious = await mk("show", "Delta Curious");
  okRecord(await titles.update(curious.id, { creators: ["Dan Erickson"], aliases: ["The office one"] }, neel));
  const done = await mk("show", "Eta Done", { finished: { rating: 4 } });
  const dropped = await mk("show", "Theta Dropped", { started: true });
  okRecord(await titles.drop(dropped.id, { text: "boring" }, neel));
  const deleted = await mk("show", "Iota Deleted");
  okRecord(await titles.delete(deleted.id, neel));

  const all = (await listing.list()) as TitleSummary[];
  assert.deepEqual(
    all.map((t) => t.name),
    ["Zeta Active", "Alpha Paused", "Gamma Backlog", "Beta Backlog", "Delta Curious", "Eta Done"],
  );
  assert.deepEqual(Object.keys(all[0]!).sort(), ["id", "lastEntry", "liked", "medium", "moodFit", "name", "ownership", "priority", "rating", "status", "timeFit", "year"]);
  assert.deepEqual(all[0]!.lastEntry, { type: "start", on: today, text: null });
  assert.equal(all[4]!.lastEntry, null);
  assert.equal(all[5]!.rating, 4);
  assert.deepEqual(((await listing.list({ status: ["dropped"] })) as TitleSummary[]).map((t) => t.id), [dropped.id]);
  assert.deepEqual(((await listing.list({ includeDeleted: true, status: [...STATUS_ORDER] })) as TitleSummary[]).map((t) => t.id).includes(deleted.id), true);
  assert.deepEqual(((await listing.list({ text: "office" })) as TitleSummary[]).map((t) => t.id), [curious.id], "alias");
  assert.deepEqual(((await listing.list({ text: "erickson" })) as TitleSummary[]).map((t) => t.id), [curious.id], "creator");
  assert.deepEqual(((await listing.list({ priority: "soon" })) as TitleSummary[]).map((t) => t.id), [soon.id]);
  assert.deepEqual(((await listing.list({ moodFit: "comfort" })) as TitleSummary[]).map((t) => t.id), [soon.id]);
  assert.deepEqual(((await listing.list({ timeFit: "short" })) as TitleSummary[]).map((t) => t.id), [nowP.id]);
  assert.deepEqual(((await listing.list({ status: ["active", "paused"] })) as TitleSummary[]).map((t) => t.id), [active.id, paused.id]);
  const full = (await listing.list({ full: true, status: ["done"] })) as Title[];
  assert.equal(full[0]!.entries.length, 1);
  assert.deepEqual(((await titles.list({ medium: "show", ownership: ["none"], text: "backlog" })) as TitleSummary[]).length, 2);
  assert.equal(((await titles.list({ format: "audiobook" })) as TitleSummary[]).every((t) => t.medium === "book"), true);
  await assert.rejects(listing.list({ status: [] }), /list: status/);
  assert.deepEqual(sortTitles([done, active]).map((t) => t.id), [active.id, done.id]);
  assert.equal(summarize(done).status, "done");
});

// ------------------------------------------------------------------ series and finish

test("finish names the next in the series with a warning; queueNext creates it as backlog under itemCtx(ctx, 1) with series evidence, in the same transaction", async () => {
  tmdb.seed("movie", [
    { externalId: "438631", name: "Dune", year: 2021, facts: { released: "2021-10-22", series: { name: "Dune Collection", position: 1, entries: [{ externalId: "438631", name: "Dune", position: 1, released: "2021-10-22" }, { externalId: "693134", name: "Dune: Part Two", position: 2, released: "2024-02-27" }, { externalId: "999", name: "Dune: Part Three", position: 3, released: "2026-12-18" }] } } },
    { externalId: "693134", name: "Dune: Part Two", year: 2024, creators: ["Denis Villeneuve"], facts: { released: "2024-02-27", series: { name: "Dune Collection", position: 2, entries: [{ externalId: "438631", name: "Dune", position: 1, released: "2021-10-22" }, { externalId: "693134", name: "Dune: Part Two", position: 2, released: "2024-02-27" }, { externalId: "999", name: "Dune: Part Three", position: 3, released: "2026-12-18" }] } } },
  ]);
  const dune = okRecord(await titles.add({ medium: "movie", name: "Dune", year: 2021, started: true }, neel));
  assert.equal(dune.catalog?.externalId, "438631");
  const detailCalls = tmdb.callsTo("detail").length;

  const before = await logCount();
  const receipt = await titles.finish(dune.id, { rating: 4 }, { ...codex, key: "finish-dune" }, { queueNext: true });
  const finished = okRecord(receipt);
  assert.equal(finished.status, "done");
  assert.equal(receipt.next?.externalId, "693134");
  assert.equal(receipt.next?.name, "Dune: Part Two");
  assert.equal(receipt.next?.position, 2);
  assert.match(receipt.next!.titleId!, /^m_/);
  assert.ok(receipt.warnings!.some((w) => w.startsWith('Next in Dune Collection: "Dune: Part Two"')));
  assert.equal((await logCount()) - before, 2, "the finish and the queued title, one transaction");
  assert.equal(tmdb.callsTo("detail").length, detailCalls + 1, "the next work was pulled before the transaction");

  const queued = await get(receipt.next!.titleId!);
  assert.equal(queued.name, "Dune: Part Two");
  assert.equal(queued.status, "backlog");
  assert.deepEqual(types(queued), ["want"]);
  assert.equal(queued.catalog?.externalId, "693134");
  assert.deepEqual(queued.creators, ["Denis Villeneuve"]);
  assert.equal(queued.year, 2024);
  assert.deepEqual(queued.origin.evidence, [...codex.evidence!, `series:${dune.id}`]);
  const queuedLog = (await history(queued.id))[0]!;
  assert.equal(queuedLog.op, "title.add");
  assert.equal(queuedLog.key, `finish-dune${ITEM_KEY_SEPARATOR}1`);
  assert.equal((await history(dune.id)).at(-1)!.key, "finish-dune");

  // Already in the library: named, not created.
  const second = await titles.finish(queued.id, {}, neel, { queueNext: true });
  assert.equal(okRecord(second).status, "done");
  assert.ok(second.warnings!.some((w) => w.startsWith('Queued "Dune: Part Three" without catalog facts: no movie with id "999" at TMDB')));
  assert.ok(second.warnings!.some((w) => /^Queued "Dune: Part Three" as m_[a-z0-9]{10} \(backlog\)$/.test(w)));
  const third = await titles.finish(dune.id, {}, neel);
  rejectedWith(third, /already done/);
  const rewatch = await titles.again(queued.id, {}, neel, { finished: true });
  okRecord(rewatch);
  assert.equal(rewatch.next, undefined, "again carries no next");

  // The second finish queued Part Three, whose id the fake does not know: created with the catalog id, no facts, and a warning.
  const three = await titles.scoped("movie").get("Dune: Part Three");
  assert.ok(three);
  assert.equal(three.status, "backlog");
  assert.deepEqual(three.catalog, { source: "tmdb", externalId: "999", pulledAt: now });
  assert.equal(three.facts, null);
  assert.equal(three.year, 2026, "from the series entry's release");

  const view = await titles.series(dune.id);
  assert.equal(view?.name, "Dune Collection");
  assert.deepEqual(view?.entries.map((e) => [e.name, e.title?.id ?? null]), [["Dune", dune.id], ["Dune: Part Two", queued.id], ["Dune: Part Three", three.id]]);
  const next = await titles.next(queued.id);
  assert.equal(next?.seriesEntry.externalId, "999");
  assert.equal(next?.title?.id, three.id);
  assert.equal(await titles.next("Dune: Part Two (nope)"), null);
});

test("finish with queueNext on the last entry, outside a series, or when the next is already there only warns; a hand-set series works from library titles", async () => {
  const lone = await mk("book", "Piranesi", { started: true });
  const alone = await titles.finish(lone.id, {}, neel, { queueNext: true });
  okRecord(alone);
  assert.equal(alone.next, undefined);
  assert.deepEqual(alone.warnings, ['queueNext: "Piranesi" is not in a series, or is its last entry; nothing queued']);

  const one = await mk("book", "Beware of Chicken", { started: true });
  const two = await mk("book", "Beware of Chicken 2");
  const three = await mk("book", "Beware of Chicken 3");
  for (const [title, position] of [[one, 1], [two, 2], [three, 3]] as const) okRecord(await titles.update(title.id, { series: { name: "Beware of Chicken", position } }, neel));
  const series = await titles.series("Beware of Chicken 2");
  assert.deepEqual(series?.entries.map((e) => [e.position, e.title?.id]), [[1, one.id], [2, two.id], [3, three.id]]);
  assert.equal(series?.position, 2);
  const next = await titles.next(one.id);
  assert.equal(next?.title?.id, two.id);
  assert.equal(next?.seriesEntry.externalId, null);
  const receipt = await titles.finish(one.id, {}, neel, { queueNext: true });
  okRecord(receipt);
  assert.deepEqual(receipt.next, { externalId: null, name: "Beware of Chicken 2", position: 2, titleId: two.id });
  assert.ok(receipt.warnings!.some((w) => w === `queueNext: "Beware of Chicken 2" is already in the library as ${two.id}; nothing queued`));
  assert.equal((await get(two.id)).status, "curious", "nothing was appended to it");
  assert.equal(await titles.next(three.id), null, "the last entry has no next");
  assert.equal(nextOf(three, [one, two, three]), null);
  assert.equal(seriesOf(lone, [lone]), null);
});

// ------------------------------------------------------------------ catalog operations

test("catalog.link adopts the catalog name when every typed word appears in it, keeps the typed name as an alias, and fills only fields not in edited; unlink keeps the top-level fields", async () => {
  igdb.seed("game", [{ externalId: "fe", name: "Fire Emblem: Fortune's Weave", year: 2026, creators: ["Intelligent Systems"], cover: "https://images.igdb.com/t_cover_big/fe.jpg", length: { hours: 60 }, facts: { platforms: ["Nintendo Switch 2"], genres: ["Tactical RPG"] }, availability: [{ kind: "buy", name: "Nintendo eShop", url: "https://ec.nintendo.com/apps/1/US", region: "US", price: null, constructed: false }] }]);
  const typed = await mk("game", "Fortune's Weave", { want: true });
  okRecord(await titles.update(typed.id, { cover: "https://mine/fe.jpg" }, neel));
  const receipt = await titles.catalog.link("Fortune's Weave", "fe", neel);
  const linked = okRecord(receipt);
  assert.equal(linked.name, "Fire Emblem: Fortune's Weave");
  assert.deepEqual(linked.aliases, ["Fortune's Weave"]);
  assert.equal(linked.cover, "https://mine/fe.jpg", "edited");
  assert.deepEqual(linked.edited, ["cover"]);
  assert.deepEqual(linked.creators, ["Intelligent Systems"]);
  assert.deepEqual(linked.length, { hours: 60 });
  assert.deepEqual(linked.facts?.platforms, ["Nintendo Switch 2"]);
  assert.deepEqual(linked.facts?.availability.map((row) => row.name), ["Nintendo eShop"]);
  assert.equal(linked.status, "backlog", "the diary is untouched");
  assert.equal((await titles.scoped("game").get("fortune's weave"))?.id, typed.id, "the alias still resolves");
  assert.deepEqual(await titles.where(typed.id), linked.facts?.availability);

  const same = await titles.catalog.link(typed.id, "fe", neel);
  assert.equal(same.outcome, "unchanged", "linking the same id again changes nothing");

  const unlinked = okRecord(await titles.catalog.unlink(typed.id, neel));
  assert.equal(unlinked.catalog, null);
  assert.equal(unlinked.facts, null);
  assert.equal(unlinked.name, "Fire Emblem: Fortune's Weave");
  assert.deepEqual(unlinked.creators, ["Intelligent Systems"]);
  assert.deepEqual(unlinked.length, { hours: 60 });
  assert.deepEqual(unlinked.edited, ["cover"]);
  assert.deepEqual(await titles.where(typed.id), []);
  assert.equal((await titles.catalog.unlink(typed.id, neel)).outcome, "unchanged");
  assert.deepEqual(await ops(typed.id), ["title.add", "title.update", "title.link", "title.unlink"]);
  rejectedWith(await titles.catalog.link(typed.id, "  ", neel), /^externalId: Required/);
});

test("catalog.availability re-pulls one title's availability (unchanged stamps pulledAt quietly); over the backlog one transaction per title isolates failures", async () => {
  igdb.seed("game", [
    { externalId: "h", name: "Hollow Knight", category: "main", availability: [{ kind: "buy", name: "Steam", url: "https://store.steampowered.com/app/367520", region: "US", price: null, constructed: false }] },
    { externalId: "s", name: "Silksong", category: "main", availability: [] },
    { externalId: "c", name: "Celeste 64", category: "main", availability: [] },
    { externalId: "cg", name: "Curious game", category: "main", availability: [] },
  ]);
  const hollow = okRecord(await titles.add({ medium: "game", name: "Hollow Knight", want: true }, neel));
  const silksong = okRecord(await titles.add({ medium: "game", name: "Silksong", want: true }, neel));
  const celeste = okRecord(await titles.add({ medium: "game", name: "Celeste 64", want: true }, neel));
  const unlinked = await mk("game", "Unlinked backlog", { want: true });
  const curious = okRecord(await titles.add({ medium: "game", name: "Curious game" }, neel));
  assert.equal(curious.status, "curious");
  const backlog = ((await titles.list({ medium: "game", status: ["backlog"], full: true })) as Title[]).filter((t) => t.catalog !== null);

  rejectedWith(await titles.catalog.availability(unlinked.id, neel), /has no catalog; run refresh first/);
  const before = await logCount();
  const same = await titles.catalog.availability(hollow.id, neel);
  assert.equal(same.outcome, "unchanged");
  assert.equal(await logCount(), before);

  igdb.seed("game", [{ externalId: "s", name: "Silksong", category: "main", availability: [{ kind: "buy", name: "Steam", url: "https://store.steampowered.com/app/1030300", region: "US", price: null, constructed: false }] }]);
  igdb.failNext(new CatalogUnavailable("IGDB is unavailable (HTTP 503): down", 503), "availability");
  const report = await titles.catalog.availability({ status: "backlog", medium: "game" }, { ...neel, key: "avail" });
  assert.deepEqual(report.failed, [{ id: celeste.id, name: "Celeste 64", issues: ["catalog_unavailable: IGDB is unavailable (HTTP 503): down"] }], "the first in list order took the one failure");
  assert.equal(report.refreshed.length + report.failed.length, backlog.length, "every backlog title with a catalog, none twice");
  assert.ok(report.refreshed.some((r) => r.id === hollow.id && r.outcome === "unchanged"));
  assert.ok(report.refreshed.some((r) => r.id === silksong.id && r.outcome === "updated"));
  assert.equal((await get(silksong.id)).facts?.availability.length, 1);
  assert.equal((await logCount()) - before, 1, "only the changed title logged");
  const entry = (await history(silksong.id)).at(-1)!;
  assert.equal(entry.op, "title.availability");
  assert.ok(entry.key?.startsWith(`avail${ITEM_KEY_SEPARATOR}`), "each title under its own item key");
  assert.ok(!report.refreshed.some((r) => r.id === curious.id) && !report.failed.some((r) => r.id === curious.id), "only backlog titles");
  assert.ok(!report.failed.some((r) => r.id === unlinked.id), "titles without a catalog are skipped");
  await assert.rejects(titles.catalog.availability({ status: "active" } as never, neel), /availability: status/);
});

test("catalog.search marks inLibrary, adds availability to the auto-link match or up to three candidates, and throws source errors", async () => {
  tmdb.seed("show", [
    { externalId: "1396", name: "Breaking Bad", year: 2008, availability: [{ kind: "stream", name: "Netflix", url: "https://jw/bb", region: "US", price: null, constructed: false }] },
    { externalId: "2", name: "Breaking Bad: The Movie", year: 2019 },
    { externalId: "3", name: "Breaking Bad Habits", year: 2020 },
    { externalId: "4", name: "Breaking Badly", year: 2021 },
  ]);
  const existing = okRecord(await titles.add({ medium: "show", name: "Breaking Bad", catalog: "1396" }, neel));
  const plain = await titles.catalog.search("show", "breaking bad");
  assert.equal(plain.length, 4);
  assert.equal(plain[0]!.inLibrary, existing.id);
  assert.equal(plain[1]!.inLibrary, null);
  assert.equal(plain[0]!.availability, undefined);

  const matched = await titles.catalog.search("show", "Breaking Bad", { availability: true });
  assert.deepEqual(matched[0]!.availability?.map((row) => row.name), ["Netflix"]);
  assert.equal(matched[1]!.availability, undefined, "only the match");
  const calls = tmdb.callsTo("availability").length;
  const spread = await titles.catalog.search("show", "Breaking", { availability: true });
  assert.equal(tmdb.callsTo("availability").length - calls, 3, "no match: the first three");
  assert.ok(spread[0]!.availability && spread[2]!.availability && !spread[3]!.availability);

  tmdb.failNext(new CatalogUnconfigured("LIFE_TMDB_KEY"));
  await assert.rejects(titles.catalog.search("show", "x"), (error: unknown) => error instanceof CatalogUnconfigured && error.variable === "LIFE_TMDB_KEY");
  tmdb.failNext(new CatalogUnavailable("TMDB is unavailable (HTTP 500): boom", 500));
  await assert.rejects(titles.catalog.search("show", "x"), CatalogUnavailable);
  await assert.rejects(titles.catalog.search("show", "x", { year: 0 }), /search: year/);

  assert.deepEqual((await titles.where({ catalog: "1396", medium: "show" })).map((row) => row.name), ["Netflix"], "where by catalog id is a live call");
  await assert.rejects(titles.where("m_0000000000"), /where: no title/);
});

// ------------------------------------------------------------------ merge, delete, restore, history

test("merge moves entries onto into (ids kept), unions moodFit, folds the name in as an alias, keeps into's other facets, and trashes the source with a note", async () => {
  const keep = await mk("book", "Skyward (keep)", { want: true, moodFit: ["comfort"], priority: "soon", notes: "keep notes" });
  const dupe = await mk("book", "Skyward (dupe)", { started: { on: on("2026-09-01") }, moodFit: ["immersive"], priority: "now", notes: "dupe notes", liked: true });
  okRecord(await titles.finish(dupe.id, { rating: 4 }, neel));
  const dupeEntries = (await get(dupe.id)).entries.map((e) => e.id);
  const before = await logCount();
  const receipt = await titles.merge("Skyward (dupe)", "Skyward (keep)", { ...neel, reason: "created twice" });
  const merged = okRecord(receipt);
  assert.equal(merged.id, keep.id);
  assert.deepEqual(types(merged), ["want", "start", "finish"]);
  assert.deepEqual(merged.entries.slice(1).map((e) => e.id), dupeEntries, "ids kept");
  assert.equal(merged.status, "done", "re-derived");
  assert.equal(merged.rating, 4);
  assert.deepEqual(merged.moodFit, ["comfort", "immersive"]);
  assert.equal(merged.priority, "soon", "into's facets");
  assert.equal(merged.notes, "keep notes");
  assert.equal(merged.liked, false);
  assert.deepEqual(merged.aliases, ["Skyward (dupe)"]);
  const gone = await get(dupe.id);
  assert.equal(gone.deletedAt, now);
  assert.equal(gone.notes, `dupe notes\n\nmerged into ${keep.id}`);
  assert.equal((await logCount()) - before, 2);
  assert.deepEqual(await ops(dupe.id), ["title.add", "title.finish", "title.merge"]);
  assert.equal((await history(dupe.id)).at(-1)!.reason, "created twice");
  assert.ok(receipt.warnings![0]!.startsWith(`Merged Skyward (dupe) (${dupe.id}) into Skyward (keep) (${keep.id})`));

  const movie = await mk("movie", "Skyward (movie)");
  rejectedWith(await titles.merge(movie.id, keep.id, neel), /^into: .* is a book, not a movie/);
  rejectedWith(await titles.merge(keep.id, keep.id, neel), /is the same title/);
  rejectedWith(await titles.merge(dupe.id, keep.id, neel), /is deleted; restore it first/);
});

test("delete is soft and idempotent, restore takes the id, history lists the title's entries in order", async () => {
  const title = await mk("movie", "Deleted one");
  const deleted = okRecord(await titles.delete("Deleted one", neel));
  assert.equal(deleted.deletedAt, now);
  assert.equal((await titles.delete(title.id, neel)).outcome, "unchanged");
  rejectedWith(await titles.delete("Deleted one", neel), /no title "Deleted one"/);
  rejectedWith(await titles.start(title.id, {}, neel), /is deleted; restore it first/);
  rejectedWith(await titles.restore("Deleted one", neel), /restore takes the id/);
  const restored = okRecord(await titles.restore(title.id, neel));
  assert.equal(restored.deletedAt, null);
  assert.equal((await titles.restore(title.id, neel)).outcome, "unchanged");
  assert.deepEqual(await ops(title.id), ["title.add", "title.delete", "title.restore"]);
  assert.deepEqual((await titles.history("Deleted one")).map((e) => e.op), ["title.add", "title.delete", "title.restore"]);
  assert.deepEqual(await titles.history("m_0000000000"), []);
  assert.deepEqual(await titles.history("no such name"), []);
  assert.equal((await titles.get(title.id))?.id, title.id, "get includes deleted and restored alike");
});

test("every mutation logs once with the ctx; unchanged logs nothing and stores no receipt; a key replays its receipt without running again", async () => {
  const before = await logCount();
  const ctx: Ctx = { actor: "codex", reason: "he said so", evidence: ['chat:2026-09-12 "on it"'], key: "start-once" };
  const title = await mk("game", "Keyed", { want: true });
  const first = await titles.start(title.id, { progress: "1h" }, ctx);
  okRecord(first);
  const replay = await titles.start(title.id, { progress: "2h" }, ctx);
  assert.deepEqual(replay, first, "the stored receipt, verbatim");
  assert.equal((await get(title.id)).entries.length, 2, "the second start never ran");
  rejectedWith(await titles.finish(title.id, {}, { ...ctx }), /already used by title.start/);
  const entries = await history(title.id);
  assert.equal(entries.length, 2);
  assert.equal(entries[1]!.actor, "codex");
  assert.equal(entries[1]!.reason, "he said so");
  assert.deepEqual(entries[1]!.evidence, ctx.evidence);
  assert.equal(entries[1]!.key, "start-once");
  assert.ok("entries" in entries[1]!.patch && "status" in entries[1]!.patch, "the diff names the entries and the derived status");
  assert.equal((await titles.like(title.id, { actor: "neel", key: "like-1" })).outcome, "updated");
  assert.equal((await titles.like(title.id, { actor: "neel", key: "like-2" })).outcome, "unchanged");
  assert.equal(await db.store.read((tx) => tx.getReceipt("like-2")), null, "unchanged stores no receipt");
  assert.equal((await logCount()) - before, 3);
});

test("relog checks the version guard before anything is written to either title", async () => {
  const from = await mk("book", "Cascade from", { started: true });
  const into = await mk("book", "Cascade into");
  const entry = from.entries[0]!;
  const before = await logCount();
  const receipt = await titles.relog(from.id, entry.id, into.id, { ...neel, ifVersion: 99 });
  rejectedWith(receipt, /version: expected 99/);
  assert.equal(await logCount(), before);
  assert.deepEqual(types(await get(into.id)), []);
  assert.deepEqual(types(await get(from.id)), ["start"]);
});

test("a scoped ops object defaults list to its medium and add still takes the medium from the input", async () => {
  const books = titles.scoped("book");
  const listed = (await books.list()) as TitleSummary[];
  assert.ok(listed.length > 0 && listed.every((t) => t.medium === "book"));
  const game = okRecord(await books.add({ medium: "game", name: "Scoped game", lookup: false }, neel));
  assert.equal(game.medium, "game");
  assert.equal(await books.get(game.id), null);
  assert.equal((await titles.scoped("game").get(game.id))?.id, game.id);
});
