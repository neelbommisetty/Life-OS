# Life-OS Test Plan (API + Web)

Last updated: 2026-02-09

## Purpose
This document tracks current product behavior in `apps/api` and `apps/web`, grouped into:
- **User Facing Test Cases**: what users do and what they should see.
- **Platform Capabilities**: behind-the-scenes API, auth, proxy, middleware, and resilience behavior.

## Update Policy
When a feature is added or changed in `apps/api` or `apps/web`, update this file in the same change.

Required updates for feature work:
- Update at least one relevant row in `User Facing Test Cases` and/or `Platform Capabilities`.
- Add at least one happy-path test and one edge/error-path test for changed behavior.
- If a new API endpoint is added, add/update API route tests in `apps/api/src/**/route.test.ts` in the same PR.
- If UI behavior changes, add/update web tests (unit and/or browser flow) for the user-facing behavior.

## User Facing Test Cases

| Area | Capability | Primary Routes | User-visible expectation | Required Test Coverage |
| --- | --- | --- | --- | --- |
| Auth | Sign in/sign up/forgot/reset password | `/auth/sign-in`, `/auth/sign-up`, `/auth/forget-password`, `/auth/reset-password` | Forms show success and error states; redirects happen correctly | Submit success/error paths for each flow |
| Auth | Legacy recover alias | `/auth/recover` | Route renders forgot-password experience (normalized to recover flow UI) | Route resolves and can submit password reset request path |
| Auth | Signed-in redirect on auth pages | `/auth/sign-in`, `/auth/sign-up` | Authenticated users are redirected to `/` | Redirect occurs when session exists |
| Auth | Session-gated app access | `/`, `/chat`, `/projects`, `/projects/[id]`, `/tasks`, `/tasks/archive`, `/notes`, `/analytics`, `/account/*` | Unauthenticated users are redirected to `/auth/sign-in`; authenticated users load pages | Redirect and authenticated load success |
| Auth | Account profile/security actions | `/account/profile`, `/account/security` | Users can update name, change password, and sign out; success/error feedback is shown | Profile update, password change, sign-out success/error |
| Shell | App chrome and navigation | shared layout with side/top nav | Navigation links work; mode toggle and user menu render expected state | Route navigation and auth menu behavior |
| Home | Dashboard cards | `/` | Greeting/date and recent projects/upcoming tasks/recent notes render | Module rendering for empty/non-empty states |
| Projects | Project list and create flow | `/projects` | Users can open create dialog, validate input, and navigate to created project | Create success + validation/error path |
| Projects | Project detail and embedded workspace tabs | `/projects/[id]` | Users can edit metadata and use Overview/Chat/Tasks/Notes tabs | Edit success/error + tab content render |
| Tasks | Kanban CRUD and drag/drop | `/tasks` | Users can create/edit/delete tasks, search tasks, move task columns | CRUD + optimistic move + rollback on failure |
| Tasks | Archived tasks experience | `/tasks/archive` | Archived list loads and can be searched client-side | Archived data load + client filtering |
| Notes | Note selection and URL sync | `/notes` | Selecting notes updates `noteId`; first note auto-selects on `/notes` when available | Selection behavior + URL state + default selection |
| Notes | Note editor behavior | `/notes` | Preview/edit toggle, autosave debounce, save on unmount/id change, Cmd/Ctrl+S | Autosave and manual save shortcuts/edge cases |
| Chat | Thread management UI | `/chat` and project chat tab | Users can create/archive/select threads with URL sync and grouped/searchable list | Thread lifecycle + URL sync + filtering |
| Chat | Message history and thread switching | `/chat` | Messages paginate with cursor; switching threads returns view to latest message even after scrolling up | Cursor pagination + thread-switch scroll restoration |
| Chat | Streaming conversation UX | `/chat` via `/api/chat/stream` | Optimistic user message, streaming assistant output, stop-stream behavior, stream error badge | Stream lifecycle, cancellation, error handling |
| Chat | Model selection UX | `/chat` | Model list is visible; selection persists; invalid change shows error | Load list + successful change + invalid change path |
| Chat | Assistant message actions | `/chat` | Users can copy output, regenerate latest assistant response, save assistant message as note | Action availability + state transitions |
| Analytics | Usage dashboard rendering | `/analytics` | Summary cards, breakdown sections, recent activity render for empty/non-empty states | Dashboard shape and render coverage |
| Pricing | Model pricing catalog | `/pricing` | Pricing catalog loads grouped models with key pricing fields | Catalog render and key labels/values |
| SEO | Route metadata titles and descriptions | `/`, `/chat`, `/notes`, `/tasks`, `/tasks/archive`, `/projects`, `/projects/[id]`, `/analytics`, `/pricing`, `/auth/*`, `/account/*` | Each route exposes page-specific metadata for title/description (including dynamic auth/account/project paths) | Static metadata assertions + dynamic metadata resolution for known and fallback paths |
| Errors | Client error feedback | all interactive routes calling `/api/*` | API/runtime failures show toasts or fallback error UI instead of silent failure | API error toast + unhandled rejection + route error fallback |

## Platform Capabilities

| Layer | Capability | Surface | Required Test Coverage |
| --- | --- | --- | --- |
| API Platform | Root health response | `GET /` | Returns 200 and expected body |
| API Platform | Request correlation | all API routes via middleware | Adds `x-request-id` when missing and preserves caller-provided `x-request-id`, including error responses |
| API Platform | Readiness/status contract | `GET /status`, `GET /api/status` | DB not configured, DB ready, DB check failure, `STATUS_DEBUG=true` reason, AI status shape |
| API Auth Proxy | Neon auth passthrough hardening | `ALL /api/auth`, `ALL /api/auth/*` | Proxies method/query/body/headers; strips host+forwarding headers; normalizes empty sign-out body to `{}` JSON; strips empty body headers on other non-GET auth routes; forwards upstream status/headers; rewrites upstream auth redirects to `/api/auth/*`; base URL missing error |
| API Auth | User identity resolution | protected-route middleware (`resolveUserIdFromRequest`) | JWT verify path, session fallback path, invalid auth handling, per-request cache, non-GET session lookup header stripping, timeout behavior, same-origin/cross-origin `/api/auth` proxy misconfiguration fail-fast, upstream status surfaced in auth resolution errors |
| API Auth | Protected route gate | all non-public API routes | Unauthorized for missing/invalid session/JWT; success when identity resolves |
| API Data | Projects API contract | `/projects*`, `/api/projects*` | List/search/includeArchived, get by id, project+items payload shape/order, create/update/archive/unarchive/delete behavior |
| API Data | Tasks API contract | `/tasks*`, `/api/tasks*` | List/filter, archived list, CRUD semantics, due-date coercion, soft delete behavior |
| API Data | Auto-archive stale done tasks | implicit during task list queries | `DONE` tasks older than 7 days are archived (`deletedAt`) during list and archived-list reads |
| API Data | Notes API contract | `/notes*`, `/api/notes*` | List/filter/get/create/update/delete behavior, ownership checks, assistant-message save semantics |
| API Data | Notes back-reference cleanup | `DELETE /notes/:id` (+ `/api/*`) | Deleting a note clears linked `chatMessage.savedNoteId` references |
| API Data | Chat threads/messages/models contract | `/chat*`, `/api/chat*` | Thread lifecycle, default thread creation, model assignment/reset behavior, cursor pagination contract, text-model filtering |
| API Streaming | Chat stream protocol | `POST /chat/stream`, `/api/chat/stream` | SSE event contract (`chunk`, `message_saved`, `done`, `error`), persistence, regenerate constraints |
| API Analytics | Usage dashboard contract | `/analytics/dashboard`, `/api/analytics/dashboard` | Default params (`days=30`, `limit=10`), bounds/validation errors, summary + recent calls shape |
| API Errors | Error classification/mapping | shared error utilities + route handlers | Invalid JSON -> 400, validation -> 400, auth -> 401, not found -> 404, generic -> 500, configuration/provider readiness errors -> 503 |
| Web Platform | API auth proxy passthrough | `/api/auth/[...path]` | Preserves method/query/body/headers to API, propagates `x-request-id`, strips empty-body `content-type`/`content-length` before proxying |
| Web Platform | API chat stream proxy passthrough | `/api/chat/stream` | Forwards request/response stream and propagates `x-request-id` |
| Web Platform | Server API base URL resolution | `apps/web/src/lib/api/base-url*.ts` | `API_BASE_URL` precedence, dev fallback `http://localhost:3001`, production fallback to `NEXT_PUBLIC_API_BASE_URL`, throws when unresolved in production |
| Web Platform | Server-side API auth redirect behavior | `apps/web/src/lib/api/fetch.ts` | Server-side API 401 responses redirect to `/auth/sign-in` |
| Web Platform | App Router metadata coverage | `apps/web/src/app/**/page.tsx` | Every page route exports `metadata` or `generateMetadata`; dynamic routes resolve context-specific titles/descriptions |
| Build Platform | Dynamic rendering boundary | app layout + API-backed routes | `next build` succeeds without build-time API base URL while runtime checks still execute on request |
| Build Platform | Monorepo runtime prep orchestration | root `postinstall` / `prebuild` / `vercel:install:*` scripts and app Vercel `installCommand` | Install/build flows deterministically run Prisma client generation plus DB/AI workspace runtime builds before API/web build and type steps |

## Core Regression Checklist
Run this set before release and after large refactors:

1. API smoke: `GET /`, `GET /status`, `GET /api/status`.
2. Auth smoke: sign in, authenticated access, sign out.
3. Projects: create, edit, open detail page.
4. Tasks: create, move across columns, archive visibility.
5. Notes: create/edit/delete and autosave behavior.
6. Chat: send prompt, stream response, regenerate, save assistant message as note.
7. Analytics: dashboard loads with non-empty and empty usage states.
8. Pricing page: catalog renders without runtime errors.

## Current Test File Index
- API route and module tests:
  - `apps/api/src/app.test.ts`
  - `apps/api/src/routes/auth.test.ts`
  - `apps/api/src/routes/status.test.ts`
  - `apps/api/src/modules/common/auth.test.ts`
  - `apps/api/src/modules/common/errors.test.ts`
  - `apps/api/src/modules/home/route.test.ts`
  - `apps/api/src/modules/projects/route.test.ts`
  - `apps/api/src/modules/tasks/route.test.ts`
  - `apps/api/src/modules/notes/route.test.ts`
  - `apps/api/src/modules/chat/route.test.ts`
  - `apps/api/src/modules/analytics/route.test.ts`
- Web unit tests (selected):
  - `apps/web/src/lib/api/base-url.test.ts`
  - `apps/web/src/lib/api/error-message.test.ts`
  - `apps/web/src/lib/api/proxy-request.test.ts`
  - `apps/web/src/lib/chat/validations.test.ts`
  - `apps/web/src/lib/chat-utils.test.ts`
  - `apps/web/src/lib/notes/note-save.test.ts`
  - `apps/web/src/lib/notes/note-utils.test.ts`
  - `apps/web/src/lib/notes/validations.test.ts`
  - `apps/web/src/lib/utils.test.ts`
  - `apps/web/src/components/chat/message-actions.test.ts`
  - `apps/web/src/app/tasks/tasks-utils.test.ts`
- Web e2e tests:
  - `apps/web/tests/e2e/auth-flows.e2e.ts`
  - `apps/web/tests/e2e/session-gates.e2e.ts`
  - `apps/web/tests/e2e/chat-model-selector.e2e.ts`
  - `apps/web/tests/e2e/chat-scroll.e2e.ts`
  - `apps/web/tests/e2e/chat-thread-switch-scroll.e2e.ts`
  - `apps/web/tests/e2e/notes-selection.e2e.ts`
  - `apps/web/tests/e2e/pricing.e2e.ts`
