# Life-OS Test Plan (API + Web + iOS)

Last updated: 2026-03-06

## Purpose
This document tracks current product behavior in `apps/api`, `apps/web`, and `apps/ios`, grouped into:
- **User Facing Test Cases**: what users do and what they should see.
- **Platform Capabilities**: behind-the-scenes API, auth, proxy, middleware, and resilience behavior.

## Update Policy
When a feature is added or changed in `apps/api`, `apps/web`, or `apps/ios`, update this file in the same change.

Required updates for feature work:
- Update at least one relevant row in `User Facing Test Cases` and/or `Platform Capabilities`.
- Add at least one happy-path test and one edge/error-path test for changed behavior.
- If a new API endpoint is added, add/update API route tests in `apps/api/src/**/route.test.ts` in the same PR.
- If UI behavior changes, add/update web tests (unit and/or browser flow) for the user-facing behavior.
- If iOS behavior changes, add/update iOS unit and UI tests (`apps/ios/Life-OS/Life-OSTests`, `apps/ios/Life-OS/Life-OSUITests`) for the user-facing behavior.

Coverage Status Legend:
- Automated: Covered by unit/integration/e2e tests in-repo.
- Manual: Verified through repeatable manual QA flow.
- Planned: Required but not yet automated.

## User Facing Test Cases

| Area | Capability | Primary Routes | User-visible expectation | Required Test Coverage |
| --- | --- | --- | --- | --- |
| Auth | Sign in/sign up/forgot/reset password | `/auth/sign-in`, `/auth/sign-up`, `/auth/forget-password`, `/auth/reset-password` | Forms show success and error states; redirects happen correctly | Submit success/error paths for each flow |
| Auth | Legacy recover alias | `/auth/recover` | Route renders forgot-password experience (normalized to recover flow UI) | Route resolves and can submit password reset request path |
| Auth | Signed-in redirect on auth pages | `/auth/sign-in`, `/auth/sign-up` | Authenticated users are redirected to `/` | Redirect occurs when session exists |
| Auth | Session-gated app access | `/`, `/chat`, `/projects`, `/projects/[id]`, `/tasks`, `/tasks/archive`, `/inbox`, `/inbox/archive`, `/notes`, `/analytics`, `/account/*` | Unauthenticated users are redirected to `/auth/sign-in`; authenticated users load pages | Redirect and authenticated load success |
| Auth | Account profile/security actions | `/account/profile`, `/account/security` | Users can update name, change password, and sign out; success/error feedback is shown | Profile update, password change, sign-out success/error |
| iOS Auth | Login gate and auth flows | `apps/ios` auth gateway | App content stays locked until session exists; sign-in normalizes surrounding email whitespace; auth screens show success/error feedback across sign-in/sign-up/recover/reset | Unit + UI flow coverage for invalid + valid sign-in, whitespace-trimmed sign-in email, recover/reset validations, and gated app unlock |
| iOS Account | Account settings | `apps/ios` account tab (Profile/Security) | Users can update profile name, change password, and sign out with clear success/error states | UI flow coverage for profile save, password mismatch + success path, and sign-out redirect to login |
| iOS Shell | Protected mobile tabs | `apps/ios` capture/inbox/settings tabs | Authenticated users land on Capture by default, Capture shows native navigation chrome and the task-oriented placeholder copy, users can navigate Inbox and Settings, and unauthorized state returns to login | Authenticated tab render coverage plus unauthorized/session-expiry handling, including Capture title and placeholder visibility |
| iOS Inbox | API-backed capture + inbox resilience | `apps/ios` capture/inbox views + `/inbox` | Saving from Capture via the top-bar Save action creates inbox items via API; API failures preserve unsynced local items with retry; Inbox refresh mirrors API results into local cache, while empty-state and retry copy stay literal and consistent with the shared app language system | Unit + UI coverage for create/list happy path, failed create local fallback, retry sync success, stale synced cache pruning during refresh, and unauthorized handling |
| Shell | App chrome and navigation | shared layout with side/top nav | Navigation links work; mode toggle and user menu render expected state | Route navigation and auth menu behavior |
| Home | Dashboard cards | `/` | Greeting/date and recent projects/upcoming tasks/library render | Module rendering for empty/non-empty states |
| Projects | Project list and create flow | `/projects` | Users can open create dialog, validate input, and navigate to created project | Create success + validation/error path |
| Projects | Project detail and embedded workspace tabs | `/projects/[id]` | Users can edit metadata and use Overview/Assistant/Tasks/Library tabs | Edit success/error + tab content render |
| Tasks | Kanban CRUD and drag/drop | `/tasks` | Users can create/edit/delete tasks, search tasks, move task columns | CRUD + optimistic move + rollback on failure |
| Tasks | Archived tasks experience | `/tasks/archive` | Archived list loads and can be searched client-side | Archived data load + client filtering |
| Inbox | Inbox capture and item lifecycle controls | `/inbox` | Users can capture inbox items, review details, mark processed, and archive from the inbox view | Playwright create/list/detail plus process/archive coverage |
| Inbox | Inbox proposal output review UX | `/inbox` | `Resolve All as No` is unavailable for `PROCESSED`/`ARCHIVED` items and disabled when no unresolved outputs remain; todo proposals render structured full task previews from payload with safe fallback on malformed payloads | Web unit coverage for todo payload validation + API/unit coverage for proposal processing safety + Playwright coverage for button availability and preview rendering |
| Inbox | Inbox processing failure recovery | `/inbox` | When proposal generation fails, item transitions from `PROCESSING` back to `REVIEW`, persists `processingError`, and exposes retry/recover path (no stuck processing state) | Automated service-level state transition + persistence checks; manual UI retry/recover behavior from failed processing |
| Inbox | Inbox archive experience | `/inbox/archive` | Archived inbox items load and can be searched and unarchived | Playwright archived data load + search + unarchive coverage |
| Notes | Note selection and URL sync | `/notes` | Selecting notes updates `noteId`; first note auto-selects on `/notes` when available | Selection behavior + URL state + default selection |
| Notes | Note editor behavior | `/notes` | Preview/edit toggle, autosave debounce, save on unmount/id change, Cmd/Ctrl+S | Autosave and manual save shortcuts/edge cases |
| Chat | Thread management UI | `/chat` and project chat tab | Users can create/archive/select threads with URL sync and grouped/searchable list | Thread lifecycle + URL sync + filtering |
| Chat | Message history and thread switching | `/chat` | Messages paginate with cursor; switching threads returns view to latest message even after scrolling up | Cursor pagination + thread-switch scroll restoration |
| Chat | Streaming conversation UX | `/chat` via `/api/chat/stream` | Optimistic user message, streaming assistant output, stop-stream behavior, stream error badge | Stream lifecycle, cancellation, error handling |
| Chat | Model selection UX | `/chat` | Model list is visible; selection persists; invalid change shows error | Load list + successful change + invalid change path |
| Chat | Assistant message actions | `/chat` | Users can copy output, regenerate latest assistant response, and save assistant output as a note with note-specific labels and confirmations | Action availability + state transitions |
| Analytics | Usage dashboard rendering | `/analytics` | Summary cards, breakdown sections, recent activity render for empty/non-empty states | Dashboard shape and render coverage |
| Pricing | Model pricing catalog | `/pricing` | Pricing catalog loads grouped models with key pricing fields, including newly registered provider releases | Catalog render and key labels/values for newly added model entries |
| SEO | Route metadata titles and descriptions | `/`, `/chat`, `/notes`, `/tasks`, `/tasks/archive`, `/inbox`, `/inbox/archive`, `/projects`, `/projects/[id]`, `/analytics`, `/pricing`, `/auth/*`, `/account/*` | Each route exposes page-specific metadata for title/description (including dynamic auth/account/project paths) | Static metadata assertions + dynamic metadata resolution for known and fallback paths |
| Errors | Client error feedback | interactive routes and Next internal `/api/*` proxies | API/runtime failures show toasts or fallback error UI instead of silent failure | API error toast + unhandled rejection + route error fallback |

## Platform Capabilities

| Layer | Capability | Surface | Required Test Coverage |
| --- | --- | --- | --- |
| API Platform | Root health response | `GET /` | Returns 200 and expected body |
| API Platform | Request correlation | all API routes via middleware | Adds `x-request-id` when missing and preserves caller-provided `x-request-id`, including error responses |
| API Platform | Sentry error + performance tracing instrumentation | API bootstrap (`instrument.ts`) + middleware + chat streaming path | Verifies 5xx errors are captured while 4xx errors are not; when `SENTRY_DSN` is configured, request-level and chat step-level spans are emitted (`request parse`, `thread resolve`, `context get/create`, `context append`, `summarization`, `model call/stream`, `assistant save`) |
| API Platform | Readiness/status contract | `GET /status` | DB not configured, DB ready, DB check failure, `STATUS_DEBUG=true` reason, AI status shape |
| API Auth Proxy | Neon auth passthrough hardening | `ALL /auth`, `ALL /auth/*` | Proxies method/query/body/headers; strips host+forwarding headers; normalizes empty sign-out body to `{}` JSON; strips empty body headers on other non-GET auth routes; forwards upstream status/headers; rewrites upstream auth redirects to `/auth/*`; base URL missing error |
| API Auth | User identity resolution | protected-route middleware (`resolveUserIdFromRequest`) | JWT verify path, session fallback path, invalid auth handling, per-request cache, non-GET session lookup header stripping, timeout behavior, auth proxy misconfiguration fail-fast (`/auth`), upstream status surfaced in auth resolution errors |
| API Auth | Protected route gate | all non-public API routes | Unauthorized for missing/invalid session/JWT; success when identity resolves |
| API Data | Home API contract | `/home/recent-projects`, `/home/upcoming-tasks`, `/home/recent-notes` | Returns authenticated, user-scoped dashboard data for recent projects, upcoming tasks, and recent notes | `Automated`: route-level coverage for all three home endpoints (response status + payload shape assertions) |
| API Data | Projects API contract | `/projects*` | List/search/includeArchived, get by id, project+items payload shape/order, create/update/archive/unarchive/delete behavior |
| API Data | Tasks API contract | `/tasks*` | List/filter, archived list, CRUD semantics, due-date coercion, soft delete behavior |
| API Data | Auto-archive stale done tasks | implicit during task list queries | `DONE` tasks older than 7 days are archived (`deletedAt`) during list and archived-list reads |
| API Data | Inbox API contract | `/inbox*`, `/inbox/:itemId/outputs`, `/inbox/outputs/:outputId/*`, `/inbox/:itemId/outputs/*`, `/inbox/:id/recover` | List/get/create, processing lifecycle, proposal output CRUD + approval workflow, idempotent output mutations, and archive/unarchive actions | `Automated`: route-level coverage for list/get/create/process/recover/archive/unarchive, output actions (`approve`/`decline`/`retry`/`skip`), and bulk actions (`approve-all`/`decline-all`) including required `Idempotency-Key` validation |
| API Data | Inbox proposal generation guardrails | inbox generation pipeline (`inbox_kb_note`, `inbox_todo_list`) | Note proposals are omitted when non-actionable (including whitespace-only note fields), and inbox agent routing stays OpenAI-only to avoid Anthropic long non-streaming JSON request failures | `Automated`: non-substantive text guard unit coverage and service initialization verification in integration smoke |
| API Data | Inbox generation failure persistence | inbox proposal background generation | Unhandled generation failures persist `processingError` and move matching `PROCESSING` items to `REVIEW` to prevent stuck workflow state | `Automated`: failure path state transition/persistence checks; `Manual`: recover/retry path behavior on failed items |
| API Data | Inbox agent settings API contract | `/settings/inbox-agents` | Returns effective inbox agent defaults + user overrides and supports per-user enable/disable updates |
| API Data | Inbox auto-archive policy | implicit during inbox reads | `PROCESSED` items older than 7 days transition to `ARCHIVED` during list/get operations |
| API Data | Notes API contract | `/notes*` | List/filter/get/create/update/delete behavior, ownership checks, assistant-message save semantics |
| API Data | Notes back-reference cleanup | `DELETE /notes/:id` | Deleting a note clears linked `chatMessage.savedNoteId` references |
| API Data | Chat threads/messages/models contract | `/chat*` | Thread lifecycle, default thread creation, model assignment/reset behavior, cursor pagination contract, text-model filtering |
| API Streaming | Chat stream protocol | `POST /chat/stream` | SSE event contract (`chunk`, `message_saved`, `done`, `error`), persistence, regenerate constraints |
| API Streaming | Thread context cache for prompt assembly | `POST /chat/stream` | Non-regenerate chat writes USER/ASSISTANT turns into `ChatThreadContext`, lazy-backfills legacy threads, and preserves SSE contract while keeping regenerate behavior unchanged |
| API Analytics | Usage dashboard contract | `/analytics/dashboard` | Default params (`days=30`, `limit=10`), bounds/validation errors, summary + recent calls shape |
| API Errors | Error classification/mapping | shared error utilities + route handlers | Invalid JSON -> 400, validation -> 400, auth -> 401, not found -> 404, generic -> 500, configuration/provider readiness errors -> 503 |
| Web Platform | API auth proxy passthrough | browser `/api/auth/[...path]` -> backend `/auth/*` | Preserves method/query/body/headers to API, propagates `x-request-id`, strips empty-body `content-type`/`content-length` before proxying |
| Web Platform | Server auth session contract | `apps/web/src/lib/api/session.ts` -> `/auth/get-session` | Session resolution uses canonical `/auth/get-session`; valid payload resolves user; `401`, null, or empty payload resolves signed-out; non-401 non-2xx bubbles explicit API error | `Automated`: session parser and server auth gate coverage; `Manual`: authenticated and signed-out route-gate verification |
| Web Platform | Sentry instrumentation + route error boundary | `apps/web/src/instrumentation.ts`, `apps/web/src/instrumentation-client.ts`, `apps/web/src/app/error.tsx`, `apps/web/src/app/global-error.tsx` | App initializes Sentry on client/server runtimes and renders route/global fallback UI on thrown errors while preserving observability capture hooks | `Manual`: trigger route/global errors and verify fallback UI + capture; `Planned`: browser automation for error boundary + capture assertion |
| Web Platform | API chat stream proxy passthrough | `/api/chat/stream` | Forwards request/response stream and propagates `x-request-id` |
| Web Platform | Server API base URL resolution | `apps/web/src/lib/api/base-url*.ts` | `API_BASE_URL` precedence, dev fallback `http://localhost:3001`, production fallback to `NEXT_PUBLIC_API_BASE_URL`, throws when unresolved in production |
| Web Platform | Server-side API auth redirect behavior | `apps/web/src/lib/api/fetch.ts` | Server-side API 401 responses redirect to `/auth/sign-in` |
| Web Platform | AI model catalog registry consistency | `/pricing`, `@life-os/ai/services` | Pricing catalog reads registered model metadata from the same initialized AI services module instance used by chat services, including newly added provider model releases |
| Web Platform | App Router metadata coverage | `apps/web/src/app/**/page.tsx` | Every page route exports `metadata` or `generateMetadata`; dynamic routes resolve context-specific titles/descriptions |
| Build Platform | Dynamic rendering boundary | app layout + API-backed routes | `next build` succeeds without build-time API base URL while runtime checks still execute on request |
| Build Platform | Monorepo runtime prep orchestration | root `postinstall` / `prebuild` / `vercel:install:*` scripts and app Vercel `installCommand` | Install/build flows deterministically run Prisma client generation plus DB/AI workspace runtime builds before API/web build and type steps |
| Build Platform | Dev startup runtime prep enforcement | root `dev:all` / `dev:web` / `dev:api` via `scripts/dev-with-logs.sh` | Dev startup runs `prepare:runtime` before launching services unless `LIFE_OS_SKIP_RUNTIME_PREP=1` is explicitly set | `Manual`: run default dev commands and skip-flag variant; `Planned`: script-level smoke assertions in CI |
| AI Platform | Structured JSON schema compatibility fallback | `packages/ai/src/core/json.ts` (`callJson`) | JSON schema generation prefers `z.toJSONSchema` when available and falls back to `zod-to-json-schema` for compatibility | `Automated`: package unit coverage on schema generation path with fallback safety |
| iOS Platform | Auth/API client contract handling | `apps/ios/Life-OS/Life-OS/ContentView.swift` (`APIClient`, `AuthService`, `AppState`) | iOS maps auth to canonical `/auth/*` and app-data calls to canonical no-prefix routes (`/home/*`, `/notes*`, `/inbox*`), trims surrounding whitespace from auth email inputs before request submission, keeps an in-memory fallback cookie jar from auth `Set-Cookie` headers for subsequent API requests, treats empty/null session payloads as signed-out, enforces login gate, and transitions to auth on `401` responses |
| iOS Platform | Inbox API cache + sync contract | `apps/ios/Life-OS/Life-OS/{Views,State,Networking}` | iOS uses `/inbox` as source of truth, mirrors results into SwiftData cache, preserves unsynced local captures when create fails, supports retry sync, and clears stale synced cache entries during refresh |
| iOS Platform | Mock API test harness | `apps/ios/Life-OS/Life-OS/Mocks/IOSMockAPI.swift` | Deterministic auth/home/library/account/inbox responses when `LIFE_OS_USE_MOCK_API=1` for repeatable unit/UI e2e tests, including one-shot failure/unauthorized scenarios |
| iOS Platform | Sentry SDK startup instrumentation | `apps/ios/Life-OS/Life-OS/Life_OSApp.swift` | App bootstrap initializes Sentry SDK and startup capture hooks without blocking auth-gated navigation or shell rendering | `Manual`: startup smoke with Sentry enabled; `Planned`: add startup instrumentation assertions to iOS UI test harness |

## Core Regression Checklist
Run this set before release and after large refactors:

1. API smoke: `GET /`, `GET /status`.
2. Auth smoke: sign in, authenticated access, sign out.
3. Projects: create, edit, open detail page.
4. Tasks: create, move across columns, archive visibility.
5. Inbox lifecycle: capture item, mark processed, archive/unarchive, and archive search.
6. Inbox proposal review controls: verify `Resolve All as No` hidden for `PROCESSED`/`ARCHIVED` and disabled with no unresolved outputs.
7. Inbox proposal preview: verify valid `todo_list` payload renders structured tasks and malformed payload falls back safely.
8. Inbox failure recovery: verify generation failure returns item to `REVIEW` with `processingError`, then retry/recover works.
9. Notes: create/edit/delete and autosave behavior.
10. Chat: send prompt, stream response, regenerate, save assistant message as note.
11. Analytics: dashboard loads with non-empty and empty usage states.
12. Pricing page: `/pricing` renders grouped model catalog sections and shows expected pricing keys/labels and correct entry-level values for newly registered provider releases.
13. iOS smoke: invalid + valid sign-in, account profile/password updates, and sign-out returns to auth gate.
14. Dev runner smoke: `bun run dev:all|dev:web|dev:api` executes runtime prep by default; `LIFE_OS_SKIP_RUNTIME_PREP=1` bypasses prep.

## Current Test File Index
- API route and module tests:
  - `apps/api/src/app.test.ts`
  - `apps/api/src/routes/auth.test.ts`
  - `apps/api/src/routes/status.test.ts`
  - `apps/api/src/modules/common/auth.test.ts`
  - `apps/api/src/modules/common/errors.test.ts`
  - `apps/api/src/modules/common/http.test.ts`
  - `apps/api/src/modules/home/route.test.ts`
  - `apps/api/src/modules/projects/route.test.ts`
  - `apps/api/src/modules/tasks/route.test.ts`
  - `apps/api/src/modules/inbox/route.test.ts`
  - `apps/api/src/modules/inbox/service.test.ts`
  - `apps/api/src/modules/notes/route.test.ts`
  - `apps/api/src/modules/chat/route.test.ts`
  - `apps/api/src/modules/chat/stream-utils.test.ts`
  - `apps/api/src/modules/chat/thread-context-service.test.ts`
  - `apps/api/src/modules/analytics/route.test.ts`
  - `apps/api/src/modules/settings/inbox-agents-route.test.ts`
- Web unit tests (selected):
  - `apps/web/src/lib/api/base-url.test.ts`
  - `apps/web/src/lib/api/error-message.test.ts`
  - `apps/web/src/lib/api/proxy-request.test.ts`
  - `apps/web/src/lib/chat/validations.test.ts`
  - `apps/web/src/lib/inbox/validations.test.ts`
  - `apps/web/src/lib/chat-utils.test.ts`
  - `apps/web/src/lib/brand.test.ts`
  - `apps/web/src/lib/notes/note-save.test.ts`
  - `apps/web/src/lib/notes/note-utils.test.ts`
  - `apps/web/src/lib/notes/validations.test.ts`
  - `apps/web/src/lib/utils.test.ts`
  - `apps/web/src/components/chat/message-actions.test.ts`
  - `apps/web/src/app/tasks/tasks-utils.test.ts`
- Web e2e tests:
  - `apps/web/tests/e2e/account-flows.e2e.ts`
  - `apps/web/tests/e2e/analytics.e2e.ts`
  - `apps/web/tests/e2e/auth-flows.e2e.ts`
  - `apps/web/tests/e2e/auth-redirects.e2e.ts`
  - `apps/web/tests/e2e/chat-message-actions.e2e.ts`
  - `apps/web/tests/e2e/chat-message-history.e2e.ts`
  - `apps/web/tests/e2e/session-gates.e2e.ts`
  - `apps/web/tests/e2e/chat-model-selector.e2e.ts`
  - `apps/web/tests/e2e/chat-scroll.e2e.ts`
  - `apps/web/tests/e2e/chat-streaming.e2e.ts`
  - `apps/web/tests/e2e/chat-thread-management.e2e.ts`
  - `apps/web/tests/e2e/chat-thread-switch-scroll.e2e.ts`
  - `apps/web/tests/e2e/home-dashboard.e2e.ts`
  - `apps/web/tests/e2e/inbox-archive.e2e.ts`
  - `apps/web/tests/e2e/inbox-lifecycle.e2e.ts`
  - `apps/web/tests/e2e/inbox-proposal-review.e2e.ts`
  - `apps/web/tests/e2e/notes-editor.e2e.ts`
  - `apps/web/tests/e2e/notes-selection.e2e.ts`
  - `apps/web/tests/e2e/pricing.e2e.ts`
  - `apps/web/tests/e2e/project-detail.e2e.ts`
  - `apps/web/tests/e2e/projects-flows.e2e.ts`
  - `apps/web/tests/e2e/shell-navigation.e2e.ts`
  - `apps/web/tests/e2e/tasks-archive.e2e.ts`
  - `apps/web/tests/e2e/tasks-kanban.e2e.ts`
- iOS tests:
  - `apps/ios/Life-OS/Life-OSTests/BrandCopyTests.swift`
  - `apps/ios/Life-OS/Life-OSTests/Life_OSTests.swift`
  - `apps/ios/Life-OS/Life-OSUITests/Life_OSUITests.swift`
  - `apps/ios/Life-OS/Life-OSUITests/Life_OSUITestsLaunchTests.swift`
