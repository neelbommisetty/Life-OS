import { test } from "node:test";
import assert from "node:assert/strict";
import { factsSchema, type Availability } from "../../contract.ts";
import {
  CatalogUnavailable,
  CatalogUnconfigured,
  FakeCatalog,
  HttpError,
  MEDIA_BY_SOURCE,
  SOURCE_BY_MEDIUM,
  abortedError,
  assertCovers,
  emptyFacts,
  readEnv,
  requireEnv,
  throwIfAborted,
  type Detail,
} from "./adapter.ts";

const netflix: Availability = { kind: "stream", name: "Netflix", url: "https://www.justwatch.com/us/movie/arrival", region: "US", price: null, constructed: false };
const skyGb: Availability = { kind: "stream", name: "Sky", url: "https://www.justwatch.com/uk/movie/arrival", region: "GB", price: null, constructed: false };

/** A fake TMDB with two "Dune" films and one "Arrival", the way a search box would find them. */
function movies(): FakeCatalog {
  const fake = new FakeCatalog();
  fake.seed("movie", [
    { externalId: "329865", name: "Arrival", year: 2016, creators: ["Denis Villeneuve"], cover: "https://image.tmdb.org/t/p/w500/arrival.jpg", sourceRating: 7.6, availability: [netflix, skyGb], facts: { synopsis: "Linguist Louise Banks", runtime: 116 }, length: { minutes: 116 } },
    { externalId: "438631", name: "Dune", year: 2021, creators: ["Denis Villeneuve"] },
    { externalId: "693134", name: "Dune: Part Two", year: 2024, creators: ["Denis Villeneuve"], texts: ["dune 2"] },
  ]);
  return fake;
}

// ---------------------------------------------------------------- the contract

test("the source tables agree: every medium's source lists that medium, and every source's media point back", () => {
  for (const [medium, source] of Object.entries(SOURCE_BY_MEDIUM) as [keyof typeof SOURCE_BY_MEDIUM, keyof typeof MEDIA_BY_SOURCE][]) {
    assert.ok(MEDIA_BY_SOURCE[source].includes(medium), `${source} covers ${medium}`);
  }
  for (const [source, media] of Object.entries(MEDIA_BY_SOURCE) as [keyof typeof MEDIA_BY_SOURCE, readonly (keyof typeof SOURCE_BY_MEDIUM)[]][]) {
    for (const medium of media) assert.equal(SOURCE_BY_MEDIUM[medium], source);
  }
});

test("CatalogUnavailable carries an optional status and CatalogUnconfigured names its variable in the message", () => {
  const down = new CatalogUnavailable("TMDB is unavailable (HTTP 503): try later", 503);
  assert.equal(down.name, "CatalogUnavailable");
  assert.equal(down.status, 503);
  assert.ok(down instanceof Error);
  assert.equal(new CatalogUnavailable("offline").status, undefined);

  const missing = new CatalogUnconfigured("LIFE_TMDB_KEY");
  assert.equal(missing.name, "CatalogUnconfigured");
  assert.equal(missing.variable, "LIFE_TMDB_KEY");
  assert.match(missing.message, /LIFE_TMDB_KEY is not set/);
  assert.ok(!(missing instanceof CatalogUnavailable), "the two errors are distinct: one is a warning about configuration, the other about the network");
});

test("emptyFacts is a complete Facts once availability is added, so an adapter starts from it and fills what it has", () => {
  const facts = { ...emptyFacts(), availability: [] };
  const parsed = factsSchema.safeParse(facts);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.notEqual(emptyFacts().genres, emptyFacts().genres, "a fresh object every time, so one detail's arrays are never another's");
});

test("abortedError hands back a CatalogUnavailable reason untouched and wraps anything else naming the source", () => {
  const budget = new AbortController();
  const ranOut = new CatalogUnavailable("The 20s lookup budget ran out");
  budget.abort(ranOut);
  assert.equal(abortedError(budget.signal, "TMDB"), ranOut, "the budget's own error, so add can say the budget ran out");

  const plain = new AbortController();
  plain.abort();
  const wrapped = abortedError(plain.signal, "TMDB");
  assert.ok(wrapped instanceof CatalogUnavailable);
  assert.match(wrapped.message, /^TMDB: the request was aborted/);

  const worded = new AbortController();
  worded.abort(new Error("user pressed ctrl-c"));
  assert.equal(abortedError(worded.signal, "IGDB").message, "IGDB: the request was aborted (user pressed ctrl-c)");

  assert.doesNotThrow(() => throwIfAborted(undefined, "TMDB"));
  assert.doesNotThrow(() => throwIfAborted(new AbortController().signal, "TMDB"));
  assert.throws(() => throwIfAborted(plain.signal, "TMDB"), CatalogUnavailable);
});

// ---------------------------------------------------------------- FakeCatalog: shape

test("a FakeCatalog defaults to TMDB's media, takes its source's media otherwise, and can be told to cover anything", () => {
  assert.equal(new FakeCatalog().source, "tmdb");
  assert.deepEqual(new FakeCatalog().media, ["movie", "show"]);
  assert.deepEqual(new FakeCatalog({ source: "igdb" }).media, ["game"]);
  assert.deepEqual(new FakeCatalog({ source: "openlibrary" }).media, ["book"]);
  const everything = new FakeCatalog({ source: "tmdb", media: ["movie", "show", "game", "book"] });
  assert.deepEqual(everything.media, ["movie", "show", "game", "book"]);
  const given: ("game" | "book")[] = ["game"];
  const copied = new FakeCatalog({ source: "igdb", media: given });
  given.push("book");
  assert.deepEqual(copied.media, ["game"], "the media list is the instance's own copy");
});

test("search matches the name case-insensitively as a substring or a seeded text, in seed order, at most ten, with the fake's source and no inLibrary", async () => {
  const fake = movies();
  const dune = await fake.search("movie", "  DUNE ");
  assert.deepEqual(dune.map((c) => c.externalId), ["438631", "693134"], "two works under one name: the several-candidates case");
  assert.deepEqual(dune[0], { source: "tmdb", externalId: "438631", name: "Dune", year: 2021, creators: ["Denis Villeneuve"], category: null, cover: null, editionCount: null, sourceRating: null, inLibrary: null });
  assert.deepEqual((await fake.search("movie", "dune 2")).map((c) => c.name), ["Dune: Part Two"], "a seeded text finds a work the name would not");
  assert.deepEqual((await fake.search("movie", "Dune   2")).map((c) => c.name), ["Dune: Part Two"], "spacing is ignored on texts too");
  assert.deepEqual((await fake.search("movie", "arrival")).map((c) => c.sourceRating), [7.6]);
  assert.deepEqual(await fake.search("movie", "Blade Runner"), []);
  assert.deepEqual(await fake.search("movie", "   "), [], "an empty text finds nothing rather than everything");
  assert.deepEqual(await fake.search("show", "Dune"), [], "works live per medium");

  const many = new FakeCatalog({ source: "openlibrary" });
  many.seed("book", Array.from({ length: 12 }, (_, i) => ({ externalId: `OL${i}W`, name: `Skyward ${i}` })));
  assert.equal((await many.search("book", "skyward")).length, 10);
});

test("search results are copies: changing one leaves the fake and later answers untouched", async () => {
  const fake = movies();
  const [first] = await fake.search("movie", "Arrival");
  first!.creators.push("Someone Else");
  first!.name = "Departure";
  assert.deepEqual((await fake.search("movie", "Arrival")).map((c) => [c.name, c.creators]), [["Arrival", ["Denis Villeneuve"]]]);
  const detail = await fake.detail("movie", "329865");
  assert.equal(detail.name, "Arrival");
});

test("detail returns the seeded fields with empty facts filled in, and refuses an unknown id or a medium the fake does not cover", async () => {
  const fake = movies();
  const arrival = await fake.detail("movie", "329865");
  const expected: Detail = {
    name: "Arrival",
    year: 2016,
    creators: ["Denis Villeneuve"],
    cover: "https://image.tmdb.org/t/p/w500/arrival.jpg",
    length: { minutes: 116 },
    facts: { ...emptyFacts(), synopsis: "Linguist Louise Banks", runtime: 116 },
  };
  assert.deepEqual(arrival, expected);
  const dune = await fake.detail("movie", "438631");
  assert.equal(dune.length, null);
  assert.deepEqual(dune.facts, emptyFacts());
  await assert.rejects(fake.detail("movie", "1"), (error: unknown) => error instanceof HttpError && error.status === 404 && error.message === "tmdb refused the request (HTTP 404): no movie with id 1");
  await assert.rejects(fake.detail("game", "1"), { message: "tmdb does not cover game" });
  await assert.rejects(fake.search("book", "x"), { message: "tmdb does not cover book" });
});

test("seed upserts by externalId within a medium", async () => {
  const fake = movies();
  fake.seed("movie", [{ externalId: "438631", name: "Dune (2021)", year: 2021, category: "main" }]);
  const [dune] = await fake.search("movie", "Dune (2021)");
  assert.equal(dune!.category, "main");
  assert.equal((await fake.search("movie", "dune")).length, 2, "still two Dunes, not three");
});

test("availability answers the rows seeded for the region asked, copied, and refuses an unknown id", async () => {
  const fake = movies();
  assert.deepEqual(await fake.availability("movie", "329865", "US"), [netflix]);
  assert.deepEqual(await fake.availability("movie", "329865", "GB"), [skyGb]);
  assert.deepEqual(await fake.availability("movie", "329865", "FR"), []);
  assert.deepEqual(await fake.availability("movie", "438631", "US"), [], "nothing seeded is an empty list, not an error");
  const rows = await fake.availability("movie", "329865", "US");
  rows[0]!.name = "Changed";
  assert.equal((await fake.availability("movie", "329865", "US"))[0]!.name, "Netflix");
  await assert.rejects(fake.availability("movie", "nope", "US"), (error: unknown) => error instanceof HttpError && error.status === 404);
});

// ---------------------------------------------------------------- FakeCatalog: recording and failures

test("every call is recorded with the arguments that matter, failures included, and callsTo narrows by method", async () => {
  const fake = movies();
  await fake.search("movie", "Arrival", { year: 2016 });
  await fake.search("movie", "Dune");
  await fake.detail("movie", "329865");
  await fake.availability("movie", "329865", "US");
  await fake.detail("movie", "missing").catch(() => undefined);
  assert.deepEqual(fake.calls, [
    { method: "search", medium: "movie", text: "Arrival", year: 2016 },
    { method: "search", medium: "movie", text: "Dune", year: null },
    { method: "detail", medium: "movie", externalId: "329865" },
    { method: "availability", medium: "movie", externalId: "329865", region: "US" },
    { method: "detail", medium: "movie", externalId: "missing" },
  ]);
  assert.deepEqual(fake.callsTo("search").map((call) => call.text), ["Arrival", "Dune"]);
  assert.deepEqual(fake.callsTo("availability").map((call) => call.region), ["US"]);
});

test("failNext throws the given error once, after recording the call, and keeps the error's identity", async () => {
  const fake = movies();
  const down = new CatalogUnavailable("TMDB is unavailable (HTTP 503): maintenance", 503);
  fake.failNext(down);
  await assert.rejects(fake.search("movie", "Arrival"), (error: unknown) => error === down);
  assert.equal(fake.calls.length, 1, "the failed call is recorded");
  assert.equal((await fake.search("movie", "Arrival")).length, 1, "one shot");

  fake.failNext(new CatalogUnconfigured("LIFE_TMDB_KEY"));
  await assert.rejects(fake.detail("movie", "329865"), (error: unknown) => error instanceof CatalogUnconfigured && error.variable === "LIFE_TMDB_KEY");
});

test("failNext and failAlways can target one method, so a search can succeed while availability fails", async () => {
  const fake = movies();
  fake.failNext(new CatalogUnavailable("providers down"), "availability");
  assert.equal((await fake.search("movie", "Arrival")).length, 1, "search is not the targeted method");
  assert.equal((await fake.detail("movie", "329865")).name, "Arrival");
  await assert.rejects(fake.availability("movie", "329865", "US"), { message: "providers down" });
  assert.deepEqual(await fake.availability("movie", "329865", "US"), [netflix], "one shot");

  fake.failAlways(new CatalogUnavailable("still down"), "availability");
  await assert.rejects(fake.availability("movie", "329865", "US"), { message: "still down" });
  await assert.rejects(fake.availability("movie", "329865", "US"), { message: "still down" });
  assert.equal((await fake.search("movie", "Arrival")).length, 1);
  fake.recover();
  assert.deepEqual(await fake.availability("movie", "329865", "US"), [netflix]);
});

test("failAlways throws on every call until recover; failNext takes precedence for the one call it names", async () => {
  const fake = movies();
  const unconfigured = new CatalogUnconfigured("LIFE_IGDB_CLIENT_ID");
  fake.failAlways(unconfigured);
  await assert.rejects(fake.search("movie", "Arrival"), (error: unknown) => error === unconfigured);
  await assert.rejects(fake.detail("movie", "329865"), (error: unknown) => error === unconfigured);
  await assert.rejects(fake.availability("movie", "329865", "US"), (error: unknown) => error === unconfigured);
  assert.equal(fake.calls.length, 3);
  const once = new CatalogUnavailable("once");
  fake.failNext(once);
  await assert.rejects(fake.search("movie", "Arrival"), (error: unknown) => error === once);
  await assert.rejects(fake.search("movie", "Arrival"), (error: unknown) => error === unconfigured);
  fake.recover();
  assert.equal((await fake.search("movie", "Arrival")).length, 1);
});

// ---------------------------------------------------------------- FakeCatalog: signals

test("an already-aborted signal is refused with the aborted error on every method, after the call is recorded", async () => {
  const fake = movies();
  const controller = new AbortController();
  const ranOut = new CatalogUnavailable("The 20s lookup budget ran out");
  controller.abort(ranOut);
  const { signal } = controller;
  await assert.rejects(fake.search("movie", "Arrival", { signal }), (error: unknown) => error === ranOut);
  await assert.rejects(fake.detail("movie", "329865", { signal }), (error: unknown) => error === ranOut);
  await assert.rejects(fake.availability("movie", "329865", "US", { signal }), (error: unknown) => error === ranOut);
  assert.equal(fake.calls.length, 3);

  const bare = new AbortController();
  bare.abort();
  await assert.rejects(fake.search("movie", "Arrival", { signal: bare.signal }), (error: unknown) => error instanceof CatalogUnavailable && /tmdb: the request was aborted/.test(error.message));
  assert.equal((await fake.search("movie", "Arrival", { signal: new AbortController().signal })).length, 1, "a live signal changes nothing");
});

test("stallNext holds the next call until its signal aborts and then throws the aborted error; without a signal it refuses to hang", async () => {
  const fake = movies();
  fake.stallNext();
  const controller = new AbortController();
  let settled = false;
  const pending = fake.search("movie", "Arrival", { signal: controller.signal }).then(
    () => {
      settled = true;
      throw new Error("resolved");
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "still waiting");
  const ranOut = new CatalogUnavailable("The 20s lookup budget ran out");
  controller.abort(ranOut);
  assert.equal(await pending, ranOut);
  assert.equal(fake.calls.length, 1);
  assert.equal((await fake.search("movie", "Arrival")).length, 1, "one shot");

  fake.stallNext("detail");
  assert.equal((await fake.search("movie", "Arrival")).length, 1, "another method is not stalled");
  await assert.rejects(fake.detail("movie", "329865"), { message: /stallNext needs a signal on detail/ });
  assert.equal((await fake.detail("movie", "329865")).name, "Arrival", "the refusal used up the stall");
});

// ---------------------------------------------------------------- environment and coverage

test("readEnv reads a variable from the env it is given, trimmed, and treats blank as unset; requireEnv throws CatalogUnconfigured naming the variable", () => {
  const env = { LIFE_TMDB_KEY: "  tok  ", LIFE_REGION: "", LIFE_IGDB_CLIENT_ID: undefined };
  assert.equal(readEnv(env, "LIFE_TMDB_KEY"), "tok");
  assert.equal(readEnv(env, "LIFE_REGION"), undefined);
  assert.equal(readEnv(env, "LIFE_IGDB_CLIENT_ID"), undefined);
  assert.equal(requireEnv(env, "LIFE_TMDB_KEY"), "tok");
  assert.throws(
    () => requireEnv(env, "LIFE_IGDB_CLIENT_SECRET"),
    (error: unknown) => error instanceof CatalogUnconfigured && error.variable === "LIFE_IGDB_CLIENT_SECRET" && error.message === "LIFE_IGDB_CLIENT_SECRET is not set in the root .env",
  );
});

test("readEnv on a plain object never consults the root .env, so tests decide what is set", () => {
  // The root .env sets LIFE_DATABASE_URL; through a plain object it is invisible.
  assert.equal(readEnv({}, "LIFE_DATABASE_URL"), undefined);
});

test("assertCovers throws the shared wording for a medium the adapter does not answer for, and is silent otherwise", () => {
  const fake = new FakeCatalog({ source: "igdb" });
  assert.doesNotThrow(() => assertCovers(fake, "game"));
  assert.throws(() => assertCovers(fake, "book"), /^Error: igdb does not cover book$/);
  assert.throws(() => assertCovers({ source: "openlibrary", media: ["book"] }, "movie"), /openlibrary does not cover movie/);
});
