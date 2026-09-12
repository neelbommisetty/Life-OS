// Constructed links (LEISURE D89): the availability rows no source hands us but
// a URL template can build. Audible, Libby, and Kindle search links for books
// from title, author, and ISBN, which are guesses and so `constructed: true`;
// store pages for games from IGDB's external ids through a per-store template,
// falling back to the game's websites list, which are the source's own listing
// and so `constructed: false`; TMDB image URLs from the configuration's base
// path and size; IGDB cover URLs rewritten from the thumbnail to the big cover.
// No row made here carries a price. Pure: nothing here talks to the network.
// The display names and the region normalizer live here so the three adapters
// and the CLI agree on them.

import type { Availability, CatalogSource } from "../../contract.ts";

/** How each source is named in candidates, warnings, and `life doctor`. */
export const SOURCE_NAMES: Record<CatalogSource, string> = { tmdb: "TMDB", openlibrary: "Open Library", igdb: "IGDB" };

/** The three constructed book links, by the name they carry. */
export const BOOK_LINK_NAMES = { audible: "Audible", libby: "Libby", kindle: "Kindle" } as const;

export type StoreKey = "steam" | "gog" | "epic" | "playstation" | "xbox" | "eshop" | "itch" | "appstore" | "play";

/** How each store is named on an availability row. */
export const STORE_NAMES: Record<StoreKey, string> = {
  steam: "Steam",
  gog: "GOG",
  epic: "Epic Games Store",
  playstation: "PlayStation Store",
  xbox: "Xbox",
  eshop: "Nintendo eShop",
  itch: "itch.io",
  appstore: "App Store",
  play: "Google Play",
};

/**
 * IGDB `external_games.external_game_source` ids that name a store (the same
 * numbers the deprecated `category` used). IGDB has no eShop source today; an
 * adapter that learns one passes it through `storeLinks`' `sources`.
 */
export const IGDB_STORE_SOURCES: Readonly<Record<number, StoreKey>> = {
  1: "steam",
  5: "gog",
  11: "xbox",
  13: "appstore",
  15: "play",
  26: "epic",
  30: "itch",
  36: "playstation",
};

/** IGDB `websites.type` ids that point at a store page (the same numbers the deprecated `category` used). */
export const IGDB_STORE_WEBSITES: Readonly<Record<number, StoreKey>> = {
  10: "appstore",
  11: "appstore",
  12: "play",
  13: "steam",
  15: "itch",
  16: "epic",
  17: "gog",
};

/** An IGDB `external_games` row, as much of it as a link needs. */
export type ExternalGame = { source: number | null; uid: string | null; url?: string | null };
/** An IGDB `websites` row. */
export type Website = { type: number | null; url: string | null };

// ---------------------------------------------------------------- regions

const DEFAULT_REGION = "US";

/** Amazon and Audible storefronts by region; anything else falls back to the US one. */
const AMAZON_HOSTS: Readonly<Record<string, string>> = {
  US: "www.amazon.com",
  GB: "www.amazon.co.uk",
  CA: "www.amazon.ca",
  AU: "www.amazon.com.au",
  DE: "www.amazon.de",
  FR: "www.amazon.fr",
  IT: "www.amazon.it",
  ES: "www.amazon.es",
  IN: "www.amazon.in",
  JP: "www.amazon.co.jp",
};
const AUDIBLE_HOSTS: Readonly<Record<string, string>> = {
  US: "www.audible.com",
  GB: "www.audible.co.uk",
  CA: "www.audible.ca",
  AU: "www.audible.com.au",
  DE: "www.audible.de",
  FR: "www.audible.fr",
  IT: "www.audible.it",
  ES: "www.audible.es",
  IN: "www.audible.in",
  JP: "www.audible.co.jp",
};
/** The locale a store path wants for a region; a region we do not know gets English with its own code. */
const STORE_LOCALES: Readonly<Record<string, string>> = {
  US: "en-us",
  GB: "en-gb",
  CA: "en-ca",
  AU: "en-au",
  DE: "de-de",
  FR: "fr-fr",
  IT: "it-it",
  ES: "es-es",
  IN: "en-in",
  JP: "ja-jp",
};

/** A region as the sources want it: a two-letter upper-case code, `US` for anything else (LIFE_REGION's default). */
export function normalizeRegion(region: string | null | undefined): string {
  const upper = (region ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : DEFAULT_REGION;
}

function storeLocale(region: string): string {
  return STORE_LOCALES[region] ?? `en-${region.toLowerCase()}`;
}

function row(kind: Availability["kind"], name: string, url: string, region: string, constructed: boolean): Availability {
  return { kind, name, url, region, price: null, constructed };
}

// ---------------------------------------------------------------- books

export type BookLinkInput = {
  title: string;
  author?: string | null;
  isbn?: string | null;
  /** Neel's region; defaults to US. */
  region?: string;
  /** A Libby library key (the subdomain of its OverDrive site) when known; without one the Libby link searches OverDrive across libraries. */
  library?: string | null;
};

/** `title author` with the spaces tidied: what every book search box takes. */
function bookQuery(input: BookLinkInput): string {
  return [input.title, input.author ?? ""]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
}

/** An ISBN with its hyphens and spaces removed, or null when the text is not one. */
function cleanIsbn(isbn: string | null | undefined): string | null {
  const digits = (isbn ?? "").replace(/[-\s]/g, "").toUpperCase();
  return /^(\d{9}[\dX]|\d{13})$/.test(digits) ? digits : null;
}

/** The Audible search for a title and author in the region's storefront. */
export function audibleLink(input: BookLinkInput): Availability {
  const region = normalizeRegion(input.region);
  const url = new URL(`https://${AUDIBLE_HOSTS[region] ?? AUDIBLE_HOSTS[DEFAULT_REGION]}/search`);
  url.searchParams.set("keywords", bookQuery(input));
  return row("listen", BOOK_LINK_NAMES.audible, url.toString(), region, true);
}

/** The Libby search at `library` when one is known, else OverDrive's cross-library search, which is what Libby opens. */
export function libbyLink(input: BookLinkInput): Availability {
  const region = normalizeRegion(input.region);
  const query = bookQuery(input);
  const library = (input.library ?? "").trim().toLowerCase();
  const url = library
    ? `https://libbyapp.com/search/${encodeURIComponent(library)}/query-${encodeURIComponent(query)}/page-1`
    : (() => {
        const search = new URL("https://www.overdrive.com/search");
        search.searchParams.set("q", query);
        return search.toString();
      })();
  return row("borrow", BOOK_LINK_NAMES.libby, url, region, true);
}

/** The Kindle store search in the region's Amazon: by ISBN when one is given (Amazon resolves it to the edition family), else by title and author. */
export function kindleLink(input: BookLinkInput): Availability {
  const region = normalizeRegion(input.region);
  const url = new URL(`https://${AMAZON_HOSTS[region] ?? AMAZON_HOSTS[DEFAULT_REGION]}/s`);
  url.searchParams.set("k", cleanIsbn(input.isbn) ?? bookQuery(input));
  url.searchParams.set("i", "digital-text");
  return row("buy", BOOK_LINK_NAMES.kindle, url.toString(), region, true);
}

/** Audible, Libby, and Kindle, in that order. Empty when there is no title to search for. */
export function bookLinks(input: BookLinkInput): Availability[] {
  if (!input.title.trim()) return [];
  return [audibleLink(input), libbyLink(input), kindleLink(input)];
}

// ---------------------------------------------------------------- game stores

const SLUG = /^[a-z0-9][a-z0-9_-]*$/i;
const DIGITS = /^\d+$/;

/**
 * The store page for an external id, or null when the template cannot use the
 * id as IGDB spells it (a numeric GOG product id, an Epic namespace hash), so
 * the caller falls back to the row's own URL or the websites list.
 */
export function storeUrl(store: StoreKey, uid: string, region = DEFAULT_REGION): string | null {
  const id = uid.trim();
  if (!id) return null;
  const locale = storeLocale(normalizeRegion(region));
  switch (store) {
    case "steam":
      return DIGITS.test(id) ? `https://store.steampowered.com/app/${id}` : null;
    case "gog":
      return SLUG.test(id) && !DIGITS.test(id) ? `https://www.gog.com/game/${id}` : null;
    case "epic":
      return SLUG.test(id) && !DIGITS.test(id) && !/^[0-9a-f]{32}$/i.test(id) ? `https://store.epicgames.com/p/${id}` : null;
    case "playstation":
      return /^[A-Z0-9_-]+$/i.test(id) ? `https://store.playstation.com/${locale}/product/${id}` : null;
    case "xbox":
      return /^[A-Z0-9]{12}$/i.test(id) ? `https://www.microsoft.com/store/productId/${id.toUpperCase()}` : null;
    case "eshop":
      return DIGITS.test(id) ? `https://ec.nintendo.com/apps/${id}/${normalizeRegion(region)}` : null;
    case "appstore":
      return DIGITS.test(id) ? `https://apps.apple.com/${normalizeRegion(region).toLowerCase()}/app/id${id}` : null;
    case "play":
      return /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(id) ? `https://play.google.com/store/apps/details?id=${id}` : null;
    case "itch":
      return null;
  }
}

function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Store rows for a game: one per store IGDB knows an external id for, through
 * the template (or the row's own URL when the template cannot use the id),
 * then, for stores still without a row, the websites list. `kind` is `buy`; a
 * subscription that includes the game is Neel's to say (D97). One row per URL.
 * The rows are `constructed: false`: the source says the game is listed there,
 * and the template only spells the page's address, so `where` shows no `*`.
 */
export function storeLinks(externals: ExternalGame[], websites: Website[] = [], opts: { region?: string; sources?: Readonly<Record<number, StoreKey>> } = {}): Availability[] {
  const region = normalizeRegion(opts.region);
  const sources = opts.sources ?? IGDB_STORE_SOURCES;
  const rows: Availability[] = [];
  const covered = new Set<StoreKey>();
  const seen = new Set<string>();
  const add = (store: StoreKey, url: string): void => {
    if (seen.has(url)) return;
    seen.add(url);
    covered.add(store);
    rows.push(row("buy", STORE_NAMES[store], url, region, false));
  };
  for (const external of externals) {
    const store = external.source === null ? undefined : sources[external.source];
    if (!store) continue;
    const url = (external.uid ? storeUrl(store, external.uid, region) : null) ?? (isHttpUrl(external.url) ? external.url : null);
    if (url) add(store, url);
  }
  for (const website of websites) {
    const store = website.type === null ? undefined : IGDB_STORE_WEBSITES[website.type];
    if (!store || covered.has(store) || !isHttpUrl(website.url)) continue;
    add(store, website.url);
  }
  return rows;
}

// ---------------------------------------------------------------- images

/** The poster size to ask TMDB for: `wanted` when the configuration lists it, else the nearest larger width, else the largest, else `original`. */
export function tmdbImageSize(sizes: string[], wanted = "w500"): string {
  if (sizes.includes(wanted)) return wanted;
  const wantedWidth = Number(/^w(\d+)$/.exec(wanted)?.[1] ?? NaN);
  const widths = sizes
    .map((size) => ({ size, width: Number(/^w(\d+)$/.exec(size)?.[1] ?? NaN) }))
    .filter((entry) => !Number.isNaN(entry.width))
    .sort((a, b) => a.width - b.width);
  const larger = Number.isNaN(wantedWidth) ? undefined : widths.find((entry) => entry.width >= wantedWidth);
  if (larger) return larger.size;
  if (widths.length) return widths[widths.length - 1]!.size;
  return sizes.includes("original") ? "original" : wanted;
}

/** `base + size + path` from TMDB's configuration; null without a path. `base` is `images.secure_base_url`. */
export function tmdbImageUrl(config: { baseUrl: string; sizes: string[] }, path: string | null | undefined, wanted = "w500"): string | null {
  if (!path) return null;
  const base = config.baseUrl.replace(/\/+$/, "");
  const size = tmdbImageSize(config.sizes, wanted);
  return `${base}/${size}${path.startsWith("/") ? path : `/${path}`}`;
}

/** An IGDB image URL rewritten to https and `size`: `//images.igdb.com/…/t_thumb/co1r7f.jpg` → `https://images.igdb.com/…/t_cover_big/co1r7f.jpg`. */
export function igdbImageUrl(url: string | null | undefined, size = "t_cover_big"): string | null {
  if (!url) return null;
  const absolute = url.startsWith("//") ? `https:${url}` : url.replace(/^http:\/\//, "https://");
  return absolute.replace(/\/t_[a-z0-9_]+\//, `/${size}/`);
}
