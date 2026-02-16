## apps/api Agent Scope

- This file governs work in `apps/api` only.
- Stack: Bun runtime + Hono + TypeScript (ESM).
- Keep API behavior isolated from UI concerns.

## Runtime and Import Rules

- Use explicit `.js` extensions for relative ESM imports in runtime code (for Vercel/Node compatibility).
- Import shared Prisma runtime from `@life-os/db`; do not initialize duplicate Prisma clients in `apps/api`.
- Reuse shared modules from `packages/*` (`@life-os/ai`, `@life-os/logger`, etc.) instead of app-to-app imports.

## API Design and Validation

- Use `zod` schemas for request/response validation where applicable.
- Keep handlers small and deterministic; move shared behavior into reusable utilities.
- Avoid long-running synchronous work in request handlers.
- Canonical backend contracts must be no-prefix routes only (`/auth/*`, `/status`, `/home/*`, `/projects*`, `/tasks*`, `/inbox*`, `/notes*`, `/chat*`, `/analytics/*`).
- Reject additions of `/api/*` route aliases in `apps/api`.

## Testing and Coverage Requirements

- Use Bun test runner (`bun:test`).
- When adding or changing an API endpoint, add/update unit tests in the same change.
- When API features change, update `docs/test-plan.md` in the same PR.
- In `docs/test-plan.md`, keep updates aligned to:
  - `User Facing Test Cases`
  - `Platform Capabilities`

## Dev Commands (workspace-local)

- `bun --filter=./apps/api dev`
- `bun --filter=./apps/api lint`
- `bun --filter=./apps/api test`
