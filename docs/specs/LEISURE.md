# Leisure: the library and the diary

Working design, September 12, 2026. Status: first altitude agreed September 12 (D67 to D101); details level drafted the same day, revised after an adversarial review, and carried into the implementation brief in `packages/tools/README.md` ("The library"), itself revised after a second adversarial review against the code. Where the brief is more precise than this document, the brief wins. The first cut in that brief was authorized September 12 and is implemented; the second cut remains deferred. See [current scope](../STATUS.md#scope-register). This specification does not authorize work beyond that first cut. This is the piece Neel described as "something like Letterboxd, Goodreads" for movies, TV shows, games, and books. It follows the hands precedent in [HANDS.md](HANDS.md): a Life-OS-owned record set with one contract that the app, the `life` CLI, Codex, and future agents all use. The Leisure home (Perspective and Plan) sits on top of it later, the way the Health home sits on top of records in [Current Vision](../vision/VISION.md).

D-numbering continues from D66 in [HANDS.md](HANDS.md). Each decision is **confirmed** (Neel said it) or **proposed** (a working position until he confirms or corrects).

## Why leisure now

Neel is not happy with the Health slice app and will revisit it later (confirmed, September 12). Leisure comes first. It has the same advantage the hands had: a library of titles and a diary of dated entries is a deterministic shape that Letterboxd and Goodreads have already proven, so it can be built once and trusted. The less deterministic part, the reflective Leisure home, comes after.

The vault already holds the material: `Areas/Leisure.md` carries standards and dated reflections, and `Resources/Leisure Queue.md` carries a queue, a backlog, suggestion cues, and a field guide (medium, status, priority, mood fit, time fit). The library gives that material a home with stable identities, and the vault keeps what a library cannot hold well: the standards, the reflections, and the weekly review.

## What the reference apps have in common

Letterboxd, Goodreads, StoryGraph, and Backloggd share one shape, whatever the medium:

| Part | What it is | Neel's data or theirs |
|---|---|---|
| Catalog | The factual identity of a title: name, year, creators, cover, medium, length. | Theirs. Pulled from a public catalog, corrected by Neel when wrong. |
| Library | Neel's relationship to a title: shelf or status, ownership or platform, when it entered. | Neel's. |
| Diary | Dated entries: started, progress, finished, rewatched, dropped, each with an optional note. | Neel's. The part that retains why something interested him (VISION, Leisure). |
| Review and rating | One considered take per title, or per read/watch/play, with a rating and a like. | Neel's. |
| Lists | Named, ordered sets of titles: themed lists. | Neel's. Deferred; the queue and backlog are views here. |
| Social | Following, likes, comments, public profiles. | Cut. Single user (D1). |
| Stats | Year in review, counts by medium, streaks. | Derived, later. |

## The pieces

| Piece | What it is |
|---|---|
| The library | Titles across four media, movies, TV shows, games, and books, with Neel's status, rating, review, and diary entries per title. Owned by Life-OS. |
| The catalog lookup | A way to resolve "Starsight" or "Xenoblade Chronicles" to a factual record with a cover, without typing it in. Public sources per medium; the choice is a details-level decision. |
| The contract | The operations every client uses: add a title, log an entry, rate, review, list. |
| The library code and CLI | The contract as importable code over the same hosted database as the hands, and a `life` CLI group beside `task`, `event`, `account`. |
| The skill | Guidance that tells Codex when a message is a leisure log ("finished Skyward, loved it") and how to record it. This is the only intake (D76): the library grows from conversation, not from account imports. |
| The Leisure home, later | Perspective and Plan over the library plus the vault's reflections. Not part of this piece. |

## The model, at this altitude

A title has five facets (D90). Each is a separate part of the record, with its own source and its own way of changing:

| Facet | What it holds | Where it comes from |
|---|---|---|
| Info | The factual identity: name, year, creators, cover, length, synopsis, genres, people, series and position, links. | The catalog (D71), correctable by Neel. |
| Access | Where Neel can get it: stream, rent, buy, play, borrow, or listen, with links, across every service in his region (D89, D97). | The catalog where it knows, constructed links where it does not. |
| Progress | The experience: curious, backlog, active, paused, done, dropped, and the dated diary of starts, progress, finishes, drops, and returns. | Neel, as he speaks (D76), through the skill and CLI. |
| Ownership and cost | Whether he has it (`none`, `owned`, `service`, `borrowed`), where, since when, what it cost, and ongoing spend such as in-app purchases (D88). | Neel, as diary events that carry money. |
| Reflections and feelings | Rating in half-stars (D75), a like, one review, and dated notes with their full text: why it interested him and how it felt. | Neel. The library is the home for these, not the vault (D98). |

- A **title** is one work in one medium: a movie, a TV show, a game, or a book. A show is one title; seasons and episodes are progress on it, not separate titles.
- A **book** carries a format that Neel cares about: `audiobook`, `physical`, or `kindle` (D77). A backlog book can name the format he wants it in; a diary entry records the format it was actually read in. An audiobook is a book with a format, not a separate medium.
- Progress and ownership are independent. Buying does not start; finishing does not un-own. "Curious" is noticed, not wanted (D99). "Want to buy" is progress backlog with ownership none; "have it, haven't started" is progress backlog with any other ownership.
- A **diary entry** is dated and typed, and is the only way progress or ownership changes. Dates are when the experience happened, distinct from when it was recorded, matching [DATA-AND-VIEWS.md](../architecture/DATA-AND-VIEWS.md).
- A **series** is an info fact, not a record: a title knows its series and position, and the library can answer "what is next" in any medium (D87).
- The current queue is the `now` view and the backlog is a status (D83). Named lists for themed sets are deferred (D96).
- Every id is Life-OS's own, prefixed by kind, never provider-derived, as with the hands.

## Working decisions

- D67 (confirmed, September 12): Leisure before revisiting the Health slice app.
- D68 (confirmed): The reference shape is Letterboxd and Goodreads: a personal library plus diary for movies, games, and books. This supersedes the August D27 "no music/TV tracking" for movies; Music stays out.
- D69 (confirmed): The library is available through the `life` CLI, like the hands, so Codex and agents can log and read it from a shell.
- D70 (confirmed, September 12): Life-OS owns the library records, following D38 for the hands. When the library becomes canonical, the vault's `Resources/Leisure Queue.md` and the title mentions in `Areas/Leisure.md` reflections are backfilled into it once, by hand or by Codex, and the queue note is retired. `Areas/Leisure.md` keeps standards and reflections and links into the library rather than duplicating its rows. This is the one exception to D76: a single backfill, not an ongoing import.
- D71 (confirmed, September 12): The library integrates with open catalogs so a title Neel merely mentions carries rich factual information: synopsis, genres, people, length, release, platforms or formats, and links. Catalog facts are correctable; Neel's status, entries, ratings, and reviews remain the records that matter. Sources are chosen at the details level (D81).
- D72 (proposed): No social features, no public profile, no sharing. Same trim as D50.
- D73 (proposed): One shared field set across the four media, plus a small medium-specific block (platform for games, format for books, where watched for movies and shows) rather than separate schemas.
- D74 (confirmed, September 12): TV shows are in as a fourth medium, a good-to-have watched less often than the rest. Condition from Neel: include it if it comes free, meaning the same catalog source and record shape as movies cover it without separate work. If TV needs its own source or shape, it waits.
- D75 (confirmed, September 12): Rating is half-stars, 0.5 to 5, the Letterboxd scale, across all media. A like is separate from the rating.
- D76 (confirmed, September 12): No imports from Goodreads, Letterboxd, Steam, or PlayStation. The library fills as Neel speaks: Codex records what he mentions in conversation through the CLI, the same way the vault's Leisure reflections are gathered today. The existing vault queue and reflections are the seed.
- D77 (confirmed, September 12): Books have three formats Neel cares about, `audiobook`, `physical`, and `kindle`. Format is a field on the book, not a separate medium or lane. Some titles are wanted in a specific format, so a backlog book can carry a wanted format, and each read records its actual format.
- D87 (confirmed, September 12): When Neel reads a book, plays a game, or watches a movie or show that is part of a series, the library knows and offers the next in the series. Series comes from the catalog and is correctable; the next entry is a suggestion, not a backlog row, until he takes it.
- D88 (confirmed, September 12): Ownership is its own axis beside progress: `none`, `owned`, `service`, `borrowed`, with where, since, and price. Acquiring is a diary event (`buy`, `borrow`, `return`, `service`), so price history stays in the diary and the change log. The buy backlog is progress backlog with ownership none; the play-next backlog is progress backlog with any other ownership.
- D89 (confirmed, September 12): For each title Neel needs to know where he can get it: for games where to buy or play, for movies and shows where to watch, for books and audiobooks Audible, Libby, and Kindle links. Sourced from the catalog when it knows, otherwise constructed links. Availability is never scoped to what he pays for: every service is shown, and the library tells him which service would unlock the most of his backlog, so he can buy a subscription once enough is waiting there (D97).
- D97 (confirmed, September 12): Availability shows every service, not only the ones Neel has. A `worth-getting` view counts backlog titles per service so he knows what to get. Every service is treated alike to start; a "which ones I pay for" marker is a later follow-up, not important now.
- D98 (confirmed, September 12): Dated reflections about a title live in the library as note entries with their full text, not in the vault. Neel intends to deprecate the vault eventually, so the library is built as the home for leisure reflections from the start; `Areas/Leisure.md` keeps cross-title standards until it too is superseded.
- D99 (confirmed, September 12): A title Neel merely mentions with interest ("Aniimo looks interesting") is `curious`, a state before `backlog`. `backlog` means he wants it. Codex adds mentions as `curious`, never as `backlog`, unless Neel says he wants it.
- D90 (confirmed, September 12): A title is five facets: info, access, progress, ownership and cost, and reflections and feelings. The record, the views, and the title page are organized by these five, not by medium.
- D78 (confirmed, September 12): Build order is library and CLI first, the app later. Codex logging through the skill is the first working surface; the Leisure pages in `apps/web` follow once the records are real.

## Open points for Neel

None at the first altitude. The details level below has its own.

## The details level

Drafted September 12, 2026, after the first altitude closed; revised the same day after an adversarial review. The approved first-cut subset is fixed by the implementation brief and recorded in [current scope](../STATUS.md#scope-register); second-cut details remain proposals. It mirrors the todo-list section of [HANDS.md](HANDS.md) and reuses its contract rules, CLI conventions, and stack unchanged.

### Records

| Record | Fields |
|---|---|
| Title | `id`, `medium` (`movie`, `show`, `game`, `book`), `name`, `year`, `creators`, `cover`, `length` (minutes for a movie, seasons and episodes for a show, pages or hours for a book, hours for a game), `facts` (the raw catalog pull, nullable), `catalog` (`source`, `externalId`, `pulledAt`, `edited[]`; nullable), `status` (progress, derived), `ownership` (derived), `ownershipDetail` (`where`, `since`, `price`; nullable), `priority` (`now`, `soon`, `later`; optional), `moodFit[]`, `timeFit`, `notes` (standing markdown), `detail` (medium block), `rating` (derived, latest cycle), `liked`, `review` (derived, latest cycle), `entries[]`, `origin` (actor, at, reason, evidence, as on tasks), bookkeeping, `deletedAt` |
| Entry | `id` (`n_` prefix, unique within the title), `type`, `on` (`{ date, precision }`, nullable), `at`, `actor`, `progress` (free text, D84), `format` (books: the format of this cycle), `rating` and `review` text (on `finish` and `drop` entries, D80; `liked` stays on the title), `minutes` (progress entries), `spend` (`amount`, `currency`, `kind` `purchase`, `iap`, `rental`; ownership entries), `where` (ownership entries), `text` |

Top-level factual fields (`name`, `year`, `creators`, `cover`, `length`) are what views render; `facts` is the raw pull they came from. `facts` holds `synopsis`, `genres`, `people` (role and name), `released`, `runtime` or `pages` or `episodes` or `playtime`, `series` (name, position, and the ordered sibling entries with their source ids), `platforms` or `formats`, `language`, `links`, `availability` (D89: `{ kind, name, url, region, price? }` with kind `stream`, `rent`, `buy`, `play`, `borrow`, `listen`), and `sourceRating` labelled as theirs. Absent fields stay absent. Nothing of Neel's lives in `facts`.

`catalog.edited` lists the factual fields Neel has changed through `update`; `catalog.refresh` skips them (D93). A title with no `catalog` (created offline or with `--no-lookup`) is linked later with `catalog.link`.

The `detail` block (D73): a book carries wanted `format` and `series` text; a game carries `platform`; a movie or show carries `where` watched. `rating` and `review` on the title are derived from the latest cycle-closing entry (`finish` or `drop`) that carries them (D80); every cycle keeps its own. `liked` is on the title. The latest `drop` entry's text is the drop reason; there is no separate field.

Entry types. Progress: `want`, `start`, `progress`, `finish`, `pause`, `resume`, `drop`, `again`, `note`. Ownership: `buy`, `borrow`, `return`, `service`. The first altitude's words (started, finished, rewatched) are these.

### Dates and precision (D92)

`on` is when it happened, `at` is when it was recorded. `on` carries a precision: `day`, `week`, `month`, `year`, or `unknown`. A weekly review that says "finished Skyward" records the review date with precision `week`. A "played before, years ago" row records precision `unknown` and no date. The CLI takes the precision inside the date value: `2026-09-07` for a day, `2026-09-07~w` for the ISO week containing it, `2026-08` for a month, `2025` for a year, `?` for unknown. Backfill rows follow the same rule, so nothing is guessed and nothing is rejected for lacking a day.

`year` and `diary` place an entry by the year or date of its `on` at any precision; `unknown` entries appear in a title's own history and nowhere else.

### Lifecycle

Status is derived from the diary, never set directly (D79). The rule (D91):

- Order entries by `on` (unknown first, then by date, then coarser precision before finer on the same day), then `at`, then type rank `want` < `start` < `again` < `resume` < `pause` < `drop` < `finish`.
- Progress status is the target state of the last transition-bearing entry: `want` gives `backlog`, `start` and `again` and `resume` give `active`, `pause` gives `paused`, `drop` gives `dropped`, `finish` gives `done`. No transition entry means `curious` (D99). `progress` and `note` carry no transition and are valid in any state.
- Ownership is the target state of the last ownership entry: `buy` gives `owned`, `borrow` gives `borrowed`, `return` gives `none`, `service` gives `service`. None means `none`.
- Derivation is tolerant: `want` only from `curious`; `start` from `curious`, `backlog`, `paused`, or `dropped`; `finish` from any state but `done`; `pause` from `active`; `drop` from `backlog`, `active`, or `paused` (dismissing a mere mention is `delete`), so "finished X" never needs an invented start. A `finish` on a `done` title is `rejected` with the hint to use `again`; `again` is accepted only from `done`. `unlog` or `amend` re-derives from what remains, and any resulting sequence is legal.

```text
curious --want--> backlog --start--> active --finish--> done
   |                 |                 |  ^               |
   |                 |               pause |             again
   |                 |                 v   resume         |
   |                 |               paused               v
   +------start------+------drop-------+----drop------> dropped --start--> active
```

- `add` lands a title in `curious`; `--want` writes a `want` entry in the same call and lands it in `backlog`. `--started` and `--finished` write the entry in the same call, each with its own date via `--started-on` and `--finished-on` when both are known.
- `again` opens a new cycle on a `done` title; `again --finished` records a one-sitting rewatch. Each cycle's `format` is the one on its `start` or `again` entry; `finish` may restate it.
- `finish` and `drop` may carry `rating` and review text, which stay on that entry; the title's current take is the latest closing entry that has one (D80). `--liked` on either sets the title's `liked`. When the title belongs to a series, the receipt names the next entry and whether it is already in the library (D87); `--queue-next` adds it to `backlog` in the same call.
- `drop` requires text. A dropped or paused title keeps its entries and last progress; starting it again is an ordinary `start` (D85).
- Ownership and progress never change each other (D88). `buy` carries `where` and `spend`; `service` carries `where` naming a service Neel has.
- `delete` is soft and `restore` puts it back (D53). Titles created twice for the same work are joined by `merge`, which moves the entries and keeps the survivor's facets.

### Operations

| Title | Entry and catalog |
|---|---|
| `add` (catalog lookup unless `--no-lookup`; duplicate check by normalized name within the medium and by `catalog.externalId`, over every non-deleted title), `get`, `list` | `amend` (any entry field including `type` and `on`), `unlog` (remove an entry) |
| `update` (name, year, creators, cover, length, priority, moodFit, timeFit, notes, detail; factual fields mark `catalog.edited`) | `catalog.search` (medium and text; returns candidates with source id, name, year, creators, and category; no write) |
| `want`, `start`, `finish`, `pause`, `resume`, `drop`, `again`, `progress`, `note`, `buy`, `borrow`, `return`, `service` (each appends one entry) | `catalog.link <sourceId>`, `catalog.unlink`, `catalog.refresh` (re-pull, honoring `edited`), `catalog.availability` (re-pull availability for one title or the backlog) |
| `rate`, `unrate`, `review` (on the latest cycle-closing entry, or `--entry` to name one), `like`, `unlike` | `series.set` (name and position by hand when the catalog has none; wins over refresh) |
| `where` (availability for one title, every service alike), `next` (next in series; `--queue` adds it to backlog with the series as evidence) | |
| `merge`, `delete`, `restore`, `history` | `import` (one-time backfill from a JSON file, D95; second cut) |

Every mutation carries an actor, may carry a reason, evidence, and an idempotency key, and returns the todo list's receipt shape. The change log is shared. `Tools.export()` and `life export` include titles; there is no per-medium export.

Catalog ambiguity is not a duplicate (D94). A library duplicate is the existing exit 2 `candidates` rejection with `--allow-duplicate`. Catalog ambiguity is a `needs` rejection with `field: "catalog"` and the candidate list, which the interactive CLI turns into a question and a script answers with `--catalog <sourceId>`. Confidence for auto-linking is concrete: one hit whose normalized name equals the input and whose year matches when given, and whose category is a main work rather than a DLC, edition, or remake. Catalog failures (timeout, auth, rate limit) never block: the title is created and the receipt carries a warning. Lookup runs before the transaction with the calendar adapter's timeout.

### Views

| View | What it returns |
|---|---|
| `now` | Active and paused titles across media, the vault's "Current queue". |
| `curious` | Titles noticed but not wanted (D99), with their info and access, so deciding is easy. |
| `backlog` | Backlog titles Neel can start now (ownership not `none`), filterable by medium, priority, mood, fit, wanted format, and service, so the suggestion cues become a query. `--wanted-again` includes done titles marked for a replay. |
| `buy` | Backlog titles with ownership `none`, with where to get each and a price when a source has one. |
| `worth-getting` | Services ranked by how many backlog titles each would unlock, with the titles listed, and a marker on services Neel already has. The answer to "what should I subscribe to" (D97). |
| `shelf` | Owned titles by medium, done or not; owned and never started is its own count. |
| `diary` | Entries by date, newest first, across titles, with a date range. |
| `series` | One series in order with Neel's status on each entry. |
| `time` | Minutes and spend by title and by medium per week, from entries that carry them. |
| `year` | Finishes by medium for a calendar year, including `again` finishes, with ratings; dropped titles listed separately. |
| `search` | Text over name, creators, notes, review, and entry text. |
| `trash` | Deleted titles, with restore. |

`get` is the title page in its five facets (D90); there is no separate `title` or `library` view.

### Catalog lookup (D71, D81)

| Medium | Source | What it gives | Realities the adapter handles |
|---|---|---|---|
| movie, show | TMDB | Synopsis, genres, cast and crew, runtime or episode runtimes, seasons and episodes, release dates, collections (film series), watch providers by region, posters. | Separate `search/movie` and `search/tv` endpoints and detail shapes, so TV is a small mapping over the same key, within D74. Image URLs need the configuration base path. Providers need a region. `LIFE_TMDB_KEY` is a v4 read token sent as a bearer. |
| book | Open Library (Google Books description fallback, second cut) | Authors, description, subjects, page count, first publish date, editions with ISBNs, covers. | Search returns works with frequent duplicates, so auto-link is rare and candidates are the norm. Series is unreliable; `series.set` or Wikidata fills it (open point). A descriptive `User-Agent` is required. Audiobook hours never come from it. |
| game | IGDB | Summary, genres, themes, developer and publisher, platforms, release dates, collections (series), external store ids and websites, cover art, aggregate rating; time to beat from its own endpoint. | Twitch client-credentials token, cached in `.local/igdb/token.json` under the Google credentials rules, refreshed on expiry; 4 requests per second; POST query bodies; cover URLs rewritten to `https` and `t_cover_big`; `category` shown in candidates so a Definitive Edition or DLC does not resolve to the base game. |

Availability (D89), honest about what is real: TMDB providers for movies and shows are real, with JustWatch-backed links and no leaving dates. IGDB external ids give Steam, GOG, Epic, PlayStation Store, Nintendo eShop, and Xbox links; price comes only from the Steam page for PC titles; Game Pass and PS Plus are marked by the `services` list, not a source. Books get Open Library editions by ISBN, and Audible, Libby, and Kindle as constructed search links from title, author, and ISBN, since none has an open API; Libby availability at Neel's library is out of scope. Availability is shown in full for Neel's region, never filtered to his subscriptions, and every service is treated alike (D97). There is no services record to start; `service` ownership on a title is stated by Neel, not inferred. Game Pass and PS Plus membership therefore appear only when Neel says a title is on a service he has.

Keys live in the root `.env`: `LIFE_TMDB_KEY`, `LIFE_IGDB_CLIENT_ID`, `LIFE_IGDB_CLIENT_SECRET`, `LIFE_GOOGLE_BOOKS_KEY` optional, `LIFE_REGION` (`US`, confirmed September 12). `life doctor` checks each and the IGDB token.

### The CLI

One group per medium (D82): `life movie`, `life show`, `life game`, `life book`, sharing one command table with the flags that do not apply to a medium left out; cross-media views and `list` under `life media`. Built for an agent first: every `<ref>` is an id or a name, so "finished Skyward" is one command; lists return compact summaries; date precision rides inside the date value; a rewatch, a correction, or a "where can I watch" is one call. The full command list, flag rules, and envelope details are in `packages/tools/README.md` ("The library"), which wins over this sketch.

```sh
life book finish "Skyward" --on 2026-08-31~w --rating 4.5 --liked
life book add "Starsight" --format audiobook --started
life movie add "Korean Kanakaraju" --finished --on 2026-09-11 \
  --review "A novel idea, but a very bad movie that delivered neither horror nor comedy."
life game add "Aniimo"                                             # curious
life game add "Fire Emblem: Fortune's Weave" --want --priority soon
life game buy "Fortune's Weave" --where "Nintendo eShop" --price 59.99
life game start "Fortune's Weave" --progress "2 hours in" --minutes 120
life show progress Severance "S2E4" --minutes 45
life game drop Xenoblade "not fun anymore, the difficulty spikes are the problem"
life movie again Arrival --finished --rating 5
life book relog Starsight n_xxxxxxxxxx --to Skyward                 # the finish went on the wrong title
life movie lookup "Dune Part Two" --where                           # where to watch, no title created
life book next "Beware of Chicken 2" --queue
life game backlog --fit short --mood low-energy
life media now
life media time --since 2026-09
life media year 2026
```

### The skill

`skills/leisure/SKILL.md`, the only intake (D76). Its rules are spelled out in the brief; the ones that matter most: name the title, never look up an id first; `want`, `start`, `finish`, `drop`, and the ownership entries only on Neel's word, `progress`, `note`, and `like` freely; a mention is `curious`, a want is `--want`, Codex's own suggestions are never added; dates are when it happened with `?` for "a while ago"; a rating only when he gives a number; a dated reflection is a `note` with its full text and does not go to the vault (D98); a catalog question is answered without asking when exactly one candidate fits his words.

### Backfill (D70, D95)

One-time. Codex reads `Resources/Leisure Queue.md` and the title mentions in `Areas/Leisure.md`, writes a JSON file of `add` inputs with their entries and precisions, and runs `life media import file.json --dry-run` under actor `import:vault`, then for real. The per-item report follows the todo `ImportResult`. The vault's "Next action" text lands in each title's `notes`. After the import, the queue note becomes a link to the library; the September 11 game comparison and the Sword x Staff character note stay in the vault (open point 3).

### Stack additions

One table, `titles`, as JSON rows plus indexed `medium`, `status`, `ownership`, `name`, `deletedAt`, in `packages/tools/src/media/` beside `calendar/`; the shared `log` and `receipts`; one catalog adapter per medium behind a small interface with stubbed sources in tests; the id helpers widened to two-letter prefixes (`ml_` reserved) and the `Kind`, `RecordOf`, `TABLES`, `GroupName`, `RefKind`, and `GROUP_INFO` tables extended. `node:test` over derivation for every sequence in the lifecycle section, precision ordering, duplicate and catalog-candidate handling, `edited` honoring on refresh, ownership independence, import dry-run, and CLI smoke.

### Later and cut

- The Leisure home in `apps/web` (D78).
- A "services I pay for" marker on availability and `worth-getting` (D97 follow-up), named lists (`ml_`), per-entry ratings, stats beyond `year` and `time`, "caught up" for airing shows, Wikidata for book series.
- Cut on Neel's word (September 12): a percent on progress for time remaining. Progress stays free text only.
- Cut: social, sharing, service recommendations, music, ongoing imports (D72, D76).

### Working decisions at this level

- D79 (proposed): Status is derived from the diary; every transition is an entry type, so logging is the only way a title moves.
- D80 (confirmed, September 12): Rating and review are per cycle, Letterboxd-style: each `finish` (or `drop`) entry may carry its own rating and review. The title shows the latest cycle's as its current take; `liked` stays on the title.
- D81 (proposed): TMDB for movies and shows, Open Library for books (Google Books as a description fallback in the second cut), IGDB for games; each pulls the full detail record into `facts`; lookup never blocks creation and a whole lookup has one time budget.
- D82 (confirmed, September 12): One CLI group per medium sharing one command table; cross-media views under `media`. Ids `m_` for titles, `n_` for entries, `ml_` reserved for lists.
- D83 (proposed): The current queue is the `now` view and the backlog is a status.
- D84 (confirmed, September 12): Progress is a free string, never structured.
- D85 (confirmed, September 12): A dropped or paused title keeps its entries and last progress; starting again is an ordinary `start`.
- D86 (proposed): Suggestion cues stay in `Areas/Leisure.md` as standards; the `backlog` filters make them answerable.
- D91 (proposed): The derivation rule as written in Lifecycle: tolerant, ordered by `on` then `at` then type rank.
- D92 (proposed): `on` carries a precision of day, week, month, year, or unknown; nothing is guessed and nothing is rejected for lacking a day.
- D93 (proposed): `catalog.link`, `unlink`, and an `edited` list on the title; refresh never overwrites an edited field or a hand-set series.
- D94 (proposed): Catalog ambiguity is a `needs` question answered with `--catalog`, distinct from the library duplicate's exit 2.
- D95 (proposed): Backfill is `life media import` over a JSON file Codex writes from the two vault notes, actor `import:vault`, dry-run first.
- D96 (proposed): Named lists are deferred; nothing in the vault needs one yet.
- D100 (decided by the brief, September 12; Neel: "not stuck on structure, that's your job"): optional `minutes` on progress entries and optional `spend` on ownership entries, with the `time` view, ship in the first cut. Subscriptions that span titles wait for Finance.
- D101 (confirmed, September 12): First cut ships `year` and `time` views, `merge`, and entry corrections. `worth-getting` and the vault `import` are the second cut. Neel creates the TMDB read token and the Twitch developer app for IGDB, as he did the Google OAuth client.

### Open points for Neel at this level

Neel's direction, September 12: do not worry about the exact vault data now, worry about building right. So D88 and D91 to D96 stand as working positions for the build brief, book series is `series.set` by hand until it hurts, and every backfill judgment call (which vault rows become titles, where the September 11 comparison and the character note go when the queue note retires) is decided at backfill time, after the library exists, not here.
