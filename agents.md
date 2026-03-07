## Root Workspace Behavior

- This repository is a Bun workspace monorepo (`workspaces: ["apps/*", "packages/*"]`).
- Active TypeScript workspaces are `apps/web`, `apps/api`, `packages/db`, `packages/ai`, and `packages/logger`.
- Put workspace-specific AGENTS policy updates in that workspace's `AGENTS.md` rather than this root file.
- Prefer sharing code through `packages/*` workspace dependencies instead of cross-importing between apps.
- Backend API contracts in `apps/api` are canonical no-prefix routes only (`/auth/*`, `/status`, `/inbox*`, etc.); do not add `/api/*` aliases in `apps/api`.
- `apps/web/src/app/api/*` is an allowed Next-internal namespace for web proxy/stream handlers and is exempt from the `apps/api` no-`/api/*` rule.

## Brand, Copy, and Language Rules

- Any task involving UI copy, system messages, prompts, naming, onboarding text, product descriptions, or assistant wording must separate:
  - **App text language**: the wording system for all user-facing text.
  - **Brand persona**: the assistant's character, behavior, and tonal overlay.
- Do not collapse app text language and brand persona into a single "voice" decision. They are separate controls and must stay separate.
- Use `docs/brand-guidelines.md` as the canonical source for app text language, brand persona, and terminology.
- Use `docs/brand-design-guidelines.md` as the canonical source for visual design only.
- For wording decisions, apply app text language rules first. Apply brand persona only where assistant behavior or tone matters.
- Do not use the design guidelines as copy guidance except when visual presentation context matters.
- Treat product terminology as a governed system:
  - do not casually rename user-facing terms
  - when touching naming, check the canonical terminology guidance first
  - if a term feels unnatural in-product, treat it as a terminology decision, not a tone tweak
  - keep terminology consistent across web, API, prompts, and docs
- Copy changes must account for every affected user-facing surface:
  - web UI
  - API-generated assistant responses
  - shared AI prompt construction
  - docs where user-facing phrasing is canonicalized
- Follow this decision order for all user-facing text work:
  1. Determine whether the change affects user-facing text.
  2. If yes, apply app text language rules first.
  3. Then apply brand persona only where assistant behavior or tone matters.
  4. Keep visual design decisions separate.
  5. If wording changes affect canonical terms, treat that as a terminology review.

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
- Pre-commit hooks are branch-aware: `main` runs full tests (plus web e2e), `develop` runs unit tests, and other branches run lint + unit tests only for changed workspaces.
- Configure hooks/templates once per clone with `bun run commit:setup`.
- Commit message format: `<type>(<scope>[,<scope>...]): <one-line description>`.
- Commit bodies are required and must include execution details.
- Allowed `type`: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Allowed `scope`: `apps/web`, `apps/api`, `packages/db`, `packages/ai`, `repo`, `docs`, `tooling`, `monorepo`.
- For PR sync, always rebase on `develop`; never merge `develop` into feature branches.
