## packages/ai Agent Scope

- This file governs work in `packages/ai` only.
- Responsibility: shared AI provider routing, initialization, services, and tracking utilities.

## Package Boundaries

- Keep this package app-agnostic and reusable by `apps/web` and `apps/api`.
- Do not import app-local code from `apps/*`.
- Reuse shared dependencies from workspaces (`@life-os/db`, `@life-os/logger`) where needed.

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
