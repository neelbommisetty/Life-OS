# Commit Message Standard

## Required format

```text
<type>(<scope>): <one-line description>

Execution details:
- what changed and how it was executed
- include migrations/scripts/rollout notes when relevant
```

`<scope>` can be a single scope or multiple comma-separated scopes.

Example:

```text
feat(web,db): add project task quick-filter pipeline
```

## Allowed `type`

- `feat`
- `fix`
- `docs`
- `style`
- `refactor`
- `perf`
- `test`
- `build`
- `ci`
- `chore`
- `revert`

## Allowed monorepo `scope`

- `web`
- `api`
- `ios`
- `db`
- `ai`
- `logger`
- `repo`
- `docs`
- `tooling`
- `monorepo`

## Setup (per clone)

Run once after cloning:

```bash
bun run commit:setup
```

This configures:

- Husky git hooks from `.husky/*`
- `commit.template=.gitmessage` so the commit editor opens with the required structure

## Hook policy

- Never bypass hooks with `git commit --no-verify`.
- Branch-aware pre-commit behavior:
  - `main`: run full workspace unit suite (`bun run test`) + web e2e; run iOS unit + UI tests when available.
  - `develop`: run full workspace unit suite (`bun run test`); run iOS unit tests when available.
  - any other branch: run lint + unit tests only for changed workspaces (for example, web-only changes run only web checks); run iOS unit tests when staged changes include `apps/ios/*`.
