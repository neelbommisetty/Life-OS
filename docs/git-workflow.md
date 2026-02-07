# Git workflow standard

## Branch model

- `develop` is the default integration branch.
- `main` is the release/production branch.
- Feature work branches from `develop` and merges back to `develop` via PR.
- Release promotion happens with a PR from `develop` to `main`.

## PR and checks policy

- No direct pushes to `main` or `develop`.
- All changes go through pull requests.
- Required checks by target branch:
  - `develop`: `unit-tests`
  - `main`: `unit-tests` and `e2e-tests`

## Worktree-first flow

- Create one worktree per active branch.
- Example:

```bash
git fetch origin
git worktree add ../wt-my-feature -b codex/my-feature origin/develop
cd ../wt-my-feature
```

- Open a PR from `codex/my-feature` to `develop`.
- Open a PR from `develop` to `main` when ready to release.

## Vercel deploy policy

- Only deploy from `main`.
- Branch preview deployments are disabled with `ignoreCommand` in:
  - `apps/web/vercel.json`
  - `apps/api/vercel.json`
