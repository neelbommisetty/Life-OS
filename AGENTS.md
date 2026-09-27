# Life-OS

Current scope is the tools package, life CLI, and shared tools API described below. The Health web app and its local file-backed milestone have been removed. The longer-term architecture is in docs/vision/VISION.md; it does not authorize implementing every planned service now.

Run from this repository with Bun. The API and CLI run on Node directly from TypeScript, without a separate build step. Use `bun run typecheck` and `bun run test` for relevant checks. Do not restore legacy code or read legacy environment values just because their files remain.

Personal runtime data belongs in the ignored `.local/` directory. Do not commit credentials, runtime snapshots, test screenshots containing personal content, or build output. No deployment or source-control push is authorized by a request to develop locally.

The attached Life vault is separate and shared, not isolated by a code branch or worktree. Before any vault work, read its current root and applicable folder-local AGENTS.md files. Do not read Archive by default. Todoist uses the `td` CLI exclusively. This milestone does not modify the vault, tasks, or calendar.

## Tools package and life CLI

`packages/tools` is the authorized todo-list milestone per `docs/vision/HANDS.md`. The `life` CLI (see `skills/todo/SKILL.md`) is the way agents act on the list: adding, changing, scheduling, completing, or reading tasks. `LIFE_DATABASE_URL` lives in the root `.env`. The calendar piece of `HANDS.md` is specced (D44, D55 to D66) and its implementation brief is the "The calendar" section of `packages/tools/README.md`; build only what that brief describes. The leisure library is specced in `docs/vision/LEISURE.md` (D67 to D101) and its implementation brief is the "The library" section of `packages/tools/README.md`; the first cut named there is authorized (September 12, 2026), the second cut is not. Catalog keys (`LIFE_TMDB_KEY`, `LIFE_IGDB_CLIENT_ID`, `LIFE_IGDB_CLIENT_SECRET`) live in the root `.env`; tests never touch the network.

## Shared tools API

The September 17 API milestone is authorized by the user; see `docs/vision/API.md` and `packages/tools/API.md`. All existing tools functionality is exposed through the Hono API. The `life` CLI consumes HTTP and must not regain direct database or provider access. `Tools` remains the server-side business layer. Use established libraries for routing, validation, OpenAPI, and transport. `bun run api` starts the local Node API on port 4319. Database and provider credentials belong to the API server; clients use `LIFE_API_URL` and `LIFE_API_TOKEN`. Tests use fake providers and disposable database schemas, with CLI tests going through loopback HTTP. This authorization does not include deployment or deferred product features.

## Life-OS web

The September 25 web milestone is the independent website in `apps/web`, with its todo slice at `/todo`. It uses the existing tools HTTP API only, through a server-side same-origin bridge; database and provider access stays in `packages/tools`. Use Life-OS branding and shared shell/theme tokens so future project, calendar, and other slices can join this cohesive web app. Todoist is the functional reference, not the visual brand. Other slices require separate authorization. See `apps/web/README.md` for run commands and verification. Keep the API token server-side, bind local web services to loopback, and run browser mutation checks only against disposable data.

Before creating or changing a web slice, read `docs/DESIGN.md`. Reuse its finalized ocean-blue Life-OS palette, fonts, shell, and shared components. Primary controls use pale blue fills with readable blue text; do not reintroduce green or dark primary fills through slice-specific overrides. Keep that guide and `docs/DESIGN.json` in sync with intentional shared-design changes.

## Calendar web slice

The September 25 calendar request authorizes `/calendar` in `apps/web`, inspired by Fantastical's calendar and agenda layout. It uses the current calendar API only, with explicit event fields and no natural-language parsing. Reuse the shared Life-OS shell, theme, same-origin bridge, and server-side credentials. Calendar viewing, event editing, recurrence scopes, and invitation responses follow existing API contracts. Verify mutations only against disposable schemas and fake providers; development does not authorize changing personal events or connecting accounts.
