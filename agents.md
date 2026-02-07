## Monorepo (Bun workspaces)

- This repo is a Bun workspace monorepo (`workspaces: ["apps/*", "packages/*"]`).
- Apps:
  - `apps/web`: Next.js 16 App Router (React 19) web app.
  - `apps/api`: Bun + Hono API service.
  - `apps/ios`: Native iOS app (Swift / Xcode) — separate conventions from the TS codebase.
- Packages:
  - `packages/db`: Prisma + Neon (Postgres) schema/migrations + shared DB client (`@life-os/db`).
  - `packages/ai`: Shared AI routing/providers/utilities (`@life-os/ai`).
- Prefer sharing code via `packages/*` (workspace deps) rather than importing across `apps/*`.

## Commands in a monorepo

- Prefer running scripts from the repo root via `package.json`:
  - Web: `bun dev` / `bun run dev:web` (or `bun run dev:all` for web+api), `bun run build`, `bun run start`
  - API: `bun run dev:api`
  - Lint: `bun run lint` (all configured workspaces), `bun run lint:web` (web only)
  - Tests: `bun run test` (all configured workspaces), `bun run test:web`, `bun run test:api` (and `bun --filter=./packages/* test` as needed)
  - Prisma (DB package): `bun run prisma:generate`, `bun run prisma:migrate`, `bun run prisma:deploy`
- When you need to run a workspace-local script directly, use Bun filters:
  - Example: `bun --filter=./apps/web dev`
  - Example: `bun --filter=./packages/db prisma:migrate`
- When adding dependencies, add them to the correct workspace (app/package), not the repo root:
  - Example: `bun add <dep> --filter=./apps/web`
  - Example: `bun add <dep> --filter=./packages/ai`
- shadcn/ui commands should run from `apps/web` (where `components.json` lives):
  - `cd apps/web && bunx shadcn@latest add <component>`

## Framework and language

- `apps/web` uses Next.js 16 App Router with TypeScript only. Keep server actions/server components preferred where possible.
- `apps/web` uses React 19 with React Compiler enabled (via `babel-plugin-react-compiler`).
- Use Bun for install/dev scripts; match package.json scripts (avoid npm/yarn commands).
- Keep minimal polyfills; no Node-only APIs in `apps/web` client components.

## Styling and UI

- Applies to `apps/web`.
- **shadcn/ui**: Use shadcn/ui components from `apps/web/src/components/ui` (imported as `@/components/ui`). Components are configured with Radix Maia style, RSC support, and CSS variables. Add new components via `cd apps/web && bunx shadcn@latest add <component>`.
- Tailwind CSS 4 is primary styling; prefer utility classes; co-locate component-specific styles via `className`.
- **Icons**: Use `lucide-react` for all icons (configured in shadcn setup).
- Use the `cn()` utility from `apps/web/src/lib/utils` (imported as `@/lib/utils`) for conditional className merging.
- Prefer CSS transitions for animations; add animation libraries only when complex animations are required.

## Data and API layer

- **Prisma + Neon**: Use Prisma ORM with Neon (PostgreSQL) for database operations.
- **DB package**: The Prisma schema and migrations live in `packages/db/prisma/schema.prisma` and `packages/db/prisma/migrations`.
- **Database Access**:
  - Shared (preferred for non-Next code): import Prisma client from `@life-os/db`.
  - Web app (`apps/web`): server code typically imports `prisma` from `@/lib/db` (`apps/web/src/lib/db.ts`), which is the app-local Prisma client wrapper.
- **Prisma Generate / Migrations**: Run Prisma via the DB workspace (prefer root scripts):
  - Generate: `bun run prisma:generate` (or `bun --filter=./packages/db prisma:generate`)
  - Create/apply dev migration: `bun run prisma:migrate` (or `bun --filter=./packages/db prisma:migrate`)
  - Deploy migrations (prod): `bun run prisma:deploy` (or `bun --filter=./packages/db prisma:deploy`)
- **Neon Integration**: Use Neon's serverless adapter (`@prisma/adapter-neon`) for edge/serverless deployments. Connection strings are managed via environment variables.
- **Neon Auth**: Use Neon Auth (`@neondatabase/auth`). Provision Neon Auth via Neon MCP tools or manually set up the `neon_auth` schema. Web auth configuration is in `apps/web/src/lib/auth/server.ts` and `apps/web/src/lib/auth/client.ts`.

## State and data fetching

- Applies to `apps/web`.
- Default to server components; use client components only for interactivity.
- For server data, use Prisma client directly in server components and server actions. Import from `@/lib/db`.
- For client-side data fetching, use server actions or API routes that wrap Prisma queries. Avoid exposing Prisma client to client components.
- Use React Server Components for initial data loading; use client components with server actions for mutations.

## Testing and quality

- **Testing**: Use Bun's built-in test runner (`bun:test`). Import test utilities from `bun:test` (e.g., `import { test, expect, describe } from "bun:test"`). Run tests with `bun test` or `bun run test`. No external test frameworks (Vitest, Jest, etc.).
- **API test requirement**: Whenever adding a new API route/endpoint in `apps/api`, add or update unit tests in the same change immediately (do not defer).
- Type-first: leverage TypeScript and Prisma's generated types. Avoid `any`. Use Prisma's type inference for database models.
- Keep components small and reusable; lift shared logic into hooks/utilities.
- Prefer ESLint/TypeScript fixes over disabling rules; if disabling, justify inline.

## Performance and DX

- Co-locate server-only code away from client bundles; guard with `use server`/`use client` as needed.
- Avoid long-running work in request handlers; offload to background jobs where applicable.
- Keep imports absolute per tsconfig paths if configured; avoid deep relative paths.

## Misc

- Environment variables: document in `.env.example`. Keep app-local `.env` files under the relevant workspace (ex: `apps/web/.env`) in sync as needed.
- Keep accessibility in mind: aria labels for inputs/interactive elements; keyboard support for dialogs/menus.
