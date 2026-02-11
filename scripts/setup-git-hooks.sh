#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

cd "$REPO_ROOT"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required to set up git hooks." >&2
  exit 1
fi

bun run prepare
git config commit.template .gitmessage

printf "Configured Git commit standard for this clone.\n"
printf "Header format: <type>(<scope>): <one-line description>\n"
printf "Body: include execution details.\n"
printf "Pre-commit hooks enabled via Husky.\n"
printf "Branch policy: main=full tests (+web e2e), develop=unit tests, others=changed-workspace lint+unit.\n"
