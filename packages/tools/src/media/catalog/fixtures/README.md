# Catalog fixtures

Recorded or hand-authored JSON responses from the catalog sources (TMDB, Open Library, IGDB), one file per response, in a folder per source and named `<source>-<what>.json` (for example `tmdb/tmdb-movie-detail.json`, `openlibrary/openlibrary-search.json`, `igdb/igdb-game.json`).

They exist so each adapter's mapping functions can be tested against the real shapes without the network: a test reads a fixture and hands it to the mapping, or queues it as a fake `fetch` answer. Tests never fetch. Nothing under `src/` talks to a source except the adapters themselves, and only outside tests; `scripts/catalog-smoke.ts`, run by hand with the keys in `.env`, is the only place the real sources are exercised.

When a fixture is recorded from a live source, strip anything personal or secret (keys, tokens, session ids) before committing it; when it is hand-authored, keep it to the fields the mapping reads plus enough of the real shape to catch a wrong assumption.
