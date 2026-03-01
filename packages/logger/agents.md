## packages/logger Agent Scope

- This file governs work in `packages/logger` only.
- Responsibility: shared logging utilities used across apps/packages.

## Package Rules

- Keep logger APIs small, stable, and framework-agnostic.
- Avoid app-specific behavior and avoid importing from `apps/*`.
- Preserve ESM compatibility and package export behavior in `package.json`.
- Prefer additive changes over breaking signature changes.
- Internal logs are not user-facing copy.
- If logger helpers emit user-visible error text or shared display messages, those strings must follow app text language rules from `docs/brand-guidelines.md`.
- Do not rely on brand persona alone for any user-visible logger-provided text.

## Quality Rules

- Use Bun test runner (`bun:test`) for tests.
- Keep lint/type checks clean with workspace TypeScript configuration.

## Commands (workspace-local)

- `bun --filter=./packages/logger lint`
- `bun --filter=./packages/logger test`
