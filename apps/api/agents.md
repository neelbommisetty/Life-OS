## apps/api Agent Scope

- This file governs work in `apps/api` only.
- Stack: Bun runtime + Hono + TypeScript (ESM).
- Keep API behavior isolated from UI concerns.

## Runtime and Import Rules

- Use explicit `.js` extensions for relative ESM imports in runtime code (for Vercel/Node compatibility).
- Import shared Prisma runtime from `@life-os/db`; do not initialize duplicate Prisma clients in `apps/api`.
- Reuse shared modules from `packages/*` (`@life-os/ai`, `@life-os/logger`, etc.) instead of app-to-app imports.

## Prompt and Response Language Rules

- System prompts, assistant defaults, and any user-facing API-generated text must use app text language as the base layer.
- Brand persona is a behavior and tone overlay, not a replacement for clear wording.
- Keep prompt wording aligned with the canonical language and terminology guidance in `docs/brand-guidelines.md`.
- Do not treat `docs/brand-design-guidelines.md` as copy guidance; it is for visual design only.
- Prompt builders in `apps/api` must stay aligned with the web app's wording model for shared product concepts and user-facing terms.
- Avoid generic fallback phrasing that drifts from the brand docs, especially generic "helpful AI assistant" framing.
- For user-facing text changes in `apps/api`, follow this order:
  1. Apply app text language rules.
  2. Layer in brand persona only where assistant behavior or tone matters.
  3. Treat any term rename as a terminology review.

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
