## Root Workspace Behavior

- This repository is a Bun workspace monorepo (`workspaces: ["apps/*", "packages/*"]`).
- Active TypeScript workspaces are `apps/web`, `apps/api`, `packages/db`, `packages/ai`, and `packages/logger`.
- `apps/ios` is intentionally out of scope for these root TS conventions.
- Prefer sharing code through `packages/*` workspace dependencies instead of cross-importing between apps.

## Orchestration Commands

- Run orchestration scripts from the repo root `package.json`.
- Common entry points:
  - `bun run dev:all` for web + api.
  - `bun run dev:web` or `bun run dev:api` for single-app dev.
  - `bun run lint` and `bun run test` for cross-workspace checks.
  - `bun run build` and `bun run start` for web production flow.
  - `bun run prisma:generate`, `bun run prisma:migrate`, `bun run prisma:deploy` for DB lifecycle.
- If a workspace-local command is needed, use Bun filters:
  - `bun --filter=./apps/web <script>`
  - `bun --filter=./apps/api <script>`
  - `bun --filter=./packages/<name> <script>`
- Add dependencies to the specific workspace, not the repo root:
  - `bun add <dep> --filter=./apps/web`
  - `bun add <dep> --filter=./packages/ai`

## Build and Runtime Guardrails

- Runtime build orchestration is centralized through root scripts:
  - `prepare:runtime` builds required package runtime artifacts used by apps.
  - `postinstall` and `prebuild` must continue to run runtime preparation.
- Any `packages/*` module consumed at runtime by apps must expose loadable JS outputs (not TS-only sources).
- Keep each runtime package `main`/`exports` aligned with built artifacts in `dist` (or equivalent runtime path).
- Vercel policy: deploy only from `main`; do not deploy branch previews (including `develop`).

## Git, Commit, and PR Policy

- Default branch is `develop`; create feature branches from `develop`.
- Prefer worktree-first flow to avoid branch switching in a single directory.
- Keep branch names predictable: `codex/<task>`, `feat/<task>`, `fix/<task>`.
- Do not use `git commit --no-verify`; all commits must pass pre-commit hooks.
- Configure hooks/templates once per clone with `bun run commit:setup`.
- Commit message format: `<type>(<scope>[,<scope>...]): <one-line description>`.
- Commit bodies are required and must include execution details.
- Allowed `type`: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Allowed `scope`: `apps/web`, `apps/api`, `apps/ios`, `packages/db`, `packages/ai`, `repo`, `docs`, `tooling`, `monorepo`.
- For PR sync, always rebase on `develop`; never merge `develop` into feature branches.
