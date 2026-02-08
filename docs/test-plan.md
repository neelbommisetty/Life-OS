# Life-OS Test Plan (API + Web)

Last updated: 2026-02-08

## Purpose
This document tracks all current product capabilities in `apps/api` and `apps/web` and the tests required to keep them stable.

## Update Policy
When a feature is added or changed in `apps/api` or `apps/web`, update this file in the same change.

Required updates for feature work:
- Add or update the relevant capability row in this document.
- Add at least one happy-path test and one edge/error-path test for the changed capability.
- If a new API endpoint is added, add/update API route tests in `apps/api/src/**/route.test.ts` in the same PR.
- If UI behavior changes, add/update web tests (unit and/or browser flow) for the user-facing behavior.

## API Capabilities

| Area | Capability | Endpoints | Required Test Coverage |
| --- | --- | --- | --- |
| Platform | Root health response | `GET /` | Returns 200 and expected message body |
| Platform | Request correlation logging | all API routes via app middleware | Adds `x-request-id` when missing and preserves caller-provided `x-request-id`, including error responses |
| Platform | Service readiness status | `GET /status`, `GET /api/status` | DB not configured, DB ready, DB check failure, `STATUS_DEBUG=true` reason |
| Auth | Neon Auth proxy passthrough | `ALL /api/auth`, `ALL /api/auth/*` | Proxies method/headers/body/query; forwards upstream status/headers; base URL missing error |
| Auth | User identity resolution | middleware on protected routes | Bearer JWT validation path, session fallback path, invalid auth handling, per-request cache behavior |
| Auth | Protected route gate | all non-public routes | Unauthorized when session/JWT missing/invalid; success with valid session/JWT |
| Home | Dashboard cards data | `GET /home/recent-projects`, `/home/upcoming-tasks`, `/home/recent-notes` (+ `/api/*`) | Correct limits/order/filtering and auth isolation |
| Projects | List/search/archive filtering | `GET /projects`, `GET /api/projects` | Search by name/description, includeArchived toggle, default non-archived |
| Projects | Get by ID | `GET /projects/:id`, `/api/projects/:id` | Own project returns 200; missing/wrong owner returns 404 |
| Projects | Project + related items | `GET /projects/:id/items`, `/api/projects/:id/items` | Includes active chat threads/tasks/notes in expected order |
| Projects | Create | `POST /projects`, `/api/projects` | Valid create returns 201; validation errors for missing/invalid fields |
| Projects | Update | `PATCH /projects/:id`, `/api/projects/:id` | Partial update works; non-owner/not found returns 404 |
| Projects | Archive/unarchive | `POST /projects/:id/archive`, `/api/projects/:id/archive`, `POST /projects/:id/unarchive`, `/api/projects/:id/unarchive` | Archive sets `archivedAt`; unarchive clears it; idempotency/error expectations |
| Projects | Delete | `DELETE /projects/:id`, `/api/projects/:id` | Deletes own project; missing project returns 404 |
| Tasks | List/filter | `GET /tasks`, `/api/tasks` | Search, status, project filter, ordering, auth isolation |
| Tasks | Auto-archive stale done tasks | implicit on list endpoints | `DONE` tasks older than 7 days become archived (`deletedAt`) |
| Tasks | List archived | `GET /tasks/archived`, `/api/tasks/archived` | Returns soft-deleted tasks ordered by `deletedAt desc` |
| Tasks | Create/update/delete | `POST /tasks`, `PATCH /tasks/:id`, `DELETE /tasks/:id` (+ `/api/*`) | CRUD happy paths, due-date coercion, validation failures, soft-delete behavior |
| Notes | List/filter | `GET /notes`, `/api/notes` | Search by title/content, project filtering, excludes deleted |
| Notes | Get/create/update/delete | `GET /notes/:id`, `POST /notes`, `PATCH /notes/:id`, `DELETE /notes/:id` (+ `/api/*`) | CRUD happy paths, ownership checks, soft delete |
| Notes | Save assistant message as note | `POST /notes/save-from-message`, `/api/notes/save-from-message` | Only assistant messages allowed, idempotent re-save, links `savedNoteId` |
| Chat | List/create/archive threads | `GET /chat/threads`, `POST /chat/threads`, `POST /chat/threads/:threadId/archive` (+ `/api/*`) | Thread lifecycle, project scoping, archived filtering |
| Chat | Default thread creation behavior | `GET /chat/threads`, `POST /chat/stream` (+ `/api/*`) | Creates default thread when listing and none exists; stream creates thread when needed |
| Chat | Thread detail/model assignment | `GET /chat/threads/:threadId`, `POST /chat/threads/:threadId/model` (+ `/api/*`) | Invalid model rejected; valid model persists; invalid stored model is reset |
| Chat | Messages pagination | `GET /chat/threads/:threadId/messages`, `/api/...` | Cursor contract (`cursorId` + `cursorCreatedAt`), `limit` bounds, ordering/nextCursor |
| Chat | List text models | `GET /chat/models`, `/api/chat/models` | Returns only text-capable models with metadata fields; authenticated app integration keeps list non-empty |
| Chat | Streaming + regenerate flow | `POST /chat/stream`, `/api/chat/stream` | SSE events (`chunk`, `message_saved`, `done`, `error`), persistence, regenerate constraints |
| Analytics | Usage dashboard | `GET /analytics/dashboard`, `/api/analytics/dashboard` | Default `days=30`, `limit=10`; bounds and validation errors; summary + recent calls payload |
| Errors | Error mapping and JSON parsing | all routes | Invalid JSON -> 400, validation -> 400, not found -> 404, auth -> 401 |

## Web Capabilities

| Area | Capability | Primary Routes | Required Test Coverage |
| --- | --- | --- | --- |
| Auth | Sign in/sign up/forgot/reset password flows | `/auth/sign-in`, `/auth/sign-up`, `/auth/forget-password`, `/auth/reset-password` | Form submit success/error states and redirects |
| Auth | Session-gated pages | `/`, `/chat`, `/projects`, `/tasks`, `/notes`, `/analytics`, `/account/*` | Unauthenticated redirect to `/auth/sign-in`; authenticated load success |
| Auth | Account profile/security management | `/account/profile`, `/account/security` | Update profile name, change password, sign out behavior |
| Shell | App chrome + navigation | shared layout with side/top nav | Nav links route correctly; mode toggle renders; user menu reflects server session state and sign out behavior |
| Home | Dashboard modules | `/` | Greeting/date renders; recent projects/upcoming tasks/recent notes blocks load |
| Projects | Project list/create | `/projects` | Create dialog validation; successful create navigates to project detail |
| Projects | Project detail + edit | `/projects/[id]` | Edit project metadata; tabs load Overview/Chat/Tasks/Notes |
| Tasks | Kanban board CRUD | `/tasks` | Create/edit/delete task, search filter, DnD status change optimistic + rollback path |
| Tasks | Archived tasks view | `/tasks/archive` | Archived list loads and search filters client-side |
| Notes | Notes selection/editing | `/notes` | Select/create/delete note, URL sync via `noteId`, grouped notes by project |
| Notes | Editor behavior | `/notes` | Markdown preview/edit toggle, autosave debounce, save on unmount/id change, Cmd/Ctrl+S |
| Chat | Thread management UI | `/chat` and project-scoped chat tab | Create/archive/select thread, URL sync via `threadId`, grouped + searchable list |
| Chat | Message history and pagination | `/chat` | Initial load, thread switch auto-scrolls to latest message, scroll-up pagination with cursor, loading states, delayed-render content keeps latest message in view after thread switch |
| Chat | Streaming chat UX | `/chat` via `/api/chat/stream` | Optimistic user message, live streamed assistant content, stop streaming, error badge |
| Chat | Model selection UX | `/chat` | Model list loads, change persists, invalid selection error shown |
| Chat | Assistant message actions | `/chat` | Copy, regenerate latest assistant message only, save-as-note status transitions |
| Analytics | AI usage dashboard | `/analytics` | Summary cards, model/type/thread breakdown sections, recent activity render |
| Pricing | Model pricing catalog | `/pricing` | Model registry renders grouped provider cards and price fields |
| API Proxy | Web auth/chat passthrough routes | `/api/auth/[...path]`, `/api/chat/stream` | Preserves method/body/headers/query, propagates `x-request-id`, and forwards upstream status |

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
- API route tests: `apps/api/src/**/*.test.ts`
- Web unit tests (selected):
  - `apps/web/src/lib/**/*.test.ts`
  - `apps/web/src/components/chat/message-actions.test.ts`
  - `apps/web/src/app/tasks/tasks-utils.test.ts`
- Web e2e tests:
  - `apps/web/tests/e2e/*.e2e.ts`
