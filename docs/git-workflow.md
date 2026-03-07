# Git workflow standard

## Branch model

- `develop` is the default integration branch.
- `main` is the release/production branch.
- Feature work branches from `develop` and merges back to `develop` via PR.
- Release promotion happens with a PR from `develop` to `main`.

## PR and checks policy

- Pre-commit hooks are the required local gate before push/PR:
  - on `main`: run full workspace unit suite + web e2e
  - on `develop`: run full workspace unit suite
  - on other branches: run only changed-workspace lint + unit tests (for example, web-only changes run only web checks)
- Never bypass hooks with `git commit --no-verify`.

## Worktree-first flow

- Create one worktree per active branch.
- Example:

```bash
git fetch origin
git worktree add ../wt-my-feature -b codex/my-feature origin/develop
cd ../wt-my-feature
```

- If you use PRs, open a PR from `codex/my-feature` to `develop`.
- If you use PRs, open a PR from `develop` to `main` when ready to release.

## Vercel deploy policy

- Only deploy from `main`.
- Branch preview deployments are disabled with `ignoreCommand` in:
  - `apps/web/vercel.json`
  - `apps/api/vercel.json`
