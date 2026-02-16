## apps/web Agent Scope

- This file governs work in `apps/web` only.
- Stack: Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4.
- Prefer server components/actions by default; use client components only for interactivity.

## UI and Styling Rules

- Use shadcn/ui components from `@/components/ui`.
- Add new shadcn components from `apps/web`: `bunx shadcn@latest add <component>`.
- Use `lucide-react` for icons.
- Use `cn()` from `@/lib/utils` for class merging.
- Prefer utility-first Tailwind classes and colocated `className` styling.
- Prefer CSS transitions; introduce heavier animation tooling only when required.
- Maintain accessibility basics: labels, keyboard support, and semantic controls.

## Data, Auth, and Boundaries

- Treat `apps/api` as the only data boundary for `apps/web`.
- Do not import or use `@life-os/db`, Prisma clients, or app-local DB wrappers from `apps/web`.
- Do not perform direct DB reads/writes in web server components, route handlers, or server actions.
- Use API calls to `apps/api` for all data reads/mutations (from client components and server-side web code).
- Canonical backend resource routes are no-prefix (for example: `/inbox*`, `/tasks*`, `/notes*`, `/projects*`, `/home/*`, `/chat/*`, `/analytics/*`).
- Canonical backend auth routes are `/auth/*`.
- Keep `apps/web/src/app/api/*` as Next-internal proxy/stream routes (for example: browser-facing `/api/auth/*` proxying to backend `/auth/*`, and `/api/chat/stream`).
- Keep client bundles free of Node-only APIs.
- Neon Auth config lives in:
  - `apps/web/src/lib/auth/server.ts`
  - `apps/web/src/lib/auth/client.ts`

## Quality and Test Requirements

- Use Bun test runner (`bun:test`) for unit/integration tests.
- E2E tests use Playwright (`bun run test:e2e`).
- When web features change, update `docs/test-plan.md` in the same PR.
- In `docs/test-plan.md`, keep updates aligned to:
  - `User Facing Test Cases`
  - `Platform Capabilities`

## Dev Commands (workspace-local)

- `bun --filter=./apps/web dev`
- `bun --filter=./apps/web lint`
- `bun --filter=./apps/web test`
- `bun --filter=./apps/web build`
