import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilitySchema } from "../../contract.ts";
import {
  BOOK_LINK_NAMES,
  IGDB_STORE_SOURCES,
  IGDB_STORE_WEBSITES,
  SOURCE_NAMES,
  STORE_NAMES,
  audibleLink,
  bookLinks,
  igdbImageUrl,
  kindleLink,
  libbyLink,
  storeLinks,
  storeUrl,
  tmdbImageSize,
  tmdbImageUrl,
  type StoreKey,
} from "./links.ts";

const params = (url: string): Record<string, string> => Object.fromEntries(new URL(url).searchParams.entries());
const origin = (url: string): string => new URL(url).origin + new URL(url).pathname;

// ---------------------------------------------------------------- names

test("every source and every store has a display name, and every IGDB id maps to a named store", () => {
  assert.deepEqual(SOURCE_NAMES, { tmdb: "TMDB", openlibrary: "Open Library", igdb: "IGDB" });
  assert.deepEqual(BOOK_LINK_NAMES, { audible: "Audible", libby: "Libby", kindle: "Kindle" });
  for (const store of [...Object.values(IGDB_STORE_SOURCES), ...Object.values(IGDB_STORE_WEBSITES)]) {
    assert.equal(typeof STORE_NAMES[store], "string", `${store} is named`);
    assert.ok(STORE_NAMES[store].length > 0);
  }
  assert.equal(IGDB_STORE_SOURCES[1], "steam");
  assert.equal(IGDB_STORE_SOURCES[26], "epic");
  assert.equal(IGDB_STORE_SOURCES[36], "playstation");
  assert.equal(IGDB_STORE_SOURCES[11], "xbox");
  assert.equal(IGDB_STORE_SOURCES[5], "gog");
  assert.ok(!Object.values(IGDB_STORE_SOURCES).includes("eshop"), "IGDB supplies no eShop source today; the template waits for one");
});

// ---------------------------------------------------------------- books

test("bookLinks builds Audible, Libby, and Kindle searches from title and author, each constructed, priced null, in the region", () => {
  const links = bookLinks({ title: "Skyward", author: "Brandon Sanderson" });
  assert.deepEqual(
    links.map((link) => [link.kind, link.name, link.region, link.price, link.constructed]),
    [
      ["listen", "Audible", "US", null, true],
      ["borrow", "Libby", "US", null, true],
      ["buy", "Kindle", "US", null, true],
    ],
  );
  for (const link of links) assert.ok(availabilitySchema.safeParse(link).success, `${link.name} is a valid Availability`);
  assert.equal(origin(links[0]!.url), "https://www.audible.com/search");
  assert.deepEqual(params(links[0]!.url), { keywords: "Skyward Brandon Sanderson" });
  assert.equal(origin(links[1]!.url), "https://www.overdrive.com/search");
  assert.deepEqual(params(links[1]!.url), { q: "Skyward Brandon Sanderson" });
  assert.equal(origin(links[2]!.url), "https://www.amazon.com/s");
  assert.deepEqual(params(links[2]!.url), { k: "Skyward Brandon Sanderson", i: "digital-text" });
});

test("a title alone searches by title; spacing is tidied; an empty title gives no links", () => {
  const [audible] = bookLinks({ title: "  Project   Hail Mary " });
  assert.deepEqual(params(audible!.url), { keywords: "Project Hail Mary" });
  assert.deepEqual(params(kindleLink({ title: "Dune", author: null }).url), { k: "Dune", i: "digital-text" });
  assert.deepEqual(bookLinks({ title: "   " }), []);
});

test("the Kindle search takes the ISBN when one is given, with hyphens and spaces removed, and ignores something that is not an ISBN", () => {
  assert.deepEqual(params(kindleLink({ title: "Skyward", author: "Brandon Sanderson", isbn: "978-0-399-55677-3" }).url), { k: "9780399556773", i: "digital-text" });
  assert.deepEqual(params(kindleLink({ title: "Skyward", isbn: "0 399 55677 x" }).url), { k: "039955677X", i: "digital-text" });
  assert.deepEqual(params(kindleLink({ title: "Skyward", author: "Brandon Sanderson", isbn: "not-an-isbn" }).url), { k: "Skyward Brandon Sanderson", i: "digital-text" });
  assert.deepEqual(params(audibleLink({ title: "Skyward", author: "Brandon Sanderson", isbn: "9780399556773" }).url), { keywords: "Skyward Brandon Sanderson" }, "Audible ignores the ISBN: audiobooks carry their own");
});

test("the Libby link goes to the library's own search when a library key is known", () => {
  const link = libbyLink({ title: "Skyward", author: "Brandon Sanderson", library: "SFPL" });
  assert.equal(link.url, "https://libbyapp.com/search/sfpl/query-Skyward%20Brandon%20Sanderson/page-1");
  assert.equal(link.name, "Libby");
  assert.equal(link.kind, "borrow");
  assert.equal(origin(libbyLink({ title: "Skyward", library: "  " }).url), "https://www.overdrive.com/search", "a blank key is no key");
});

test("book links follow the region's storefronts, fall back to the US ones for a region without its own, and always carry the region asked for", () => {
  const gb = bookLinks({ title: "Skyward", region: "gb" });
  assert.deepEqual(gb.map((link) => link.region), ["GB", "GB", "GB"]);
  assert.equal(origin(gb[0]!.url), "https://www.audible.co.uk/search");
  assert.equal(origin(gb[2]!.url), "https://www.amazon.co.uk/s");
  const jp = bookLinks({ title: "Skyward", region: "JP" });
  assert.equal(origin(jp[0]!.url), "https://www.audible.co.jp/search");
  assert.equal(origin(jp[2]!.url), "https://www.amazon.co.jp/s");
  const nz = bookLinks({ title: "Skyward", region: "NZ" });
  assert.deepEqual(nz.map((link) => link.region), ["NZ", "NZ", "NZ"]);
  assert.equal(origin(nz[0]!.url), "https://www.audible.com/search");
  assert.equal(origin(nz[2]!.url), "https://www.amazon.com/s");
  assert.deepEqual(bookLinks({ title: "Skyward", region: "usa" }).map((link) => link.region), ["US", "US", "US"], "something that is not a region code is US");
});

// ---------------------------------------------------------------- game stores

test("storeUrl builds each store's page from the id IGDB holds, and returns null when the id is not in a form the template can use", () => {
  assert.equal(storeUrl("steam", "1145360"), "https://store.steampowered.com/app/1145360");
  assert.equal(storeUrl("steam", "hades"), null);
  assert.equal(storeUrl("gog", "hades"), "https://www.gog.com/game/hades");
  assert.equal(storeUrl("gog", "1207658924"), null, "a numeric GOG product id has no page URL of its own");
  assert.equal(storeUrl("epic", "hades"), "https://store.epicgames.com/p/hades");
  assert.equal(storeUrl("epic", "min-min-min-1a2b"), "https://store.epicgames.com/p/min-min-min-1a2b");
  assert.equal(storeUrl("epic", "0123456789abcdef0123456789abcdef"), null, "a namespace hash is not a slug");
  assert.equal(storeUrl("epic", "12345"), null);
  assert.equal(storeUrl("playstation", "UP2131-CUSA20124_00-HADES00000000000"), "https://store.playstation.com/en-us/product/UP2131-CUSA20124_00-HADES00000000000");
  assert.equal(storeUrl("playstation", "UP2131-CUSA20124_00-HADES00000000000", "GB"), "https://store.playstation.com/en-gb/product/UP2131-CUSA20124_00-HADES00000000000");
  assert.equal(storeUrl("playstation", "has spaces"), null);
  assert.equal(storeUrl("xbox", "9p8pcrt0jw8t"), "https://www.microsoft.com/store/productId/9P8PCRT0JW8T");
  assert.equal(storeUrl("xbox", "not-a-store-id"), null);
  assert.equal(storeUrl("eshop", "70010000032154"), "https://ec.nintendo.com/apps/70010000032154/US");
  assert.equal(storeUrl("eshop", "70010000032154", "GB"), "https://ec.nintendo.com/apps/70010000032154/GB");
  assert.equal(storeUrl("eshop", "hades"), null);
  assert.equal(storeUrl("appstore", "1615851040"), "https://apps.apple.com/us/app/id1615851040");
  assert.equal(storeUrl("appstore", "1615851040", "GB"), "https://apps.apple.com/gb/app/id1615851040");
  assert.equal(storeUrl("play", "com.netflix.NGP.Hades"), "https://play.google.com/store/apps/details?id=com.netflix.NGP.Hades");
  assert.equal(storeUrl("play", "hades"), null);
  assert.equal(storeUrl("itch", "12345"), null, "itch.io pages live under the developer's subdomain; only the websites list knows them");
  assert.equal(storeUrl("steam", "   "), null);
  assert.equal(storeUrl("steam", " 1145360 "), "https://store.steampowered.com/app/1145360", "ids are trimmed");
});

test("storeLinks turns external ids into buy rows through the templates, in order, not constructed (the source lists them) and priced null, and validates as Availability", () => {
  const rows = storeLinks(
    [
      { source: 1, uid: "1145360" },
      { source: 26, uid: "hades" },
      { source: 36, uid: "UP2131-CUSA20124_00-HADES00000000000" },
      { source: 11, uid: "9P8PCRT0JW8T" },
      { source: 5, uid: "hades" },
    ],
    [],
    { region: "US" },
  );
  assert.deepEqual(
    rows.map((row) => [row.name, row.url]),
    [
      ["Steam", "https://store.steampowered.com/app/1145360"],
      ["Epic Games Store", "https://store.epicgames.com/p/hades"],
      ["PlayStation Store", "https://store.playstation.com/en-us/product/UP2131-CUSA20124_00-HADES00000000000"],
      ["Xbox", "https://www.microsoft.com/store/productId/9P8PCRT0JW8T"],
      ["GOG", "https://www.gog.com/game/hades"],
    ],
  );
  for (const row of rows) {
    assert.equal(row.kind, "buy");
    assert.equal(row.region, "US");
    assert.equal(row.price, null);
    assert.equal(row.constructed, false, "a store page the source lists is real, not a guessed search");
    assert.ok(availabilitySchema.safeParse(row).success);
  }
});

test("storeLinks falls back to the row's own URL when the template cannot use the id, then to the websites list for stores still without a row", () => {
  const rows = storeLinks(
    [
      { source: 5, uid: "1207658924", url: "https://www.gog.com/en/game/hades" },
      { source: 26, uid: "0123456789abcdef0123456789abcdef", url: null },
      { source: 30, uid: "248521" },
    ],
    [
      { type: 16, url: "https://store.epicgames.com/en-US/p/hades" },
      { type: 15, url: "https://supergiantgames.itch.io/hades" },
      { type: 13, url: "https://store.steampowered.com/app/1145360" },
      { type: 17, url: "https://www.gog.com/game/hades_dupe" },
      { type: 1, url: "https://www.supergiantgames.com/games/hades" },
      { type: 3, url: "https://en.wikipedia.org/wiki/Hades_(video_game)" },
    ],
  );
  assert.deepEqual(
    rows.map((row) => [row.name, row.url]),
    [
      ["GOG", "https://www.gog.com/en/game/hades"],
      ["Epic Games Store", "https://store.epicgames.com/en-US/p/hades"],
      ["itch.io", "https://supergiantgames.itch.io/hades"],
      ["Steam", "https://store.steampowered.com/app/1145360"],
    ],
    "GOG from the row's URL; Epic and itch from websites since no template applied; Steam from websites since no external id; the second GOG site skipped as GOG is covered; official site and Wikipedia are not stores",
  );
});

test("storeLinks skips unknown sources, rows without a usable id or URL, and non-http URLs, and never repeats a URL", () => {
  const rows = storeLinks(
    [
      { source: 999, uid: "x" },
      { source: null, uid: "1145360" },
      { source: 1, uid: null },
      { source: 1, uid: null, url: "steam://run/1145360" },
      { source: 1, uid: "1145360" },
      { source: 1, uid: "1145360" },
      { source: 13, uid: "1615851040" },
    ],
    [
      { type: 13, url: "https://store.steampowered.com/app/1145360" },
      { type: null, url: "https://example.com" },
      { type: 10, url: null },
      { type: 12, url: "not a url" },
    ],
  );
  assert.deepEqual(
    rows.map((row) => row.url),
    ["https://store.steampowered.com/app/1145360", "https://apps.apple.com/us/app/id1615851040"],
  );
  assert.deepEqual(storeLinks([], []), []);
});

test("storeLinks takes the region for regional templates and extra source ids, which is how an eShop id arrives when IGDB supplies one", () => {
  const rows = storeLinks(
    [
      { source: 36, uid: "EP2131-CUSA20124_00-HADES00000000000" },
      { source: 200, uid: "70010000032154" },
    ],
    [],
    { region: "GB", sources: { ...IGDB_STORE_SOURCES, 200: "eshop" satisfies StoreKey } },
  );
  assert.deepEqual(
    rows.map((row) => [row.name, row.url, row.region]),
    [
      ["PlayStation Store", "https://store.playstation.com/en-gb/product/EP2131-CUSA20124_00-HADES00000000000", "GB"],
      ["Nintendo eShop", "https://ec.nintendo.com/apps/70010000032154/GB", "GB"],
    ],
  );
  assert.deepEqual(storeLinks([{ source: 1, uid: "10" }], [], { region: "zz" }).map((row) => row.region), ["ZZ"], "the region code is kept as given, upper-cased");
});

// ---------------------------------------------------------------- images

test("tmdbImageSize picks the wanted size, else the nearest larger width, else the largest width, else original", () => {
  const sizes = ["w92", "w154", "w185", "w342", "w500", "w780", "original"];
  assert.equal(tmdbImageSize(sizes), "w500");
  assert.equal(tmdbImageSize(sizes, "w780"), "w780");
  assert.equal(tmdbImageSize(["w92", "w342", "w780", "original"], "w500"), "w780");
  assert.equal(tmdbImageSize(["w92", "w342"], "w500"), "w342");
  assert.equal(tmdbImageSize(["original"], "w500"), "original");
  assert.equal(tmdbImageSize([], "w500"), "w500", "nothing to choose from: ask for what was wanted");
  assert.equal(tmdbImageSize(["h632", "original"], "w500"), "original", "heights are not widths");
});

test("tmdbImageUrl joins the configuration's base path, the size, and the poster path; null without a path", () => {
  const config = { baseUrl: "https://image.tmdb.org/t/p/", sizes: ["w92", "w500", "original"] };
  assert.equal(tmdbImageUrl(config, "/hLudzvGfpi6JlwUnsNhXwKKg4j.jpg"), "https://image.tmdb.org/t/p/w500/hLudzvGfpi6JlwUnsNhXwKKg4j.jpg");
  assert.equal(tmdbImageUrl(config, "/hLudzvGfpi6JlwUnsNhXwKKg4j.jpg", "original"), "https://image.tmdb.org/t/p/original/hLudzvGfpi6JlwUnsNhXwKKg4j.jpg");
  assert.equal(tmdbImageUrl({ baseUrl: "https://image.tmdb.org/t/p", sizes: ["w500"] }, "poster.jpg"), "https://image.tmdb.org/t/p/w500/poster.jpg", "one slash between each part");
  assert.equal(tmdbImageUrl(config, null), null);
  assert.equal(tmdbImageUrl(config, undefined), null);
  assert.equal(tmdbImageUrl(config, ""), null);
});

test("igdbImageUrl rewrites the thumbnail to https and t_cover_big, or to the size asked for", () => {
  assert.equal(igdbImageUrl("//images.igdb.com/igdb/image/upload/t_thumb/co1r7f.jpg"), "https://images.igdb.com/igdb/image/upload/t_cover_big/co1r7f.jpg");
  assert.equal(igdbImageUrl("http://images.igdb.com/igdb/image/upload/t_thumb/co1r7f.jpg"), "https://images.igdb.com/igdb/image/upload/t_cover_big/co1r7f.jpg");
  assert.equal(igdbImageUrl("https://images.igdb.com/igdb/image/upload/t_cover_small/co1r7f.jpg"), "https://images.igdb.com/igdb/image/upload/t_cover_big/co1r7f.jpg");
  assert.equal(igdbImageUrl("https://images.igdb.com/igdb/image/upload/t_cover_big/co1r7f.jpg"), "https://images.igdb.com/igdb/image/upload/t_cover_big/co1r7f.jpg", "already right stays right");
  assert.equal(igdbImageUrl("//images.igdb.com/igdb/image/upload/t_thumb/co1r7f.jpg", "t_1080p"), "https://images.igdb.com/igdb/image/upload/t_1080p/co1r7f.jpg");
  assert.equal(igdbImageUrl(null), null);
  assert.equal(igdbImageUrl(undefined), null);
  assert.equal(igdbImageUrl(""), null);
  assert.equal(igdbImageUrl("https://example.com/no-size-segment.jpg"), "https://example.com/no-size-segment.jpg", "a URL without a size segment is left alone");
});
