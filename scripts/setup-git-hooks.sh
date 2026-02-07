#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

cd "$REPO_ROOT"

git config core.hooksPath .githooks
git config commit.template .gitmessage

printf "Configured Git commit standard for this clone.\n"
printf "Header format: <type>(<scope>): <one-line description>\n"
printf "Body: include execution details.\n"
