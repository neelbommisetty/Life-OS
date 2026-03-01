## packages/db Agent Scope

- This file governs work in `packages/db` only.
- Responsibility: Prisma schema, migrations, and shared DB runtime for server-side workspaces.

## Prisma and Neon Rules

- Source of truth:
  - Schema: `packages/db/prisma/schema.prisma`
  - Migrations: `packages/db/prisma/migrations`
- Use Prisma + Neon conventions already established in this package.
- Keep environment-variable based connection configuration; do not hardcode connection strings.

## Runtime Packaging Rules

- Keep runtime build output in `dist` and ensure `package.json` `main`/`exports` point to loadable JS.
- Maintain stable exports for consuming server runtimes (`apps/api`, server packages).
- `apps/web` should not consume this package directly; web data access must go through `apps/api`.
- Do not add app-specific business logic here; keep this package infrastructure-focused.
- This package should not own user-facing copy decisions.
- If schema or metadata changes introduce user-visible labels or seeded text, defer to the root brand and copy rules in `docs/brand-guidelines.md`.
- Keep copy policy out of infrastructure code unless there is no practical alternative.

## Commands (workspace-local)

- `bun --filter=./packages/db build`
- `bun --filter=./packages/db prisma:generate`
- `bun --filter=./packages/db prisma:migrate`
- `bun --filter=./packages/db prisma:deploy`
- `bun --filter=./packages/db lint`
- `bun --filter=./packages/db test`
