# API Scaffold Design (Hono + Shared Prisma + AI Package)

Date: 2026-02-03
Owner: Life-OS

## Summary

Add an `apps/api` Hono service in the monorepo and restructure shared data access into `packages/db` with Prisma + Neon. The API is the only runtime consumer of Prisma. Extract AI runtime into `packages/ai` so both web and API can share types/registry, while execution and tracking remain in the API.

## Goals

- Create a minimal, working API service (`apps/api`) on Bun.
- Centralize database access in a shared Prisma package (`packages/db`).
- Keep web data access API-only (web never talks to Prisma directly).
- Make AI runtime reusable via `packages/ai`, while executing AI calls in the API.

## Non-Goals

- Implement full business endpoints or AI features in this scaffold.
- Rework existing web features beyond wiring for API calls.

## Architecture

- **Workspaces**:
  - `apps/web`: Next.js UI only; calls API over HTTP.
  - `apps/api`: Hono service on Bun.
  - `apps/ios`: iOS client.
  - `packages/db`: Prisma schema + client.
  - `packages/ai`: AI registry/providers/types (runtime used by API).
- **Runtime ownership**:
  - `packages/db` defines Prisma schema/migrations and exports Prisma client.
  - `apps/api` imports `packages/db` to access the database.
  - `apps/web` never imports Prisma (API-only data access).
  - `packages/ai` contains providers/registry/types; API executes calls and writes tracking.
- **Initial routes**:
  - `GET /health`: returns `{ status: "ok" }`.
  - `GET /ready`: checks Prisma connectivity (simple query).

## Environment Variables

- **Root `.env` (server-only shared)**
  - `DATABASE_URL`
  - `NEON_AUTH_*` (if needed later)
- **apps/api**
  - `PORT` (default 3001)
  - Any API-only limits or keys
- **apps/web**
  - `NEXT_PUBLIC_API_BASE_URL`

`packages/db` loads the root `.env` via `dotenv/config` in `prisma.config.ts` so migrations and Prisma generate always see `DATABASE_URL` regardless of cwd. Web only consumes `NEXT_PUBLIC_*`.

## AI Layer

- **`packages/ai`** holds model registry, providers, schemas, and tracking middleware.
- **`apps/api`** executes AI calls using `packages/ai` and persists tracking via `packages/db`.
- **`apps/web`** calls API endpoints for AI operations and optionally imports read-only model registry for pricing UI (no secrets).

## Testing & Delivery

- `apps/api` tests:
  - `/health` unit test
  - `/ready` integration test (skips if `DATABASE_URL` missing)
- `packages/db` tests:
  - Prisma client constructability (no DB query)
- `packages/ai` tests:
  - Schema parsing and pure utilities

Root scripts will include:
- `bun --filter=./apps/api dev`
- `bun --filter=./apps/api test`
- `bun --filter=./packages/db prisma:generate`
- `bun --filter=./packages/ai test`

## Open Questions

- Do we want `packages/ai` exposed to web for pricing display, or should pricing be API-only?
- Preferred port and host binding for API in local dev.
