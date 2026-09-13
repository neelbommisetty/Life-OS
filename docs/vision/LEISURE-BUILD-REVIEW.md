# Library first-cut build review

September 12, 2026. Stages 5–7 finish the first cut authorized in `AGENTS.md`
and described in the library section of `packages/tools/README.md`. No second-cut
views, vault import, UI, deployment, or live library mutations were added.

## Independent review

Fresh reviewers covered five areas: derivation, title operations, catalog
adapters, views, and CLI. They used source inspection, offline fixtures, and
throwaway Postgres schemas. The implementation received one fix pass.

| Finding | Resolution |
|---|---|
| URL-only availability deduplication collapsed TMDB providers and access modes sharing a JustWatch link. | Deduplicate identical availability rows; retain distinct providers, modes, regions, and prices. |
| TMDB movie and show IDs collided because catalog identity omitted medium. | Include medium in duplicate checks and `inLibrary` annotations. |
| Retrying an add with the same key could fail its name check before replaying the saved receipt; catalog preflight could also prevent retries during outages. | Check saved receipts before preflight, while retaining the authoritative replay under the write lock. |
| Saved receipts lost title metadata such as `removed`, `next`, and warnings. | Decorate successful receipts inside the transaction and preserve extras when core stores the validated record. |
| An Open Library median of 300 and 301 pages produced an invalid fractional page count. | Round page medians, including source-supplied medians, to whole pages. |
| IGDB website rows carrying only the deprecated `category` field lost their store links. | Request both fields and use `type`, falling back to `category`. |
| Backlog sorted status before priority, placing lower-priority backlog titles before higher-priority replays. | Sort the combined backlog/replay view by priority, then name. |

The CLI's failing scenarios also contained fixture errors: human terminal output
was parsed as JSON; a frozen clock tied pause and resume; subsequent expectations
ignored a backdated finish, a surviving merge target, earlier fixture records,
corrected ratings, and replay counts. These expectations now follow the recorded
diary. Candidate hint tests no longer assume insertion order when timestamps tie.
An IGDB concurrency test retains its single-token and 250 ms rate-floor checks
without imposing FIFO ordering on asynchronous token-file reads.

## Reviewed implementation choices

- The title receipt union correctly distinguishes title candidates from catalog
  candidates; it preserves successful receipt metadata.
- Nullable catalog IDs in manual series views and next-title receipts allow
  uncataloged books. Catalog facts still require their source IDs.
- The additional ambiguity messages identify the non-main-work and Open Library
  edition-count confidence rules; they do not silently select uncertain matches.
- Borrow and service require `--where`, as the CLI brief specifies.
- `constructed: true` identifies inferred book search links. TMDB supplies its
  provider landing pages; IGDB supplies verified store IDs or website URLs.
  Those catalog-backed links retain `constructed: false`, including URLs spelled
  from IGDB store IDs. This distinguishes inferred availability from catalog
  evidence; it does not claim current stock, pricing, or a subscription.
- Trailing `{ full }` view options are an additive API extension. Summaries remain
  the default, and full records remain available from `get` and `--full`.

## Validation

The leisure skill's 15 worked commands were checked against actual CLI help;
the skill-creator validator passed. Automated tests use fakes and disposable
schemas and make no catalog requests. Final gates passed:

- `bun run typecheck`
- `bun run test`: 625 tools tests and 5 web tests, zero failures or skips
- `bun run check:data`: 40 records and 2 focus plans validated
- `bun run build`
- `git diff --check`

Manual smoke attempts could not validate the live sources: the current root
environment lacks `LIFE_TMDB_KEY`, `LIFE_IGDB_CLIENT_ID`, and
`LIFE_IGDB_CLIENT_SECRET`; Open Library failed to connect. The smoke script now
returns a failing exit code for source failures and rejects unsupported arguments.
Successful live integration remains unverified. No credential values were printed
or committed, and no library records were created by these attempts.
