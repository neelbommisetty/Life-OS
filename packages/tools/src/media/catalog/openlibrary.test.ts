// Open Library adapter tests (LEISURE D71, D81): the pure mapping functions
// against recorded fixtures, then the adapter end to end through a fake fetch
// that serves those same fixtures by URL, so nothing here touches the
// network. The fake also records every request's method and headers so the
// User-Agent and query strings are checked exactly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { availabilitySchema, factsSchema, titleLength } from "../../contract.ts";
import type { Candidate, Detail } from "./adapter.ts";
import {
  OpenLibraryAdapter,
  USER_AGENT,
  coverUrl,
  editionFormat,
  mapAvailability,
  mapDescription,
  mapDetail,
  mapEditions,
  mapSearch,
  workIdFromKey,
  yearOfDate,
} from "./openlibrary.ts";

const dir = fileURLToPath(new URL("./fixtures/openlibrary/", import.meta.url));
function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(`${dir}openlibrary-${name}.json`, "utf8")) as T;
}

type RawSearch = Parameters<typeof mapSearch>[0];
const search = fixture<RawSearch>("search");
const workString = fixture<Parameters<typeof mapDetail>[0]>("work-string");
const workObject = fixture<Parameters<typeof mapDetail>[0]>("work-object");
const authorTolkien = fixture<{ key?: string; name?: string }>("author-tolkien");
type RawEditions = { entries?: Parameters<typeof mapEditions>[0] };
const editionsMixed = fixture<RawEditions>("editions-mixed").entries ?? [];
const editionsObject = fixture<RawEditions>("editions-object").entries ?? [];

// ---------------------------------------------------------------- pure mapping

test("workIdFromKey strips the /works/ prefix", () => {
  assert.equal(workIdFromKey("/works/OL27258W"), "OL27258W");
  assert.equal(workIdFromKey("OL27258W"), "OL27258W");
});

test("mapSearch maps every doc, duplicate works included, in the source's order, capped at 10", () => {
  const candidates = mapSearch(search);
  assert.equal(candidates.length, 3);
  assert.deepEqual(
    candidates.map((c) => [c.source, c.externalId, c.name, c.year, c.creators, c.editionCount]),
    [
      ["openlibrary", "OL27258W", "The Hobbit", 1937, ["J. R. R. Tolkien"], 120],
      ["openlibrary", "OL262758W", "The Hobbit", 1937, ["J. R. R. Tolkien"], 3],
      ["openlibrary", "OL15168016W", "The Hobbit: A Study Guide", 2002, ["SparkNotes"], 2],
    ],
  );
  assert.equal(candidates[0]!.cover, "https://covers.openlibrary.org/b/id/6979861-L.jpg");
  assert.equal(candidates[2]!.cover, null, "a doc with no cover_i has no cover");
  for (const c of candidates) {
    assert.equal(c.category, null);
    assert.equal(c.sourceRating, null);
    assert.equal(c.inLibrary, null);
  }
});

test("mapSearch caps at 10 even when the source hands back more", () => {
  const docs = Array.from({ length: 15 }, (_, i) => ({ key: `/works/OL${i}W`, title: `Title ${i}` }));
  assert.equal(mapSearch({ docs }).length, 10);
});

test("mapDescription reads a plain string", () => {
  assert.equal(mapDescription("A tale."), "A tale.");
  assert.equal(mapDescription("   "), null);
  assert.equal(mapDescription(undefined), null);
});

test("mapDescription reads the { type, value } shape", () => {
  assert.equal(mapDescription({ type: "/type/text", value: "A tale." }), "A tale.");
  assert.equal(mapDescription({ type: "/type/text", value: "  " }), null);
  assert.equal(mapDescription({ type: "/type/text" }), null);
});

test("coverUrl builds the covers.openlibrary.org L-size URL, or null without an id", () => {
  assert.equal(coverUrl(6979861), "https://covers.openlibrary.org/b/id/6979861-L.jpg");
  assert.equal(coverUrl(null), null);
});

test("yearOfDate finds the 4-digit year in whatever shape Open Library sent", () => {
  assert.equal(yearOfDate("1937"), 1937);
  assert.equal(yearOfDate("Sep 21, 1937"), 1937);
  assert.equal(yearOfDate("1937-09-21"), 1937);
  assert.equal(yearOfDate(null), null);
  assert.equal(yearOfDate(undefined), null);
  assert.equal(yearOfDate("unknown"), null);
});

test("editionFormat maps physical_format text to a BookFormat", () => {
  assert.equal(editionFormat("Audio CD"), "audiobook");
  assert.equal(editionFormat("MP3 audiobook"), "audiobook");
  assert.equal(editionFormat("Kindle Edition"), "kindle");
  assert.equal(editionFormat("Ebook"), "kindle");
  assert.equal(editionFormat("Paperback"), "physical");
  assert.equal(editionFormat("Hardcover"), "physical");
  assert.equal(editionFormat(undefined), "physical");
});

test("mapEditions collects distinct formats in first-seen order, a page median, an ISBN, and one library link per edition with an ISBN", () => {
  const summary = mapEditions(editionsMixed);
  assert.deepEqual(summary.formats, ["physical", "audiobook", "kindle"]);
  assert.equal(summary.pages, 315, "median of 320 and 310, the two editions with a page count");
  assert.equal(summary.earliestYear, 1937);
  assert.equal(summary.isbn, "9780618260300", "the first edition's ISBN-13");
  assert.deepEqual(summary.links, [
    { label: "Open Library edition (ISBN 9780618260300)", url: "https://openlibrary.org/isbn/9780618260300" },
    { label: "Open Library edition (ISBN 9780007458424)", url: "https://openlibrary.org/isbn/9780007458424" },
    { label: "Open Library edition (ISBN 9780261103283)", url: "https://openlibrary.org/isbn/9780261103283" },
    { label: "Open Library edition (ISBN 0618968634)", url: "https://openlibrary.org/isbn/0618968634" },
  ]);
});

test("mapEditions falls back to the isbn_10 when there is no isbn_13", () => {
  const summary = mapEditions([{ isbn_10: ["0618260307"], physical_format: "Paperback" }]);
  assert.equal(summary.isbn, "0618260307");
});

test("mapEditions with no editions at all is empty and null throughout", () => {
  const summary = mapEditions([]);
  assert.deepEqual(summary, { formats: [], links: [], pages: null, earliestYear: null, isbn: null });
});

test("mapDetail with a string description: year and released from first_publish_date, pages and formats from the editions, series null", () => {
  const detail = mapDetail(workString, ["J. R. R. Tolkien"], editionsMixed);
  assert.equal(detail.name, "The Hobbit");
  assert.equal(detail.year, 1937);
  assert.deepEqual(detail.creators, ["J. R. R. Tolkien"]);
  assert.equal(detail.cover, "https://covers.openlibrary.org/b/id/6979861-L.jpg");
  assert.deepEqual(detail.length, { pages: 315 });
  assert.equal(detail.facts.synopsis, workString.description);
  assert.equal(detail.facts.released, "1937");
  assert.equal(detail.facts.pages, 315);
  assert.deepEqual(detail.facts.formats, ["physical", "audiobook", "kindle"]);
  assert.equal(detail.facts.series, null);
  assert.equal(detail.facts.links.length, 4);
  const parsed = factsSchema.safeParse({ ...detail.facts, availability: [] });
  assert.ok(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues));
  assert.ok(titleLength.safeParse(detail.length).success);
});

test("mapDetail with an object description and no first_publish_date falls back to the earliest edition year", () => {
  const detail = mapDetail(workObject, ["J. R. R. Tolkien"], editionsObject);
  assert.equal(detail.facts.synopsis, (workObject.description as { value: string }).value);
  assert.equal(detail.year, 2002, "the earliest of the object work's editions (2002, 2012)");
  assert.equal(detail.facts.released, "2002");
  assert.deepEqual(detail.facts.formats, ["physical", "kindle"], "Study Guide is physical, Ebook is kindle");
  assert.equal(detail.facts.pages, 59, "median of 60 and 58");
});

test("mapDetail prefers the work's own number_of_pages_median over the editions' median", () => {
  const detail = mapDetail({ ...workString, number_of_pages_median: 999 }, [], editionsMixed);
  assert.equal(detail.facts.pages, 999);
  assert.deepEqual(detail.length, { pages: 999 });
});

test("mapDetail with no pages anywhere has no length", () => {
  const detail = mapDetail({ title: "Untitled" }, [], []);
  assert.equal(detail.length, null);
  assert.equal(detail.facts.pages, null);
});

test("mapAvailability is bookLinks: Audible, Libby, Kindle, constructed, from the ISBN when there is one", () => {
  const links = mapAvailability({ title: "The Hobbit", author: "J. R. R. Tolkien", isbn: "9780618260300", region: "US" });
  assert.deepEqual(
    links.map((l) => l.kind),
    ["listen", "borrow", "buy"],
  );
  for (const link of links) {
    assert.equal(link.constructed, true);
    assert.equal(link.price, null);
    assert.ok(availabilitySchema.safeParse(link).success);
  }
  assert.ok(new URL(links[2]!.url).searchParams.get("k") === "9780618260300", "Kindle searches by ISBN when one is known");
});

// ---------------------------------------------------------------- the adapter, through a fake fetch

type Recorded = { url: string; method: string; headers: Record<string, string> };

function fakeFetch(routes: Record<string, unknown>, recorded: Recorded[]): typeof fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const path = new URL(url).pathname + new URL(url).search;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    recorded.push({ url: path, method: init?.method ?? "GET", headers });
    const key = Object.keys(routes).find((route) => path.startsWith(route));
    if (!key) {
      return new Response("not found", { status: 404 });
    }
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

test("adapter.search sends the documented query, a descriptive User-Agent, and maps the results", async () => {
  const recorded: Recorded[] = [];
  const fetchImpl = fakeFetch({ "/search.json": search }, recorded);
  const adapter = new OpenLibraryAdapter({ fetch: fetchImpl });
  const candidates = await adapter.search("book", "The Hobbit");
  assert.equal(candidates.length, 3);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]!.method, "GET");
  assert.equal(recorded[0]!.headers["user-agent"], USER_AGENT);
  const url = new URL(`https://openlibrary.org${recorded[0]!.url}`);
  assert.equal(url.pathname, "/search.json");
  assert.equal(url.searchParams.get("q"), "The Hobbit");
  assert.equal(url.searchParams.get("fields"), "key,title,author_name,first_publish_year,cover_i,edition_count,number_of_pages_median");
  assert.equal(url.searchParams.get("limit"), "10");
});

test("adapter.search on a medium it does not cover fails without any request", async () => {
  const recorded: Recorded[] = [];
  const adapter = new OpenLibraryAdapter({ fetch: fakeFetch({}, recorded) });
  await assert.rejects(() => adapter.search("movie" as never, "x"), /openlibrary does not cover movie/);
  assert.equal(recorded.length, 0);
});

test("adapter.detail fetches the work, its authors, and its editions, and maps them together", async () => {
  const recorded: Recorded[] = [];
  const fetchImpl = fakeFetch(
    {
      "/works/OL27258W/editions.json": editionsMixed.length ? { entries: editionsMixed } : { entries: [] },
      "/works/OL27258W.json": workString,
      "/authors/OL26320A.json": authorTolkien,
    },
    recorded,
  );
  const adapter = new OpenLibraryAdapter({ fetch: fetchImpl });
  const detail: Detail = await adapter.detail("book", "OL27258W");
  assert.equal(detail.name, "The Hobbit");
  assert.deepEqual(detail.creators, ["J. R. R. Tolkien"]);
  assert.equal(detail.year, 1937);
  assert.equal(detail.facts.formats.length, 3);
  assert.equal(recorded.length, 3, "one call each for the work, the author, and the editions");
  assert.ok(recorded.every((r) => r.headers["user-agent"] === USER_AGENT));
  assert.ok(recorded.some((r) => r.url.startsWith("/works/OL27258W.json")));
  assert.ok(recorded.some((r) => r.url.startsWith("/authors/OL26320A.json")));
  assert.ok(recorded.some((r) => r.url.startsWith("/works/OL27258W/editions.json")));
  const editionsCall = recorded.find((r) => r.url.startsWith("/works/OL27258W/editions.json"))!;
  assert.equal(new URL(`https://openlibrary.org${editionsCall.url}`).searchParams.get("limit"), "50");
});

test("adapter.detail fetches at most five authors", async () => {
  const manyAuthors = { ...workString, authors: Array.from({ length: 8 }, (_, i) => ({ author: { key: `/authors/OL${i}A` } })) };
  const recorded: Recorded[] = [];
  const fetchImpl = fakeFetch(
    {
      "/works/OL27258W/editions.json": { entries: [] },
      "/works/OL27258W.json": manyAuthors,
      "/authors/": { name: "Someone" },
    },
    recorded,
  );
  const adapter = new OpenLibraryAdapter({ fetch: fetchImpl });
  await adapter.detail("book", "OL27258W");
  const authorCalls = recorded.filter((r) => r.url.startsWith("/authors/"));
  assert.equal(authorCalls.length, 5);
});

test("adapter.detail on a work with no first_publish_date falls back to the editions", async () => {
  const recorded: Recorded[] = [];
  const fetchImpl = fakeFetch(
    {
      "/works/OL262758W/editions.json": { entries: editionsObject },
      "/works/OL262758W.json": workObject,
      "/authors/OL26320A.json": authorTolkien,
    },
    recorded,
  );
  const adapter = new OpenLibraryAdapter({ fetch: fetchImpl });
  const detail = await adapter.detail("book", "OL262758W");
  assert.equal(detail.year, 2002);
  assert.equal(detail.facts.synopsis, (workObject.description as { value: string }).value);
});

test("adapter.availability re-derives name, author, and ISBN from the work and editions and returns the constructed links", async () => {
  const recorded: Recorded[] = [];
  const fetchImpl = fakeFetch(
    {
      "/works/OL27258W/editions.json": { entries: editionsMixed },
      "/works/OL27258W.json": workString,
      "/authors/OL26320A.json": authorTolkien,
    },
    recorded,
  );
  const adapter = new OpenLibraryAdapter({ fetch: fetchImpl });
  const rows = await adapter.availability("book", "OL27258W", "gb");
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["listen", "borrow", "buy"],
  );
  for (const row of rows) {
    assert.equal(row.region, "GB");
    assert.ok(availabilitySchema.safeParse(row).success);
  }
  const kindle = rows[2]!;
  assert.equal(new URL(kindle.url).searchParams.get("k"), "9780618260300");
});

test("adapter.availability on a medium it does not cover fails without any request", async () => {
  const recorded: Recorded[] = [];
  const adapter = new OpenLibraryAdapter({ fetch: fakeFetch({}, recorded) });
  await assert.rejects(() => adapter.availability("game" as never, "x", "US"));
  assert.equal(recorded.length, 0);
});

test("an unknown work id surfaces as a source error, not a silent empty detail", async () => {
  const adapter = new OpenLibraryAdapter({ fetch: fakeFetch({}, []) });
  await assert.rejects(() => adapter.detail("book", "OL0W"), /Open Library/);
});

test("Candidate and Detail from mapping fit the shared contract shapes end to end", () => {
  const candidates: Candidate[] = mapSearch(search);
  assert.ok(candidates.length > 0);
  for (const c of candidates) {
    assert.equal(typeof c.externalId, "string");
    assert.ok(c.externalId.length > 0);
  }
  const detail = mapDetail(workString, ["J. R. R. Tolkien"], editionsMixed);
  const parsed = factsSchema.safeParse({ ...detail.facts, availability: [] });
  assert.ok(parsed.success);
});
