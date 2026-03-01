## packages/ai Agent Scope

- This file governs work in `packages/ai` only.
- Responsibility: shared AI provider routing, initialization, services, and tracking utilities.

## Package Boundaries

- Keep this package app-agnostic and reusable by `apps/web` and `apps/api`.
- Do not import app-local code from `apps/*`.
- Reuse shared dependencies from workspaces (`@life-os/db`, `@life-os/logger`) where needed.

## Shared Prompt Contract

- Shared prompt utilities must model app text language and brand persona as separate concerns.
- Do not bake persona assumptions into reusable interfaces unless that coupling is intentional and clearly documented.
- Shared AI behavior should allow clean composition of:
  - stable terminology
  - app text language rules
  - persona overlays
- Use `docs/brand-guidelines.md` as the canonical source for language, persona, and terminology rules.
- Do not treat `docs/brand-design-guidelines.md` as prompt or copy guidance; it is for visual design only.
- For shared prompt changes, apply app text language rules first and layer persona only where assistant behavior or tone matters.

## Build and Exports Rules

- This package is runtime-consumed; keep JS artifacts in `dist` up to date.
- When adding entry points, update `package.json` `exports` and ensure each path resolves to built JS.
- Keep ESM compatibility and external package resolution consistent with existing build scripts.

## Quality Rules

- Use Bun test runner (`bun:test`) for tests.
- Keep provider integrations behind typed interfaces and schema validation.
- Avoid leaking provider-specific behavior into shared public APIs unless intentionally versioned.

## Commands (workspace-local)

- `bun --filter=./packages/ai build`
- `bun --filter=./packages/ai lint`
- `bun --filter=./packages/ai test`
