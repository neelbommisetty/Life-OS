# Repository Guidelines

Use this reference when building features for Life-OS so contributions stay consistent with our Next.js App Router, Prisma, and AI-first focus.

## Project Structure & Module Organization
- `src/app` contains server-first routes, layouts, and route handlers. Co-locate client components only when interactivity demands `use client`.
- Shared UI sits in `src/components`, domain utilities in `src/lib`, and backend logic in `src/server` plus `src/trpc`. Extend routers under `src/trpc/router` with zod-validated procedures and consume them via `serverCaller` or React Query hooks.
- Styles are Tailwind-only (see `src/app/globals.css`). Icons come from `lucide-react`, headless interactions from `@headlessui/react`, and heavier motion from `framer-motion`.
- Prisma schema, migrations, and adapters live in `prisma/`; public assets in `public/`. Keep drag-and-drop helpers (dnd-kit sensors, collision logic) in dedicated hooks within `src/components` or `src/lib`.

## Build, Test, and Development Commands
- `bun dev` – runs the Next 16 dev server with hot reload.
- `bun run prebuild` – loads `.env.development.local`/`.env.local`, applies Prisma migrations, and regenerates the client; run before CI or production builds.
- `bun run build` / `bun run start` – generate and serve the optimized app.
- `bun run lint` – executes ESLint per `eslint.config.mjs`; resolve issues instead of silencing rules.
- Database helpers: `bun run migrate:dev`, `bun run migrate:deploy`, `bun run migrate:reset`, `bun run db:studio`.
- Tests: `bun test` (runs all tests) or `bun test --watch` (watch mode). Use Bun's built-in test runner; import from `bun:test`.

## Coding Style & Naming Conventions
Stick to TypeScript, avoid `any`, and prefer server components plus server actions. Use absolute imports configured in `tsconfig`. Components are `PascalCase`, hooks/functions `camelCase`, env vars `SCREAMING_SNAKE_CASE`. Keep two-space indentation and deterministic Tailwind ordering (layout → spacing → typography → state). Headless UI handles interactive patterns; lucide icons only; framer-motion reserved for complex transitions. Place server-only modules outside client bundles and gate via `use server` / `use client` directives.

## Testing Guidelines
Use Bun's built-in test runner (`bun:test`). Import test utilities from `bun:test` (e.g., `import { test, expect, describe } from "bun:test"`). Mirror source paths (`src/lib/foo.test.ts`, `src/components/foo.test.tsx`) and favor descriptive suites like `describe("project router > list")`. Each tRPC procedure needs zod validation tests plus both success and failure paths. Validate drag-and-drop helpers with integration-style tests when logic is non-trivial. Run `bun test` before merging and call out any intentional gaps in the PR body.

## Git Workflow (Graphite)
This project uses [Graphite](https://docs.graphite.dev/) for branch management and PR workflows. Use Graphite CLI commands (`gt`) instead of raw git commands for branch operations.

- **Create branches**: Use `gt branch create <branch-name>` or `gt bc` to create a new branch from the current branch.
- **Stack branches**: Use `gt branch create <branch-name> --stack` or `gt bc <branch-name> -s` to create a branch that depends on the current branch.
- **Submit PRs**: Use `gt submit` or `gt s` to create a PR for the current branch. Graphite will automatically detect dependencies and create stacked PRs.
- **Sync branches**: Use `gt sync` to update the current branch with changes from its parent branch and rebase dependent branches.
- **Log**: Use `gt log` to visualize the branch stack and dependencies.
- **Switch branches**: Use `gt checkout <branch-name>` or `gt co <branch-name>` to switch between branches.

Always work in feature branches, never commit directly to `main`. Use Graphite's stacking feature for dependent changes. Before submitting, ensure `bun run lint`, `bun test`, and relevant migration commands pass locally.

## Commit & Pull Request Guidelines
History follows Conventional Commits (`feat:`, `fix:`, `chore:`). Keep PRs focused, reference issues, and include: summary, screenshots or recordings for UI work, schema/env changes, and rollout notes for AI provider toggles. Confirm `bun run lint`, `bun test`, and relevant migration commands pass locally. Request review before merge—even for small fixes.

## Security & Configuration Tips
Document required env vars in `.env.example` and never commit real secrets. Prisma + AI SDKs read credentials via dotenv; rotate keys when experimenting. Point `DATABASE_URL` to disposable instances while testing migrations. Feature-flag experimental AI endpoints inside `src/server`, and ensure background jobs handle any long-running calls rather than request handlers.
