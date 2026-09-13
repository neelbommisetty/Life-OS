---
name: leisure
description: Use the `life` CLI to record Neel's movie, show, game, and book experiences, interests, ownership, and reflections, or read his library and catalog availability. Reach for this when he mentions a title with interest, logs what he watched, played, or read, or asks what to enjoy next.
---

# Leisure library (`life` CLI)

Life-OS owns the library and its dated diary in Postgres. The `life` CLI is
the only sanctioned way for agents to read or write it. Never write to the
database directly. Title reflections belong here; cross-title standards
remain in the vault. This skill does not perform the deferred vault backfill
or imports from other services, and leisure interest does not create a task.

## When to use it

- Neel mentions a title with interest, says he wants it, or reports starting,
  progressing, finishing, pausing, returning to, or dropping it.
- He describes acquiring a title, a rating, a feeling, or a dated reflection.
- He asks what he is enjoying now, what is waiting, what he owns, what he
  finished, how much time or money he recorded, or where a title is available.

The CLI documents itself. Start with `life --help`, then
`life help book` (or `movie`, `show`, `game`, `media`) and
`life help book <command>` for flags and allowed states. The implementation
brief in [packages/tools/README.md](../../packages/tools/README.md#the-library)
defines this first cut; `worth-getting`, named lists, and imports are deferred.

## How to run it

From the repository root, use `bun run life ...` or
`node packages/tools/bin/life.js ...`. The examples below abbreviate this as
`life`. Always pass `--json --actor codex`; a named sub-agent uses
`--actor agent:<name>`. Never use `--actor neel`.

Attach evidence to every write, quoting the actual message and its date:
`--evidence 'chat:2026-09-12 "his words"'`. Add `--reason` for corrections,
`unlog`, `relog`, and `delete`. The example dates and entry ids are illustrative;
use the actual conversation date and ids returned by `get` or `history`.

Use the title's name as its ref. Do not list just to find an id. Exact names,
aliases, and unique name fragments resolve within the chosen medium.
Use `list --text` only to resolve ambiguity, or use the candidates returned
by a `needs` on `ref`. A ref that names another medium returns a hint; follow
it. Deleted titles are restored by id, obtained from `life trash`.

## Reading the output

With `--json`, stdout contains one JSON envelope and diagnostics go to stderr;
even a terminal does not ask interactive questions.

```text
{ ok, command, exitCode, result?, error?: { code, message, issues, hint?, needs?, candidates?, candidateKind? }, warnings? }
```

`result` holds the library result unchanged: a receipt, record, list, or view.
A successful title receipt includes `outcome`, `id`, and `record`; some
operations also return `next` or `removed`. Read `warnings` even on success.
Report the outcome, id, and resulting status to Neel. A backdated entry can
leave the current status unchanged because a later entry determines it.

Exit `0` is success; `1` is rejected, invalid, not found, or needs an answer;
`2` is a library duplicate; `3` means the database or a catalog is unavailable;
`64` is CLI usage. Read `error.hint` before retrying. For unavailable services,
run `life doctor --json --actor codex`, report the problem, and do not retry in
a loop. Doctor's default checks configuration; `--online` makes live probes.

Lists and title views return compact summaries unless `--full`; `get` returns
the full title, entries, and facts. `list` hides dropped titles unless named
by `--status`. `now` includes active and paused titles. `backlog` contains
wanted titles already owned, borrowed, or on a service; `buy-list` contains
wanted titles with ownership `none`. `--wanted-again` includes finished titles
with a replay priority. Recorded time is not an estimate of total playtime.

## Required behaviors

- **Record his relationship, not an inferred commitment.** Only his word
  authorizes `want`, `start`, `again`, `pause`, `resume`, `finish`, `drop`,
  `buy`, `borrow`, `return`, or `service`. Derive `progress`, `note`, and
  `like` freely from what he says. "Going into X", "started X", or "on S2E4
  of X" establishes a start; record the progress too, without another start
  if it is already active. A finish needs no invented start.
- **Interest is curious; a want is backlog.** A mention with interest is
  `add` without `--want`; an explicit want uses `--want` on a new title or
  `want` on an existing curious title. Never add your own suggestions until
  he reacts with interest. The add operation checks duplicates itself:
  exit `2` with `candidateKind: "title"` means reuse the existing title,
  not routinely retry with `--allow-duplicate`.
- **Dismiss according to status.** Check the receipt or `get`: dismiss a
  curious title with `delete`; reject a backlog, active, or paused title with
  `drop` and his full words. The drop text becomes its review. Do not shorten
  away the reason it failed him.
- **Acquiring and experiencing are independent.** Buying never starts a
  title. "On Audible" or "on Game Pass" means `service --where` only when he
  says he has access through it. Borrow and service require the lender or
  service in `--where`; ask if that information is missing. "Will buy on the
  eShop" belongs in `--notes` until he reports buying it. Catalog availability
  does not establish ownership or a subscription.
- **Choose the medium accurately.** An audiobook is a book with
  `--format audiobook`; a mobile game is a game with `--platform` naming the
  platform he gave. A show is one title, with seasons and episodes as progress.
  Ask if show versus movie is unclear. Do not use `--started` for movies.
- **Date the experience.** `--on` defaults to today; use that only for a
  current experience. Use `?` for "a while ago" or "years ago" without a
  nameable month, `2026-09` for a named month, `2026` for a named year, and
  `2026-09-07~w` for the ISO week containing the review date. Quote `?` in the
  shell. Ask only when he clearly means a recent specific day he did not name.
  On add, `--started-on` and `--finished-on` can carry different precisions.
- **Preserve his take.** Use a rating only when he gives a number, on the
  0.5–5 half-star scale. "Loved it" is `--liked`; "loving it so far" is
  `like` on an unfinished title. A mild positive such as "comfy listen" is
  review text in his words, not a numerical rating. Reviews belong to finish
  or drop entries; on an unfinished title record a note instead of inventing
  a finish. `rate` and `review` edit the latest closing entry unless
  `--entry` identifies another cycle.
- **Keep time honest.** `--minutes` is one sitting, never a cumulative total.
  "10 hours in" is progress text without minutes. Record spend only when he
  supplies it, using the correct purchase, in-app purchase (`iap`), or rental
  kind and currency. Do not turn a catalog price into actual spend.
- **Keep reflections and replays in their proper form.** A dated reflection
  becomes a `note` with the full text and does not also go to the vault.
  "Wants to replay X" updates its priority; it does not start another cycle.
  A completed rewatch is `again --finished`, or `add --seen-before --finished`
  for a new library title. Unknown earlier completion dates stay unknown.
- **Correct the existing diary.** Get entry ids from `get` or `history`.
  Move an entry on the wrong title with `relog`; fix a field with `amend`;
  remove an erroneous entry with `unlog`. Never re-add a title to fix an entry.
  These operations re-derive status; check the receipt. Use `merge` only for
  actual duplicate titles, preserving the intended survivor.
- **Handle catalog ambiguity separately.** A `needs` with
  `candidateKind: "catalog"` is not a library duplicate. Pick without asking
  when exactly one candidate fits his year, sequel number, author, or other
  stated detail. Retry with `--year` first when the message says `year differs`
  or `several exact matches` and his words supply a year; never invent one.
  Otherwise ask with the candidate names and years, then repeat the add with
  `--catalog` and the returned external id. A candidate with `inLibrary` set
  already exists: use that title. For ambiguous library refs, pass the matching
  title id once resolved.
- **Answer access questions without creating a title.** For a title outside
  the library, use `lookup --where`. An add receipt already includes its
  availability, so do not immediately call `where` again. Show constructed
  links as searches, not verified stock, price, or borrowing availability;
  retain regions and distinguish catalog facts from his own access.
- **Creation can succeed without a catalog.** Explain any warning. If a key
  is missing, name the variable the warning identifies and say `refresh`
  can link the title once configured. If the source timed out or failed, name
  that problem instead. Do not expose credentials. A finish receipt's `next`
  is a suggestion: mention it once and queue it only if he says so, including
  when considering `--queue-next` or `next --queue`.

## Worked examples

These illustrate separate messages, not a script to run as a batch.

```sh
# Interest in a new title, without a commitment:
life game add "Aniimo" --json --actor codex \
  --evidence 'chat:2026-09-12 "Aniimo looks interesting"'

# A new audiobook he explicitly wants:
life book add "Starsight" --want --format audiobook --json --actor codex \
  --evidence 'chat:2026-09-12 "I want to listen to Starsight"'

# A weekly-review finish, with his numerical rating:
life book finish "Skyward" --on 2026-09-12~w --rating 4.5 --liked \
  --json --actor codex \
  --evidence 'chat:2026-09-12 "Finished Skyward this week, 4.5, loved it"'

# A past completion whose date he cannot name:
life movie add "Arrival" --finished --on '?' --json --actor codex \
  --evidence 'chat:2026-09-12 "Saw Arrival years ago"'

# A completed rewatch of an existing done title:
life movie again "Arrival" --finished --rating 5 --json --actor codex \
  --evidence 'chat:2026-09-12 "Rewatched Arrival today, 5 stars"'

# He is already watching this show; 45 minutes describes this sitting:
life show progress "Severance" "S2E4" --minutes 45 --json --actor codex \
  --evidence 'chat:2026-09-12 "On S2E4 of Severance, watched 45 minutes today"'

# A full dated reflection, without inventing a rating or finishing:
life book note "Starsight" "Comfy listen tonight; the characters kept me company." \
  --json --actor codex \
  --evidence 'chat:2026-09-12 "Comfy listen tonight; the characters kept me company."'

# Ownership only after he says he has access:
life game service "Celeste" --where "Game Pass" --json --actor codex \
  --evidence 'chat:2026-09-12 "I have Celeste through my Game Pass subscription"'

# Correct a finish logged on the wrong book; copy the actual entry id from get:
life book get "Starsight" --json --actor codex
life book relog "Starsight" n_abc123def0 --to "Skyward" \
  --reason "finish recorded on the wrong book" --json --actor codex \
  --evidence 'chat:2026-09-12 "That finish was Skyward, not Starsight"'

# Answer without adding a title:
life movie lookup "Dune Part Two" --where --json --actor codex

# Current experiences, accessible backlog, and recorded time and finishes:
life media now --json --actor codex
life game backlog --fit short --mood low-energy --json --actor codex
life media time --since 2026-09 --json --actor codex
life media year 2026 --json --actor codex
```
