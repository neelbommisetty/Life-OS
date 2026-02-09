# Git workflow standard

## Branch model

- `develop` is the default integration branch.
- `main` is the release/production branch.
- Feature work branches from `develop` and merges back to `develop` via PR.
- Release promotion happens with a PR from `develop` to `main`.

## PR and checks policy

- Branch protection rules are disabled for private-repo workflow.
- Direct pushes to `main` and `develop` are allowed.
- Pull requests are optional.
- GitHub Actions are not used as required checks.
- Pre-commit hooks are the required local gate before push/PR:
  - run web e2e tests
  - lint changed files/workspaces
  - run changed unit test files
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
