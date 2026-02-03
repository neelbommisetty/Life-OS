# iOS Companion Inbox - Monorepo/API Design

Date: 2026-02-03
Owner: Life-OS

## Summary

Set up a Bun workspaces monorepo with three apps: `apps/web` (Next.js UI + web integration), `apps/ios` (iOS client), and `apps/api` (standalone API service). The API is the single source of truth for data access and business logic so both web and iOS use the same endpoints. Neon Auth (Better Auth) is the unified identity provider across web and mobile.

## Goals

- Provide a shared “Companion Inbox” backend for both web and iOS.
- Centralize authorization, data access, and business rules in one API.
- Keep web focused on UI and iOS focused on client UX.
- Ensure stable contracts and predictable evolution for mobile.

## Non-Goals

- Building advanced realtime delivery or push notification infrastructure in this phase.
- Splitting the database or maintaining multiple Prisma schemas.

## Architecture

- **Monorepo layout** (Bun workspaces):
  - `apps/web`: Next.js app, UI-only concerns, server actions call the API.
  - `apps/ios`: iOS client app.
  - `apps/api`: standalone HTTP API (Hono/Express/Fastify).
  - `packages/shared`: Zod schemas and DTOs shared by web, API, and iOS.
- **Data ownership**: Prisma and database access live only in `apps/api`.
- **Web integration**: Next.js server components/actions call the API over HTTP.
- **iOS integration**: iOS calls the same API endpoints over HTTPS.

## Auth & Security (Neon Auth)

- **Single identity provider**: Neon Auth (Better Auth) for both web and iOS.
- **API gate**: All API requests require a valid session token.
- **Web**:
  - Auth flow uses secure, httpOnly cookies.
  - Next.js server reads the session and forwards a short‑lived token to the API.
  - Client JS never sees tokens.
- **iOS**:
  - Auth flow produces the same token type.
  - Store tokens in Keychain and send as `Authorization: Bearer <token>`.
- **Concerns & mitigations**:
  - CSRF: enforce SameSite or CSRF tokens for mutations.
  - Token leakage: avoid exposing tokens to browser JS.
  - Refresh: iOS handles refresh; web refreshes server‑side.
  - CORS: allow only known origins; mobile allowlist separate.
  - Authorization: enforce in API only (centralized policy).

## Data Flow & API Design

- **Primary endpoints**:
  - `GET /inbox` (list with pagination)
  - `GET /inbox/:id` (thread view)
  - `POST /inbox` (create item)
  - `POST /inbox/:id/messages` (reply)
  - `PATCH /inbox/:id` (status: read/unread/archived)
- **Schema**:
  - `InboxItem`, `Message`, optional `Participant/InboxMembership` for multi‑user.
  - API filters by authenticated user/org.
- **Pagination**:
  - Cursor + limit, return `nextCursor`.
- **Contracts**:
  - Zod schemas in `packages/shared` to prevent drift.
  - API validates requests and responses against shared schemas.
- **Errors**:
  - Standard `{ code, message }` shape with shared mapping.

## Testing & Operations

- **Testing**:
  - API unit tests with Bun (`apps/api`) for auth, pagination, and mutations.
  - Contract tests using shared schemas.
  - Web tests focus on integration (server actions to API).
  - iOS uses schema-based mocks for view models.
- **Operations**:
  - `apps/api` owns `DATABASE_URL` and Neon Auth secrets.
  - `apps/web` only stores API base URL + public auth config.
  - API deploys independently; backward‑compatible changes prioritized.
- **Rollout**:
  - Ship API endpoints first, migrate web to use them, then enable iOS.
  - Add basic logging and error tracking; rate limit API endpoints.

## Migration Notes

- No separate migrations for web APIs or server actions.
- Migrations only occur when the Prisma schema changes, and they are run by `apps/api`.

## Open Questions

- Exact API framework selection (Hono vs Express vs Fastify).
- Whether to add realtime updates (websocket or SSE) in a later phase.
- Push notification strategy for mobile.
