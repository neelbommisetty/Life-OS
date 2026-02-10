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
feat(apps/web,packages/db): add project task quick-filter pipeline
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

- `apps/web`
- `apps/api`
- `apps/ios`
- `packages/db`
- `packages/ai`
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

- `core.hooksPath=.githooks` so commit hooks run on `git commit`
- `commit.template=.gitmessage` so the commit editor opens with the required structure

## Hook policy

- Never bypass hooks with `git commit --no-verify`.
- Every commit must pass all pre-commit checks:
  - web e2e tests
  - lint checks for changed files/workspaces
  - unit tests for changed test files
  - iOS unit + UI tests when staged changes include `apps/ios/*`
