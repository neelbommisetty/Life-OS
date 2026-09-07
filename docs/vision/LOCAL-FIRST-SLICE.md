# Local first slice

Approved September 5, 2026. This is the current implementation milestone. The larger architecture in VISION.md is a future direction.

One local Next.js app reads one structured JSON file. Home summarizes Health; Health has Perspective and Plan. Perspective renders an explicit focus plan with a direction, an assessment, selected dated measurements and reflections. Plan shows task and calendar snapshots independently of that focus. Exploring another focus does not change the published priority or commitments.

## Run it

From the repository root:

```sh
bun install
mkdir -p .local
# Only on a fresh checkout with no personal snapshot:
cp -n apps/web/data/health.example.json .local/health.json
bun run check:data
bun run dev
```

Open http://127.0.0.1:4318/health. The included example is entirely synthetic. The personal snapshot prepared during development is in ignored `.local/health.json`; it is not part of source control. An absolute `LIFE_OS_DATA_FILE` environment variable can select another file. Run scripts from the repository root so the default path resolves correctly.

## Update the content

Codex can prepare a replacement JSON file using the schema in `apps/web/src/lib/contract.ts`. Validate the candidate with `bun run --cwd apps/web check:data /absolute/path/to/candidate.json`, then atomically rename it over the runtime file. Preserve stable record IDs and increment a record's version when correcting its content. Change the document revision and publication time for each update; source check times describe actual source reads, not file edits.

Sources declare availability, check time and coverage. Measurements include dates and units. Reflections distinguish a direct report from a summary. Intentions remain distinct from tasks and scheduled events. Missing observations are absent records, never invented zeroes.

A focus plan selects a direction and supported presentation blocks, and records why it is featured and which evidence versions support its interpretation. Changing `activeFocusId` changes the published emphasis. Adding an available measurement or selecting a different supported block requires a data update, not a page rewrite. New kinds of presentation still require code.

The page rereads the file every 15 seconds while visible, on returning to the tab, or on pressing Refresh data. It does not fetch Todoist, Calendar or the vault. If evidence versions change, the app flags the earlier interpretation for review. Codex must reconsider the wording and acknowledge the new evidence versions; validation cannot establish that a narrative is true. New evidence does not automatically choose a focus. Review dates make that limitation visible.

Malformed or missing files show an explicit error. They are not treated as empty data. Sources remain snapshots with their coverage visible. Events are filtered against the current time; tasks retain their source status.

## Verify

```sh
bun run typecheck
bun run test
bun run check:data
bun run build
```

Tests cover invalid references and units, correction freshness, focus-independent commitments, missing readings versus zeroes, and file replacement. Browser verification should cover Perspective/Plan navigation, focus reset, file-only correction and invalid-file recovery, and mobile layouts.

## Boundary of this milestone

This is a running local app, with one file as its data boundary. It includes no database, publication service, publishing CLI, automatic source sync, authentication, hosted deployment or external writes. The server binds to loopback. These settings are not a substitute for authentication when hosting later.

The same contract can later sit behind a publishing service or database. That transition will need its own implementation and verification. A future agent can prepare equivalent data without coupling the views to Codex, but no agent runtime is built here.
