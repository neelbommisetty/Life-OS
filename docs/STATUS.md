# Current state and build scope

Last reconciled: September 29, 2026, for task-duration delivery on `codex/task-duration`; the broader inventory retains the September 27 baseline. This is a repository implementation snapshot, not a live service-health report. Refresh it when scope or delivery changes.

**Authentication, connectors and agent layer: approved to build; entirely unimplemented.** The capabilities listed below are the existing product baseline. They do not mean the target architecture is partially delivered. Neel confirmed both the implementation state and the build scope on September 27. The [approved plan](plans/2026-09-27-auth-connectors-agents.md) records the work.

## Current implementation

Life-OS currently has a local tools backend, an HTTP CLI, and a web app with task and calendar workspaces. The broader ambition is a connected personal environment across life areas, with Codex and the vault remaining central. Read the [vision](vision/VISION.md) for that destination.

| Surface | Implemented now | Evidence / boundary |
| --- | --- | --- |
| Domain tools | Native tasks, projects, sections, labels, filters; calendar accounts, sync, events and recurrence; movie/TV/game/book library and diary, catalog lookup and first-cut views. | [Tools brief](../packages/tools/README.md), [Tools facade](../packages/tools/src/tools.ts). Leisure second-cut features remain excluded. |
| API and CLI | Node/Hono API, PostgreSQL, explicit operations, OpenAPI, receipts and version checks; `life` consumes HTTP. | [API contract](../packages/tools/API.md), [operation registry](../packages/tools/src/api/operations.ts), [CLI](../packages/tools/src/cli.ts). Database and providers stay server-side. |
| Web | Shared ocean-blue shell; `/todo` task workspace and `/calendar` calendar/agenda workspace with explicit event forms. Task duration can be created, edited and cleared; lists/agendas show estimates and timed calendar blocks use them. | [Web guide](../apps/web/README.md), [duration verification](plans/2026-09-29-task-duration.md), [route entry](../apps/web/src/main.tsx). Project management within `/todo` exists; a separate `/projects` slice does not. |
| Provider adapters | Google Calendar; TMDB, IGDB and Open Library catalogs. | [Calendar adapter](../packages/tools/src/calendar/google/index.ts), [catalog code](../packages/tools/src/media/catalog). Implemented adapters do not establish current account access or provider health. |
| Authentication | Local single-user bearer token; the web bridge keeps it server-side. | [API auth middleware](../packages/tools/src/api/app.ts), [web bridge](../apps/web/server/bridge.ts). No owner login, distinct agent credentials, or per-agent policy enforcement yet. |
| Runtime and delivery | Local run/build commands; API defaults to port 4319, web to 4320, both on loopback. | [Root scripts](../package.json), [web runbook](../apps/web/README.md#run). Hosting is deferred. No live processes, credentials, personal data or external provider health were checked for this snapshot. |

The Health web prototype was removed. The connected area homes, adaptive Perspective/Plan views, vault publication bridge, permissioned connector framework, agent dispatch, and result publication are not implemented in this baseline.

## Scope register

Approval and delivery are different columns. **Approved** applies only to the cited bounded scope. **Design only** means design decisions exist but a build authorization is not recorded here. **Deferred** means excluded from the current build. **Implemented** means code exists in this baseline, not that it is hosted or live-connected.

| Work | Build approval | Delivery state | Authority and limits |
| --- | --- | --- | --- |
| Todo core and CLI | Approved | Implemented | [AGENTS.md: tools](../AGENTS.md#tools-package-and-life-cli), [Hands spec](specs/HANDS.md), [tools brief](../packages/tools/README.md). |
| Calendar core and Google adapter | Approved | Implemented | Same [tools scope](../AGENTS.md#tools-package-and-life-cli), [calendar brief](../packages/tools/README.md#the-calendar). No iCloud adapter in this scope. |
| Leisure library first cut | Approved September 12 | Implemented | [AGENTS.md](../AGENTS.md#tools-package-and-life-cli), [library brief](../packages/tools/README.md#the-library), [build review](reviews/LEISURE-BUILD-REVIEW.md). |
| Shared API and HTTP CLI | Approved September 17 | Implemented | [API milestone](specs/API.md), [AGENTS.md](../AGENTS.md#shared-tools-api). No hosting or new deferred domain features. |
| Web `/todo` and shared design system | Approved September 25 | Implemented | [AGENTS.md: web](../AGENTS.md#life-os-web), [web guide](../apps/web/README.md), [design system](DESIGN.md). |
| Web `/calendar` | Approved September 25 | Implemented | [AGENTS.md: calendar](../AGENTS.md#calendar-web-slice), [web guide](../apps/web/README.md#calendar-workflows). Explicit fields; no natural-language parser or new account-connection UI. |
| Authentication, connectors and agent layer, including permissions, orchestration, dispatch and result publication | Approved; scope confirmed by Neel September 27 | Planned; entirely unimplemented | [Approved build plan](plans/2026-09-27-auth-connectors-agents.md), [AGENTS.md](../AGENTS.md#authentication-connectors-and-agent-layer), [architecture](architecture/ARCHITECTURE.md), [authentication contract](architecture/AUTHENTICATION.md#confirmed-initial-scope). Deferred hardening and operational setup remain separate. |
| Documentation structure and status reconciliation | Approved by September 27 request | Complete | This index, register, document moves, corrected status claims and agent entry points. Documentation only. |
| Leisure second cut | Deferred | Not implemented | `worth-getting`, import, named lists, Google Books description fallback: [library brief](../packages/tools/README.md#the-library). |
| Area homes, adaptive views, vault publishing and additional web slices | No build approval recorded | Vision / proposed contracts | [Vision](vision/VISION.md), [data and views](architecture/DATA-AND-VIEWS.md). Health prototype removal does not authorize its restoration. |
| Hosting, secret migration, managed connector provisioning and personal-account setup | Separately scoped; no authorization from local development | Not delivered by these milestones | [Architecture gaps](architecture/ARCHITECTURE.md#existing-baseline-and-approved-build). Clerk is a design baseline; Nango and host secret facilities remain candidates. |
| Strong runtime isolation and remote connector execution | Deferred | Not implemented | [Architecture gaps](architecture/ARCHITECTURE.md#existing-baseline-and-approved-build). Initial API permissions are not isolation of shared Codex files, tools or conversations. |

## Active work and queue

**In progress:** none in this checkout. [Task duration from editor to calendar](plans/2026-09-29-task-duration.md) is complete, developed on `codex/task-duration` for integration into `main`, implemented by Codex for Neel under the September 29 request to build one bounded feature and subsequent explicit request to commit and push to `main`. No deployment performed.

**Approved and not started:** [authentication, connectors and the agent layer](plans/2026-09-27-auth-connectors-agents.md). Owner: Neel; implementing agent and checkout assigned when work starts. The plan records phases, acceptance checks and remaining decisions.

**Next action within approved scope:** assign the implementation checkout and resolve the plan's initial identity, connector and invocation bindings, then build toward the first complete synthetic request → agent → connector → web-result workflow. This is approved planned work; it is not yet in progress. No implementation blocker is recorded. Deployment, personal-account consent and live secret migration remain separate operational actions.

**Other checkout:** a detached worktree at `171501fe4` contains March 9 project/notes UI work on an older code line. It is outside this `main` baseline. Its existence does not prove active work, present approval, or integration. Reconcile its scope explicitly before resuming it.

When work starts, replace the relevant queue entry with a link to a [plan](plans/README.md), owner, branch/worktree, start/update date, remaining work, blocker (if any), and next action. When it finishes, move the result into the implementation and evidence sections.

## Verification evidence

September 29 task-duration checks: typecheck, production web build and design export check passed; 636 tools tests passed in `bun run test`, and all 16 web tests passed on the focused rerun after correcting a test to inspect domain-rejection receipts (HTTP 200) rather than expect HTTP 400. Desktop and 390px phone browser checks used disposable data and verified creation, reopening, editing, clearing, native fractional-minute validation and a 2–3:30 PM calendar block. See the [completion record](plans/2026-09-29-task-duration.md).

The implementation inventory was checked against source files, package scripts, existing implementation guides and Git history. The documentation reorganization and subsequent scope corrections were checked for local Markdown links/anchors, stale moved-path references and whitespace, including new files. Application tests and personal runtime checks were not run for these documentation-only changes.

| Baseline evidence | What it establishes |
| --- | --- |
| `38c47374e` | Shared HTTP API and removal of the Health prototype. |
| `57242408c` and [library review](reviews/LEISURE-BUILD-REVIEW.md) | First-cut leisure review fixes and historical verification. |
| `90dd10459` and [todo review](reviews/todo-design-review.md) | Web task workspace and shared design-system work. |
| `2ecbe36d7` and [calendar review](reviews/calendar-design-review.md) | Web calendar implementation and historical review. |
| `eac52ad75` and [security review](reviews/SECURITY-REVIEW.md) | Target-architecture documentation and design findings only; no implementation of that architecture. |

For a code change, use the relevant guides' checks, including `bun run typecheck` and `bun run test`, with disposable schemas and fake providers for mutation tests. Record actual results and remaining gaps in the change or plan; historical results are not a fresh test run.
