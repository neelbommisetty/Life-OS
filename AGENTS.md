# Life-OS

Current scope includes the tools package, life CLI, shared tools API, web todo/calendar slices, and the approved authentication, connector, and agent-layer build described below. The Health web app and its local file-backed milestone have been removed. The ambition is in docs/vision/VISION.md. The target architecture in docs/architecture/ARCHITECTURE.md is entirely unimplemented as of September 27; the existing product baseline does not count as delivery of that design. Track subsequent delivery in docs/STATUS.md and update architecture status as implementation lands. Broader vision features remain outside this approval.

Run from this repository with Bun. The API and CLI run on Node directly from TypeScript, without a separate build step. Use `bun run typecheck` and `bun run test` for relevant checks. Do not restore legacy code or read legacy environment values just because their files remain.

Personal runtime data belongs in the ignored `.local/` directory. Do not commit credentials, runtime snapshots, test screenshots containing personal content, or build output. No deployment or source-control push is authorized by a request to develop locally.

The attached Life vault is separate and shared, not isolated by a code branch or worktree. Before any vault work, read its current root and applicable folder-local AGENTS.md files. Do not read Archive by default. Todoist uses the `td` CLI exclusively. This milestone does not modify the vault, tasks, or calendar.

## Documentation and delivery state

Start with [docs/README.md](docs/README.md) and [docs/STATUS.md](docs/STATUS.md) before planning or implementing work. The index separates vision, target architecture, feature specs, build plans, and reviews. The status page records current implementation, bounded approvals, and active work; it does not grant approval itself. Keep it current in the same change when scope or delivery changes. Record the source of approval, link active work to its branch/worktree and plan when substantial, and distinguish implemented code from deployment or verified live-provider health. Do not infer approval from a vision, a proposed design, or a historical worktree.

Documentation maintenance is part of completing every relevant change, without a separate user reminder. Before implementation, read the affected architecture, spec and plan. Before reporting completion, reconcile them with the actual result in the same change:

- Update architecture when responsibilities, boundaries, data flows, identity, permissions, connectors, credentials, runtime, or technology decisions change. Distinguish implemented behavior from remaining target behavior; update diagrams and superseded decisions too.
- Update the build plan when work starts, steps finish, scope changes, blockers appear or clear, or the next action changes. Record actual verification results and remaining gaps; completion requires the plan's acceptance checks.
- Update STATUS.md when approval, delivery or active work changes. An approved plan is not automatically in progress, and code completion is not deployment.
- Update feature specs, API contracts, package/app runbooks and skills when their documented behavior or usage changes. Update vision/product documents only when ambition or product direction changes; preserve dated reviews as historical evidence and link follow-up resolutions.
- Check affected links/anchors and generated design exports when relevant. If a change needs no documentation update, say so briefly in its completion report; do not add meaningless date-only edits.

## Authentication, connectors and agent layer

Neel confirmed on September 27, 2026 that plans to build authentication, connectors and the agent layer exist and are in scope. The [build plan](docs/plans/2026-09-27-auth-connectors-agents.md) records that approved work against the [architecture](docs/architecture/ARCHITECTURE.md) and [authentication contract](docs/architecture/AUTHENTICATION.md). This is approved implementation scope, not merely an unapproved design proposal. Implementation has not started in this baseline.

Build owner authentication, separate root/independent-agent identities and API permissions, connector contracts and lifecycle, credential handling, bounded requests/runs and dispatch, owner-configured schedules/triggers, and result publication through the existing API/CLI/web foundation. Include the owner controls needed by this scope. Keep the root's initial broad read policy, independent agents' narrower grants, and the existing Codex runtime. Strong runtime isolation, remote connector execution, unrelated product slices, and deferred leisure features remain deferred. Local build authorization does not itself authorize deployment, source-control push, personal-account consent, or migration of live secrets.

## Tools package and life CLI

`packages/tools` is the authorized todo-list milestone per `docs/specs/HANDS.md`. The `life` CLI (see `skills/todo/SKILL.md`) is the way agents act on the list: adding, changing, scheduling, completing, or reading tasks. `LIFE_DATABASE_URL` lives in the root `.env`. The calendar piece of `HANDS.md` is specced (D44, D55 to D66) and its implementation brief is the "The calendar" section of `packages/tools/README.md`; build only what that brief describes. The leisure library is specced in `docs/specs/LEISURE.md` (D67 to D101) and its implementation brief is the "The library" section of `packages/tools/README.md`; the first cut named there is authorized (September 12, 2026), the second cut is not. Catalog keys (`LIFE_TMDB_KEY`, `LIFE_IGDB_CLIENT_ID`, `LIFE_IGDB_CLIENT_SECRET`) live in the root `.env`; tests never touch the network.

## Shared tools API

The September 17 API milestone is authorized by the user; see `docs/specs/API.md` and `packages/tools/API.md`. All existing tools functionality is exposed through the Hono API. The `life` CLI consumes HTTP and must not regain direct database or provider access. `Tools` remains the server-side business layer. Use established libraries for routing, validation, OpenAPI, and transport. `bun run api` starts the local Node API on port 4319. Database and provider credentials belong to the API server; clients use `LIFE_API_URL` and `LIFE_API_TOKEN`. Tests use fake providers and disposable database schemas, with CLI tests going through loopback HTTP. This authorization does not include deployment or deferred product features.

## Life-OS web

The September 25 web milestone is the independent website in `apps/web`, with its todo slice at `/todo`. It uses the existing tools HTTP API only, through a server-side same-origin bridge; database and provider access stays in `packages/tools`. Use Life-OS branding and shared shell/theme tokens so future project, calendar, and other slices can join this cohesive web app. Todoist is the functional reference, not the visual brand. Other slices require separate authorization. See `apps/web/README.md` for run commands and verification. Keep the API token server-side, bind local web services to loopback, and run browser mutation checks only against disposable data.

Before creating or changing a web slice, read `docs/DESIGN.md`. Reuse its finalized ocean-blue Life-OS palette, fonts, shell, and shared components. Primary controls use pale blue fills with readable blue text; do not reintroduce green or dark primary fills through slice-specific overrides. Keep that guide and `docs/DESIGN.json` in sync with intentional shared-design changes.

## Calendar web slice

The September 25 calendar request authorizes `/calendar` in `apps/web`, inspired by Fantastical's calendar and agenda layout. It uses the current calendar API only, with explicit event fields and no natural-language parsing. Reuse the shared Life-OS shell, theme, same-origin bridge, and server-side credentials. Calendar viewing, event editing, recurrence scopes, and invitation responses follow existing API contracts. Verify mutations only against disposable schemas and fake providers; development does not authorize changing personal events or connecting accounts.
